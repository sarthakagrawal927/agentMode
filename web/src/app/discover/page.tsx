'use client';

import { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Duration = '1d' | '1week' | '1month';

type FeedItem = {
  subreddit: string;
  period: Duration;
  cachedAt?: string;
  top_posts: Array<{
    title: string;
    selftext?: string;
    comments?: string[];
  }>;
};

type FeedResponse = {
  duration: Duration;
  items: FeedItem[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';

export default function DiscoverPage() {
  const [duration, setDuration] = useState<Duration>('1week');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useMemo(
    () => `${API_BASE_URL}/research/subreddit/feed?duration=${duration}`,
    [duration]
  );

  useEffect(() => {
    const fetchFeed = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(fetchUrl, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Failed with ${resp.status}`);
        const json: FeedResponse = await resp.json();
        setItems(Array.isArray(json.items) ? json.items : []);
      } catch (e: any) {
        console.error('Error loading feed', e);
        setError('Failed to load feed');
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    fetchFeed();
  }, [fetchUrl]);

  const subredditItems = useMemo(() => items, [items]);

  return (
    <main className="container mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Discover</h1>
        <div className="w-48">
          <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
            <SelectTrigger>
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

      {loading && <div className="text-sm text-gray-500">Loading feed…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && subredditItems.length === 0 && (
        <div className="text-sm text-gray-500">No cached posts found for this period.</div>
      )}

      <div className="flex flex-col gap-4">
        {subredditItems.map((item) => (
          <Card key={`${item.subreddit}-${item.period}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">r/{item.subreddit}</Badge>
                <span className="text-xs text-gray-500">{item.period}</span>
                {item.cachedAt && (
                  <span className="text-xs text-gray-400">• Cached {new Date(item.cachedAt).toLocaleString()}</span>
                )}
              </div>
              <CardTitle className="text-lg">Top posts</CardTitle>
              <CardDescription>Showing cached results for the selected period</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {Array.isArray(item.top_posts) && item.top_posts.length > 0 ? (
                <ul className="list-disc pl-5 space-y-2">
                  {item.top_posts.slice(0, 5).map((p, idx) => (
                    <li key={idx} className="text-sm">
                      <span className="font-medium">{p.title}</span>
                      {Array.isArray(p.comments) && (
                        <span className="text-gray-500"> {' '}• {p.comments.length} comments</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No posts available.</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}


