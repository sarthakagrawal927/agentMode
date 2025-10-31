"use client";

import SubredditForm from "@/components/SubredditForm";
import Link from "next/link";

export default function Home() {
  const commonSubreddits = [
    "programming",
    "technology",
    "startups",
    "MachineLearning",
    "AskReddit",
    "javascript",
    "python",
    "datascience",
  ];

  return (
    <main className="container mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Subreddit Research</h1>

      <div className="mt-4">
        <SubredditForm />
      </div>

      <div className="mt-10">
        <h2 className="text-2xl font-semibold mb-4">Popular subreddits</h2>
        <div className="flex flex-wrap gap-2">
          {commonSubreddits.map((s) => (
            <Link
              key={s}
              href={`/r/${s}`}
              className="px-3 py-1 border rounded hover:bg-gray-50"
            >
              r/{s}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
