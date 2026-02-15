import { Metadata } from 'next';
import Link from 'next/link';
import SubredditForm from '@/components/SubredditForm';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';

export const revalidate = 86400; // 24h ISR

export const metadata: Metadata = {
  title: 'Agent Mode - Subreddit Research & Analysis',
  description: 'AI-powered research and analysis of Reddit communities. Explore top posts, insights, and summaries from any subreddit.',
  openGraph: {
    title: 'Agent Mode - Subreddit Research & Analysis',
    description: 'AI-powered research and analysis of Reddit communities.',
  },
};

async function fetchPrompts(): Promise<Record<string, string>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/prompts`, {
      next: { revalidate: 86400 },
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    return data.prompts || {};
  } catch {
    return {};
  }
}

export default async function Home() {
  const prompts = await fetchPrompts();
  const sampleSubreddits = Object.keys(prompts);

  return (
    <main className="container mx-auto p-8">
      <div className="mt-4">
        <SubredditForm />
      </div>

      <div className="mt-10">
        <h2 className="text-2xl font-semibold mb-4">Sample subreddits</h2>
        {sampleSubreddits.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sampleSubreddits.map((s) => (
              <Link
                key={s}
                href={`/r/${s}/week`}
                className="px-3 py-1 border rounded hover:bg-accent hover:text-accent-foreground"
              >
                r/{s}
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            No sample subreddits yet. Save a prompt for a subreddit to feature it here.
          </div>
        )}
      </div>
    </main>
  );
}
