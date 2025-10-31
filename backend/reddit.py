import asyncpraw as praw
from os import getenv
import traceback
from datetime import datetime, timezone
import math

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

    # Ensure subreddit metadata is loaded so we can read subscriber counts
    try:
        await subreddit_obj.load()
        member_count = int(getattr(subreddit_obj, "subscribers", 0) or 0)
    except Exception:
        member_count = 0

    # Compute dynamic thresholds based on subreddit size
    # comment_threshold = log10(members)
    # post_threshold = 2x comment_threshold
    # reply_threshold = 0.5x comment_threshold
    # Use floats for comparisons; guard against log10(0)
    log_members = math.log10(member_count if member_count > 0 else 1)
    comment_threshold = log_members
    post_threshold = 2 * log_members
    reply_threshold = 0.5 * log_members

    # Compute cutoff based on duration
    duration_map = {
        "1d": ("day", 1 * 24 * 60 * 60),
        "1week": ("week", 7 * 24 * 60 * 60),
        "1month": ("month", 30 * 24 * 60 * 60),  # approx 30 days
    }
    tf, seconds = duration_map.get(duration, duration_map["1week"])  # default 1week
    cutoff_ts = datetime.now(timezone.utc).timestamp() - seconds

    # Use top posts over the desired period; still enforce cutoff for safety
    # Request a bit more than limit to account for filtering by time and score filtering
    async for submission in subreddit_obj.top(time_filter=tf, limit=limit * 2):
        if submission.created_utc < cutoff_ts:
            continue

        # Skip posts that don't meet the post score threshold
        submission_score = float(getattr(submission, "score", 0) or 0)
        if submission_score < post_threshold:
            # Since results are sorted by score desc, once below threshold
            # all further posts will also be below threshold. Stop only if
            # we have already gathered at least 5 posts.
            if len(posts) >= 5:
                break
            # Otherwise continue scanning to honor the "have 5 posts" condition
            # even though we don't expect to find more above-threshold posts.
            continue

        print(f"Processing submission: {submission.title}")
        top_comment_bodies = []

        print("Loading comments...")
        try:
            await submission.load()

            comments_list = await submission.comments()
            # Replace all MoreComments to get a full set of top-level comments
            await comments_list.replace_more(limit=0)

            # Collect top-level comments that meet the threshold
            filtered_comments = []
            async for top_level_comment in comments_list:
                try:
                    top_score = float(getattr(top_level_comment, "score", 0) or 0)
                    if top_score < comment_threshold:
                        continue

                    # Ensure first-level replies are loaded (we only go 1-level deep)
                    try:
                        await top_level_comment.replies.replace_more(limit=0)
                    except Exception:
                        # If replace_more fails on replies, continue with what we have
                        pass

                    # Filter one-level replies meeting the reply threshold
                    replies = []
                    async for reply in top_level_comment.replies:
                        reply_score = float(getattr(reply, "score", 0) or 0)
                        if reply_score >= reply_threshold:
                            replies.append(
                                {
                                    "body": getattr(reply, "body", ""),
                                    "score": reply_score,
                                }
                            )

                    filtered_comments.append(
                        {
                            "body": getattr(top_level_comment, "body", ""),
                            "score": top_score,
                            "replies": replies,
                        }
                    )
                except Exception:
                    # Skip problematic comments rather than failing the whole submission
                    continue
            top_comment_bodies = filtered_comments
        except Exception as e:
            print(f"Error processing comments: {str(e)}")
            raise e

        posts.append(
            {
                "title": submission.title,
                "selftext": submission.selftext,
                "score": submission_score,
                "comments": top_comment_bodies,
            }
        )

        if len(posts) >= limit:
            break

    return posts
