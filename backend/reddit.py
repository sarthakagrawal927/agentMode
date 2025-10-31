import asyncpraw as praw
from os import getenv
import traceback
from datetime import datetime, timezone

reddit = praw.Reddit(
    client_id=getenv("REDDIT_CLIENT_ID"),
    client_secret=getenv("REDDIT_CLIENT_SECRET"),
    user_agent="ResearchBot",
)


async def get_top_posts_for_topic(topic):
    posts = []
    print(f"Searching for subreddits related to {topic}")
    subredditsResponse = await reddit.post(
        "/api/search_subreddits",
        params={"query": topic, "exact": False},
    )
    # {'active_user_count': 478, 'icon_img': 'https://b.thumbs.redditmedia.com/V3oOhkQE_SiCz2dvI2uA7TlbcfvaIMPw2AQjtIdqMUk.png', 'key_color': '#ff4500', 'name': 'sports', 'subscriber_count': 21676314, 'is_chat_post_feature_enabled': False, 'allow_chat_post_feature_enabled': False, 'allow_images': False}

    for subreddit in subredditsResponse["subreddits"]:
        posts.extend(await get_top_posts_for_subreddit(subreddit["name"]))

    return posts


async def get_top_posts_for_subreddit(
    subreddit, limit: int = 20, duration: str = "1week"
):
    posts = []
    print(f"Getting subreddit: {subreddit}")
    subreddit_obj = await reddit.subreddit(subreddit)

    # Compute cutoff based on duration
    duration_map = {
        "1d": ("day", 1 * 24 * 60 * 60),
        "1week": ("week", 7 * 24 * 60 * 60),
        "1month": ("month", 30 * 24 * 60 * 60),  # approx 30 days
    }
    tf, seconds = duration_map.get(duration, duration_map["1week"])  # default 1week
    cutoff_ts = datetime.now(timezone.utc).timestamp() - seconds

    # Use top posts over the desired period; still enforce cutoff for safety
    # Request a bit more than limit to account for filtering by time
    async for submission in subreddit_obj.top(time_filter=tf, limit=limit * 2):
        if submission.created_utc < cutoff_ts:
            continue

        # Skip posts with no upvotes
        if getattr(submission, "score", 0) <= 0:
            continue

        print(f"Processing submission: {submission.title}")
        top_comment_bodies = []

        print("Loading comments...")
        try:
            await submission.load()

            comments_list = await submission.comments()
            # Replace all MoreComments to get a full set of top-level comments
            await comments_list.replace_more(limit=0)

            # Collect comments and pick top 10 by score
            all_comments = []
            async for top_level_comment in comments_list:
                all_comments.append(
                    {"body": top_level_comment.body, "score": top_level_comment.score}
                )

            all_comments.sort(key=lambda x: x["score"], reverse=True)
            top_comment_bodies = [c["body"] for c in all_comments[:10]]
        except Exception as e:
            print(f"Error processing comments: {str(e)}")
            raise e

        posts.append(
            {
                "title": submission.title,
                "selftext": submission.selftext,
                "comments": top_comment_bodies,
            }
        )

        if len(posts) >= limit:
            break

    return posts
