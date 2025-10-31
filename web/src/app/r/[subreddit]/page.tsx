'use client';

import { useEffect, useState } from 'react';
import JsonViewer from '@/components/JsonViewer';
import { api } from '@/services/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PageData {
  redditInfo: any;
  researchInfo: any;
}

export default function SubredditPage({
  params,
}: {
  params: { subreddit: string };
}) {
  const [data, setData] = useState<PageData | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [period, setPeriod] = useState<string>(searchParams.get('period') || '1week');

  // Fetch static subreddit info (about) once per subreddit
  useEffect(() => {
    const fetchAbout = async () => {
      try {
        const redditResponse = await fetch(`/api/r/${params.subreddit}`);
        if (!redditResponse.ok) throw new Error('Failed to fetch Reddit data');
        const redditData = await redditResponse.json();
        setData((prev) => ({
          redditInfo: redditData,
          researchInfo: prev?.researchInfo,
        } as PageData));
      } catch (err) {
        console.error('Error fetching subreddit info:', err);
        setError('Failed to load subreddit info');
      }
    };
    fetchAbout();
  }, [params.subreddit]);

  // Fetch research data (posts/comments) whenever period or subreddit changes
  useEffect(() => {
    const fetchResearch = async () => {
      try {
        setPostsLoading(true);
        const researchData = await api.subredditResearch({
          subreddit_name: params.subreddit,
          duration: period as '1d' | '1week' | '1month',
        });
        setData((prev) => ({
          redditInfo: prev?.redditInfo,
          researchInfo: researchData,
        } as PageData));
      } catch (err) {
        console.error('Error fetching research data:', err);
        setError('Failed to load subreddit data');
      } finally {
        setPostsLoading(false);
      }
    };
    fetchResearch();
  }, [params.subreddit, period]);

  // Keep URL in sync with selected period
  useEffect(() => {
    const current = searchParams.get('period') || '1week';
    if (current !== period) {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      sp.set('period', period);
      router.replace(`/r/${params.subreddit}?${sp.toString()}`);
    }
  }, [period, params.subreddit, router, searchParams]);

  const initialLoading = !data || !data.redditInfo || !data.researchInfo;
  if (initialLoading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-500">{error}</div>;
  if (!data) return <div className="p-8">No data found</div>;

  return (
    <div className="space-y-8 p-8">
      <div>
        <h2 className="text-xl font-semibold mb-4">Subreddit Info</h2>
        <JsonViewer data={data.redditInfo} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Hot Posts and Comments</h2>
          <div className="w-44">
            <Select value={period} onValueChange={(v) => setPeriod(v)}>
              <SelectTrigger disabled={postsLoading}>
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Last day</SelectItem>
                <SelectItem value="1week">Last week</SelectItem>
                <SelectItem value="1month">Last month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Period: {period} | Cached at:{' '}
          {postsLoading ? 'Loading…' : (data.researchInfo?.cachedAt ? new Date(data.researchInfo.cachedAt).toLocaleString() : '—')}
        </p>
        {postsLoading ? (
          <div className="p-4 text-sm text-gray-500">Loading hot posts…</div>
        ) : (
          <JsonViewer data={data.researchInfo} />
        )}
      </div>
    </div>
  );
}
