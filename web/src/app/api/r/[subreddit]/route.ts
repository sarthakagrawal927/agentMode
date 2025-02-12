import { NextResponse } from "next/server";
import { withErrorHandler, fetchJson } from "@/lib/api-utils";

export const GET = withErrorHandler(async (request: Request, { params }) => {
  const subreddit = params.subreddit;
  const data = await fetchJson(
    `https://www.reddit.com/r/${subreddit}/about.json`,
    {
      headers: {
        "User-Agent": "SubredditResearch/1.0.0",
      },
    }
  );

  const subredditInfo = {
    name: data.data.display_name,
    title: data.data.title,
    description: data.data.public_description,
    subscribers: data.data.subscribers,
    activeUsers: data.data.active_user_count,
    created: new Date(data.data.created_utc * 1000).toISOString(),
    nsfw: data.data.over18,
    url: `https://reddit.com/r/${subreddit}`,
  };

  return NextResponse.json(subredditInfo);
});
