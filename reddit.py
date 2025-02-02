import asyncpraw as praw
from os import getenv


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
    # {'active_user_count': 478, 'icon_img': 'https://b.thumbs.redditmedia.com/V3oOhkQE_SiCz2dvI2uA7TlbcfvaIMPw2AQjtIdqMUk.png', 'key_color': '#ff4500', 'name': 'sports', 'subscriber_count': 21676314, 'is_chat_post_feature_enabled': False, 'allow_chat_post_creation': False, 'allow_images': False}

    for subreddit in subredditsResponse["subreddits"]:
        subreddit = await reddit.subreddit(subreddit["name"])
        async for submission in subreddit.hot(
            limit=100 / len(subredditsResponse["subreddits"])
        ):
            posts.append(submission.title)

            # print("All attributes of the submission object:")
            # for key, value in vars(submission).items():
            #     print(f"{key}: {value}")
    return posts
