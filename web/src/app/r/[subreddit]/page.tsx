import { redirect } from 'next/navigation';

interface PageProps {
  params: { subreddit: string };
}

export default function SubredditPage({ params }: PageProps) {
  redirect(`/r/${params.subreddit}/week`);
}
