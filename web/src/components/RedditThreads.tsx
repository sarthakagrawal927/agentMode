import { ExternalLink } from "lucide-react";
import Link from "next/link";

export type RedditReply = {
  id: string;
  opId: string; // post id
  body: string;
  score: number;
};

export type RedditComment = {
  id: string;
  opId: string; // post id
  body: string;
  score: number;
  replies?: RedditReply[];
};

export type RedditPost = {
  id: string;
  title: string;
  selftext?: string;
  score: number;
  comments?: RedditComment[];
};

export default function RedditThreads({
  subreddit,
  posts,
}: {
  subreddit: string;
  posts: RedditPost[];
}) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return <div className="text-sm text-gray-500">No posts available.</div>;
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <details key={post.id} className="border rounded bg-card text-card-foreground" open={false}>
          <summary className="cursor-pointer select-none px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{post.title}</div>
              <div className="text-xs text-muted-foreground">Score: {Math.round(post.score)}</div>
            </div>
            <Link
              href={`https://www.reddit.com/r/${subreddit}/comments/${post.id}`}
              target="_blank"
              aria-label="Open post on Reddit"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={16} />
            </Link>
          </summary>

          {post.selftext && (
            <div className="px-3 pb-2 text-sm text-muted-foreground whitespace-pre-wrap">
              {post.selftext}
            </div>
          )}

          {/* Comments */}
          <div className="px-2 pb-2">
            {Array.isArray(post.comments) && post.comments.length > 0 ? (
              <ul className="space-y-2">
                {post.comments.map((c) => (
                  <li key={c.id} className="border rounded bg-background/40">
                    <details>
                      <summary className="cursor-pointer select-none px-3 py-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm whitespace-pre-wrap break-words">{c.body}</div>
                          <div className="text-xs text-muted-foreground mt-1">Score: {Math.round(c.score)}</div>
                        </div>
                        <Link
                          href={`https://www.reddit.com/r/${subreddit}/comments/${c.opId}/comment/${c.id}`}
                          target="_blank"
                          aria-label="Open comment on Reddit"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={16} />
                        </Link>
                      </summary>

                      {/* Replies */}
                      {Array.isArray(c.replies) && c.replies.length > 0 && (
                        <ul className="pl-3 pb-2 space-y-2">
                          {c.replies.map((r) => (
                            <li key={r.id} className="border rounded bg-background/40">
                              <details>
                                <summary className="cursor-pointer select-none px-3 py-2 flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm whitespace-pre-wrap break-words">{r.body}</div>
                                    <div className="text-xs text-muted-foreground mt-1">Score: {Math.round(r.score)}</div>
                                  </div>
                                  <Link
                                    href={`https://www.reddit.com/r/${subreddit}/comments/${r.opId}/comment/${r.id}`}
                                    target="_blank"
                                    aria-label="Open reply on Reddit"
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink size={16} />
                                  </Link>
                                </summary>
                              </details>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground px-1">No comments</div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}


