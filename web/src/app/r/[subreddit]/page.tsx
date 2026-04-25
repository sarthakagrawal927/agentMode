import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ subreddit: string }>;
}

export default async function SubredditPage({ params }: PageProps) {
  const { subreddit } = await params;
  redirect(`/r/${subreddit}/week`);
}
