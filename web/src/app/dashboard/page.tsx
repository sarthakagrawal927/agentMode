'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, TrackedSubreddit, DigestPreference } from '@/services/api';
import { getStoredUser, AuthUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Loader2, Mail, ExternalLink } from 'lucide-react';

type SummaryStructured = {
  key_trend?: { title?: string; desc?: string };
  notable_discussions?: { title?: string; desc?: string }[];
  key_action?: { title?: string; desc?: string };
};

function SnapshotPreview({ snapshot }: { snapshot: any }) {
  if (!snapshot) return <p className="text-sm text-muted-foreground">No summary yet. Visit the subreddit page to generate one.</p>;
  const structured: SummaryStructured | null = snapshot.ai_summary_structured || null;
  if (!structured?.key_trend) return <p className="text-sm text-muted-foreground">Summary pending...</p>;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{structured.key_trend.title}</p>
      <p className="text-sm text-muted-foreground line-clamp-2">{structured.key_trend.desc}</p>
      {structured.notable_discussions && structured.notable_discussions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          + {structured.notable_discussions.length} notable discussion{structured.notable_discussions.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tracked, setTracked] = useState<TrackedSubreddit[]>([]);
  const [digests, setDigests] = useState<DigestPreference[]>([]);
  const [plan, setPlan] = useState('free');
  const [limit, setLimit] = useState(1);
  const [loading, setLoading] = useState(true);
  const [newSubreddit, setNewSubreddit] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    if (!stored?.idToken) {
      setLoading(false);
      return;
    }
    Promise.all([
      api.getTrackedSubreddits(),
      api.getDigestPreferences().catch(() => ({ items: [] })),
    ]).then(([trackedRes, digestRes]) => {
      setTracked(trackedRes.items);
      setPlan(trackedRes.plan);
      setLimit(trackedRes.limit);
      setDigests(digestRes.items);
    }).catch(() => {
      setError('Failed to load dashboard data');
    }).finally(() => setLoading(false));
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubreddit.trim().replace(/^r\//i, '');
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      await api.trackSubreddit(name);
      setNewSubreddit('');
      const res = await api.getTrackedSubreddits();
      setTracked(res.items);
    } catch (e: any) {
      setError(e?.message || 'Failed to track subreddit');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await api.untrackSubreddit(id);
      setTracked((prev) => prev.filter((t) => t.id !== id));
      setDigests((prev) => prev.filter((d) => d.tracked_subreddit_id !== id));
    } catch {
      setError('Failed to untrack');
    }
  };

  const handleToggleDigest = async (item: TrackedSubreddit) => {
    const existing = digests.find(
      (d) => d.tracked_subreddit_id === item.id && d.channel === 'email',
    );
    try {
      if (existing) {
        await api.deleteDigestPreference(existing.id);
        setDigests((prev) => prev.filter((d) => d.id !== existing.id));
      } else {
        const pref = await api.saveDigestPreference({
          tracked_subreddit_id: item.id,
          channel: 'email',
          frequency: 'daily',
          enabled: true,
        });
        setDigests((prev) => [...prev, { ...pref, subreddit: item.subreddit }]);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update digest');
    }
  };

  if (!user?.idToken) {
    return (
      <main className="container mx-auto px-6 py-12 text-center">
        <h1 className="text-3xl font-bold mb-4">Dashboard</h1>
        <p className="text-muted-foreground mb-6">Sign in with Google to track subreddits and manage your digests.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {plan === 'free' ? 'Free plan' : plan.charAt(0).toUpperCase() + plan.slice(1) + ' plan'} — {tracked.length}/{limit} subreddit{limit !== 1 ? 's' : ''} tracked
            </p>
          </div>
          <Link href="/dashboard/digests">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Mail size={14} />
              Digest Settings
            </Button>
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleAdd} className="flex gap-2 mb-8">
          <Input
            value={newSubreddit}
            onChange={(e) => setNewSubreddit(e.target.value)}
            placeholder="Enter subreddit name (e.g. webdev)"
            className="flex-1"
            disabled={adding || tracked.length >= limit}
          />
          <Button type="submit" disabled={adding || !newSubreddit.trim() || tracked.length >= limit} className="gap-1.5">
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Track
          </Button>
        </form>

        {tracked.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-muted-foreground">No subreddits tracked yet. Add one above to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tracked.map((item) => {
              const hasDigest = digests.some(
                (d) => d.tracked_subreddit_id === item.id && d.channel === 'email',
              );
              return (
                <div key={item.id} className="rounded-xl border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/r/${item.subreddit}/week`} className="text-lg font-semibold hover:underline">
                          r/{item.subreddit}
                        </Link>
                        <Link href={`/r/${item.subreddit}/week`}>
                          <ExternalLink size={14} className="text-muted-foreground" />
                        </Link>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Tracked since {new Date(item.created_at).toLocaleDateString()}
                        {hasDigest && ' — Email digest active'}
                      </p>
                      <div className="mt-3">
                        <SnapshotPreview snapshot={item.latest_snapshot} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant={hasDigest ? 'default' : 'outline'}
                        onClick={() => handleToggleDigest(item)}
                        className="h-8 gap-1"
                        title={hasDigest ? 'Disable email digest' : 'Enable email digest'}
                      >
                        <Mail size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(item.id)}
                        className="h-8 text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
