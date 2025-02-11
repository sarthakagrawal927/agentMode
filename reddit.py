import asyncpraw as praw
from os import getenv
import traceback

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


async def get_top_posts_for_subreddit(subreddit):
    posts = []
    print(f"Getting subreddit: {subreddit}")
    subreddit = await reddit.subreddit(subreddit)
    async for submission in subreddit.hot(limit=10):
        # Skip posts with no upvotes
        if submission.score <= 0:
            continue

        print(f"Processing submission: {submission.title}")
        comments = []

        print("Loading comments...")
        try:
            # First load the comments
            await submission.load()

            # Then get the comment tree
            comments_list = await submission.comments()
            await comments_list.replace_more(limit=10)

            # Quick check for minimum number of comments
            comment_count = len([c async for c in comments_list])
            if comment_count < 3:
                continue

            # First collect all comments and their scores
            all_comments = []
            async for top_level_comment in comments_list:
                all_comments.append(
                    {"body": top_level_comment.body, "score": top_level_comment.score}
                )

            all_comments.sort(key=lambda x: x["score"], reverse=True)
            comments.extend(all_comments[:3])

            if len(all_comments) > 3:
                min_score_threshold = max(submission.score / 3, 1)
                additional_comments = [
                    c for c in all_comments[3:] if c["score"] >= min_score_threshold
                ]
                comments.extend(additional_comments)
        except Exception as e:
            print(f"Error processing comments: {str(e)}")
            raise e

        posts.append(
            {
                "title": submission.title,
                "selftext": submission.selftext,
                "comments": comments,
                "score": submission.score,
                "permalink": f"https://reddit.com{submission.permalink}",  # URL to the Reddit post
            }
        )
    return posts
