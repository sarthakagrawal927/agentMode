import { Metadata } from 'next';
import DiscoverClient from './DiscoverClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';

export const revalidate = 86400; // 24h ISR

export const metadata: Metadata = {
  title: 'Discover - Subreddit Research Feed',
  description: 'Browse AI-powered summaries and top posts from tracked subreddit communities, updated daily.',
  openGraph: {
    title: 'Discover - Subreddit Research Feed',
    description: 'Browse AI-powered summaries and top posts from tracked subreddit communities.',
  },
};

type Duration = '1d' | '1week' | '1month';

type FeedItem = {
  subreddit: string;
  period: Duration;
  cachedAt?: string;
  ai_summary_structured?: Array<{ title?: string; desc?: string; sourceId?: string[] }>;
  ai_summary?: string;
  top_posts: Array<{ title: string; selftext?: string; comments?: string[] }>;
};

async function fetchFeed(duration: string): Promise<FeedItem[]> {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/research/subreddit/feed?duration=${duration}`,
      { next: { revalidate: 86400 } },
    );
    if (!resp.ok) return [];
    const json = await resp.json();
    return Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}

export default async function DiscoverPage() {
  const items = await fetchFeed('1week');

  return <DiscoverClient initialItems={items} initialDuration="1week" />;
}
