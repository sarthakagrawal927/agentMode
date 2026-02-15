import { Metadata } from 'next';
import SubredditClient from './SubredditClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';

export const revalidate = 86400; // 24h ISR

interface PageProps {
  params: { subreddit: string };
  searchParams: { period?: string };
}

async function fetchResearch(subreddit: string, period: string) {
  try {
    const resp = await fetch(`${API_BASE_URL}/research/subreddit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subreddit_name: subreddit, duration: period }),
      next: { revalidate: 86400 },
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

async function fetchPrompt(subreddit: string) {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/prompts/${encodeURIComponent(subreddit)}`,
      { next: { revalidate: 86400 } },
    );
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subreddit } = params;
  return {
    title: `r/${subreddit} - Research & Analysis`,
    description: `Top posts, insights, and AI-powered analysis for the r/${subreddit} subreddit.`,
    openGraph: {
      title: `r/${subreddit} - Research & Analysis`,
      description: `Top posts, insights, and AI-powered analysis for the r/${subreddit} subreddit.`,
    },
  };
}

export default async function SubredditPage({ params, searchParams }: PageProps) {
  const { subreddit } = params;
  const period = searchParams.period || '1week';

  const [research, promptData] = await Promise.all([
    fetchResearch(subreddit, period),
    fetchPrompt(subreddit),
  ]);

  return (
    <SubredditClient
      subreddit={subreddit}
      initialResearch={research}
      initialPrompt={promptData}
    />
  );
}
