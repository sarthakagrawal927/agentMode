'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, TrackedSubreddit, DigestPreference } from '@/services/api';
import { getStoredUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Mail, Trash2 } from 'lucide-react';

export default function DigestSettingsPage() {
  const [user] = useState(getStoredUser());
  const [tracked, setTracked] = useState<TrackedSubreddit[]>([]);
  const [digests, setDigests] = useState<DigestPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.idToken) {
      setLoading(false);
      return;
    }
    Promise.all([
      api.getTrackedSubreddits(),
      api.getDigestPreferences(),
    ]).then(([trackedRes, digestRes]) => {
      setTracked(trackedRes.items);
      setDigests(digestRes.items);
    }).catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [user?.idToken]);

  const handleToggle = async (item: TrackedSubreddit, frequency: 'daily' | 'weekly') => {
    setError(null);
    const existing = digests.find(
      (d) => d.tracked_subreddit_id === item.id && d.channel === 'email',
    );
    try {
      if (existing && existing.frequency === frequency) {
        // Same frequency = disable
        await api.deleteDigestPreference(existing.id);
        setDigests((prev) => prev.filter((d) => d.id !== existing.id));
      } else {
        // Create or update
        const pref = await api.saveDigestPreference({
          tracked_subreddit_id: item.id,
          channel: 'email',
          frequency,
          enabled: true,
        });
        setDigests((prev) => {
          const without = prev.filter(
            (d) => !(d.tracked_subreddit_id === item.id && d.channel === 'email'),
          );
          return [...without, { ...pref, subreddit: item.subreddit }];
        });
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update');
    }
  };

  if (!user?.idToken) {
    return (
      <main className="container mx-auto px-6 py-12 text-center">
        <p className="text-muted-foreground">Sign in to manage digest settings.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-2xl mx-auto space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft size={14} /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Digest Settings</h1>
            <p className="text-sm text-muted-foreground">Configure email digest frequency for each tracked subreddit.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {tracked.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-muted-foreground">No tracked subreddits. <Link href="/dashboard" className="underline">Track one first.</Link></p>
          </div>
        ) : (
          <div className="space-y-3">
            {tracked.map((item) => {
              const digest = digests.find(
                (d) => d.tracked_subreddit_id === item.id && d.channel === 'email',
              );
              return (
                <div key={item.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Mail size={16} className="text-muted-foreground" />
                      <span className="font-medium">r/{item.subreddit}</span>
                      {digest && (
                        <span className="rounded-full bg-emerald-950 border border-emerald-800 px-2 py-0.5 text-xs text-emerald-400">
                          {digest.frequency}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={digest?.frequency === 'daily' ? 'default' : 'outline'}
                        onClick={() => handleToggle(item, 'daily')}
                        className="h-7 text-xs px-3"
                      >
                        Daily
                      </Button>
                      <Button
                        size="sm"
                        variant={digest?.frequency === 'weekly' ? 'default' : 'outline'}
                        onClick={() => handleToggle(item, 'weekly')}
                        className="h-7 text-xs px-3"
                      >
                        Weekly
                      </Button>
                      {digest && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            api.deleteDigestPreference(digest.id).then(() => {
                              setDigests((prev) => prev.filter((d) => d.id !== digest.id));
                            });
                          }}
                          className="h-7 text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                  {digest?.last_sent_at && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last sent: {new Date(digest.last_sent_at).toLocaleString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
