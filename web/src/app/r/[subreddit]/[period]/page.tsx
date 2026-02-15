import { Metadata } from 'next';
import SubredditClient from '../SubredditClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';

export const revalidate = 86400; // 24h ISR

const PERIOD_MAP: Record<string, string> = {
  day: '1d',
  week: '1week',
  month: '1month',
};

const PERIOD_LABELS: Record<string, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  params: { subreddit: string; period: string };
}

async function fetchResearch(subreddit: string, duration: string) {
  try {
    const resp = await fetch(`${API_BASE_URL}/research/subreddit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subreddit_name: subreddit, duration }),
      next: { revalidate: 86400 },
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

async function fetchSnapshot(subreddit: string, date: string) {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/research/subreddit/${encodeURIComponent(subreddit)}/snapshot/${date}`,
      { next: { revalidate: 86400 } },
    );
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

async function fetchDates(subreddit: string): Promise<string[]> {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/research/subreddit/${encodeURIComponent(subreddit)}/dates`,
      { next: { revalidate: 86400 } },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.dates || [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subreddit, period } = params;
  const isDate = DATE_RE.test(period);
  const label = isDate ? period : (PERIOD_LABELS[period] || period);
  return {
    title: `r/${subreddit} - ${label} Research & Analysis`,
    description: `Top posts, insights, and AI-powered analysis for the r/${subreddit} subreddit (${label}).`,
    openGraph: {
      title: `r/${subreddit} - ${label} Research & Analysis`,
      description: `Top posts, insights, and AI-powered analysis for the r/${subreddit} subreddit (${label}).`,
    },
  };
}

export default async function SubredditPeriodPage({ params }: PageProps) {
  const { subreddit, period } = params;
  const isDate = DATE_RE.test(period);

  if (isDate) {
    const [snapshot, dates] = await Promise.all([
      fetchSnapshot(subreddit, period),
      fetchDates(subreddit),
    ]);
    return (
      <SubredditClient
        subreddit={subreddit}
        initialResearch={snapshot}
        initialPrompt={null}
        period={period}
        isArchive
        availableDates={dates}
      />
    );
  }

  // Named period
  const duration = PERIOD_MAP[period] || '1week';
  const [research, promptData, dates] = await Promise.all([
    fetchResearch(subreddit, duration),
    fetchPrompt(subreddit),
    fetchDates(subreddit),
  ]);

  return (
    <SubredditClient
      subreddit={subreddit}
      initialResearch={research}
      initialPrompt={promptData}
      period={period}
      isArchive={false}
      availableDates={dates}
    />
  );
}
