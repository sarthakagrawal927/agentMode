'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { getStoredUser } from '@/lib/auth';
import { Plus, Check, Loader2 } from 'lucide-react';

interface TrackButtonProps {
  subreddit: string;
}

export default function TrackButton({ subreddit }: TrackButtonProps) {
  const [user, setUser] = useState(getStoredUser());
  const [isTracked, setIsTracked] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
    const interval = setInterval(() => setUser(getStoredUser()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user?.idToken) return;
    let cancelled = false;
    api.getTrackedSubreddits().then((res) => {
      if (cancelled) return;
      const match = res.items.find(
        (t) => t.subreddit.toLowerCase() === subreddit.toLowerCase(),
      );
      if (match) {
        setIsTracked(true);
        setTrackId(match.id);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.idToken, subreddit]);

  if (!user?.idToken) return null;

  const handleTrack = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.trackSubreddit(subreddit);
      setIsTracked(true);
      setTrackId(res.id);
    } catch (e: any) {
      setError(e?.message || 'Failed to track');
    } finally {
      setLoading(false);
    }
  };

  const handleUntrack = async () => {
    if (!trackId) return;
    setLoading(true);
    setError(null);
    try {
      await api.untrackSubreddit(trackId);
      setIsTracked(false);
      setTrackId(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to untrack');
    } finally {
      setLoading(false);
    }
  };

  if (isTracked) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleUntrack}
          disabled={loading}
          className="h-8 gap-1.5 border-emerald-800 bg-emerald-950/50 text-emerald-400 hover:bg-red-950/50 hover:text-red-400 hover:border-red-800"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Tracking
        </Button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={handleTrack}
        disabled={loading}
        className="h-8 gap-1.5 bg-[#2f75ff] text-white hover:bg-[#2a67df]"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Track
      </Button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
