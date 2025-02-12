'use client';

import { useEffect, useState } from 'react';
import JsonViewer from '@/components/JsonViewer';
import { api } from '@/services/api';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [redditResponse, researchData] = await Promise.all([
          fetch(`/api/r/${params.subreddit}`),
          api.subredditResearch({
            subreddit_name: params.subreddit,
          })
        ]);

        if (!redditResponse.ok) throw new Error('Failed to fetch Reddit data');
        const redditData = await redditResponse.json();

        setData({
          redditInfo: redditData,
          researchInfo: researchData,
        });
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load subreddit data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [params.subreddit]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-500">{error}</div>;
  if (!data) return <div className="p-8">No data found</div>;

  return (
    <div className="space-y-8 p-8">
      <div>
        <h2 className="text-xl font-semibold mb-4">Reddit Data</h2>
        <JsonViewer data={data.redditInfo} />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Research Analysis</h2>
        <JsonViewer data={data.researchInfo} />
      </div>
    </div>
  );
}
