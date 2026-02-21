import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SubredditClient from '../SubredditClient';

export const revalidate = 86400; // 24h ISR

const PERIOD_LABELS: Record<string, string> = {
  day: 'Daily',
  week: 'Weekly',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  params: { subreddit: string; period: string };
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

export default function SubredditPeriodPage({ params }: PageProps) {
  const { subreddit, period } = params;
  const isDate = DATE_RE.test(period);
  if (!isDate && period === 'month') {
    redirect(`/r/${subreddit}/week`);
  }

  return (
    <SubredditClient
      subreddit={subreddit}
      initialResearch={null}
      initialPrompt={null}
      period={period}
      isArchive={isDate}
    />
  );
}
