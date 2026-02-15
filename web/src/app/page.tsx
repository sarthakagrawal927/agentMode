import { Metadata } from 'next';
import Link from 'next/link';
import SubredditForm from '@/components/SubredditForm';
import { Search } from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';

export const revalidate = 86400; // 24h ISR

export const metadata: Metadata = {
  title: 'AgentData - Subreddit Research & Analysis',
  description: 'AI-powered research and analysis of Reddit communities. Explore top posts, insights, and summaries from any subreddit.',
  openGraph: {
    title: 'AgentData - Subreddit Research & Analysis',
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
    <main className="container mx-auto px-6 py-12">
      <div className="max-w-3xl mx-auto text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          Subreddit Research
        </h1>
        <p className="text-lg text-muted-foreground">
          AI-powered analysis of Reddit communities. Get top posts, insights, and summaries.
        </p>
      </div>

      <div className="max-w-xl mx-auto mb-16">
        <SubredditForm />
      </div>

      {sampleSubreddits.length > 0 && (
        <div className="max-w-4xl mx-auto">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Tracked communities
          </h2>
          <div className="flex flex-wrap gap-2">
            {sampleSubreddits.map((s) => (
              <Link
                key={s}
                href={`/r/${s}/week`}
                className="px-3 py-1.5 text-sm font-medium rounded-full border bg-card hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                r/{s}
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
