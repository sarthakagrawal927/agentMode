"use client";

import SubredditForm from "@/components/SubredditForm";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/services/api";

export default function Home() {
  const [sampleSubreddits, setSampleSubreddits] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const { prompts } = await api.getPrompts();
        const keys = Object.keys(prompts || {});
        setSampleSubreddits(keys);
      } catch (e: any) {
        setError("Failed to load sample subreddits");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <main className="container mx-auto p-8">

      <div className="mt-4">
        <SubredditForm />
      </div>

      <div className="mt-10">
        <h2 className="text-2xl font-semibold mb-4">Sample subreddits</h2>
        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && (
          <div className="flex flex-wrap gap-2">
            {sampleSubreddits.length > 0 ? (
              sampleSubreddits.map((s) => (
                <Link
                  key={s}
                  href={`/r/${s}`}
                  className="px-3 py-1 border rounded hover:bg-accent hover:text-accent-foreground"
                >
                  r/{s}
                </Link>
              ))
            ) : (
              <div className="text-sm text-gray-500">
                No sample subreddits yet. Save a prompt for a subreddit to feature it here.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
