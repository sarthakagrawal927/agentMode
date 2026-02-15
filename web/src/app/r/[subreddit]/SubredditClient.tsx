'use client';

import { useEffect, useRef, useState } from 'react';
import SubredditHeader from '@/components/SubredditHeader';
import RedditThreads from '@/components/RedditThreads';
import { api } from '@/services/api';
import { useRouter } from 'next/navigation';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ExternalLink, Sparkles, Settings, Square, Calendar as CalendarIcon } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AuthUser, getStoredUser, getAuthHeaders } from '@/lib/auth';
import { Input } from '@/components/ui/input';

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || '';

const PERIOD_MAP: Record<string, string> = {
  day: '1d',
  week: '1week',
  month: '1month',
};

const PERIOD_SLUGS = [
  { slug: 'day', label: 'Day' },
  { slug: 'week', label: 'Week' },
  { slug: 'month', label: 'Month' },
];

interface SubredditClientProps {
  subreddit: string;
  initialResearch: any | null;
  initialPrompt: { prompt: string; isDefault: boolean } | null;
  period: string;
  isArchive: boolean;
  availableDates?: string[];
}

export default function SubredditClient({
  subreddit,
  initialResearch,
  initialPrompt,
  period,
  isArchive,
  availableDates = [],
}: SubredditClientProps) {
  const [redditInfo, setRedditInfo] = useState<any>(null);
  const [researchInfo, setResearchInfo] = useState<any>(initialResearch);
  const [postsLoading, setPostsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [prompt, setPrompt] = useState<string>(initialPrompt?.prompt || '');
  const [isDefaultPrompt, setIsDefaultPrompt] = useState<boolean>(initialPrompt?.isDefault ?? true);
  const [savingPrompt, setSavingPrompt] = useState<boolean>(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string>(() => {
    if (initialResearch && typeof initialResearch.ai_summary === 'string') return initialResearch.ai_summary;
    return '';
  });
  const [aiSummaryStructured, setAiSummaryStructured] = useState<any[] | null>(() => {
    if (initialResearch && Array.isArray(initialResearch.ai_summary_structured)) return initialResearch.ai_summary_structured;
    return null;
  });
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';
  const [aiPromptUsed, setAiPromptUsed] = useState<string | null>(() => {
    if (initialResearch && typeof initialResearch.ai_prompt_used === 'string') return initialResearch.ai_prompt_used;
    return null;
  });
  const [promptDialogOpen, setPromptDialogOpen] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().split('T')[0]);

  const isAdmin = !!authUser && !!ADMIN_EMAIL && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  useEffect(() => {
    setAuthUser(getStoredUser());
    const interval = setInterval(() => {
      setAuthUser(getStoredUser());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (researchInfo) return;
    const fetchClientSide = async () => {
      try {
        setPostsLoading(true);
        const isDate = /^\d{4}-\d{2}-\d{2}$/.test(period);
        let data;
        if (isDate) {
          const resp = await fetch(
            `${API_BASE_URL}/research/subreddit/${encodeURIComponent(subreddit)}/snapshot/${period}`,
          );
          data = resp.ok ? await resp.json() : null;
        } else {
          const duration = PERIOD_MAP[period] || '1week';
          data = await api.subredditResearch({ subreddit_name: subreddit, duration: duration as any });
        }
        if (data) {
          setResearchInfo(data);
          if (Array.isArray(data.ai_summary_structured)) setAiSummaryStructured(data.ai_summary_structured);
          if (typeof data.ai_summary === 'string') setAiSummary(data.ai_summary);
          if (typeof data.ai_prompt_used === 'string') setAiPromptUsed(data.ai_prompt_used);
        }
      } catch (err) {
        console.error('Client-side fetch failed:', err);
        setError('Failed to load subreddit data');
      } finally {
        setPostsLoading(false);
      }
    };
    fetchClientSide();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subreddit, period]);

  useEffect(() => {
    const fetchAbout = async () => {
      try {
        const resp = await fetch(
          `https://www.reddit.com/r/${subreddit}/about.json`,
          { headers: { 'User-Agent': 'SubredditResearch/1.0.0' } }
        );
        if (!resp.ok) throw new Error('Failed to fetch Reddit data');
        const raw = await resp.json();
        const d = raw?.data;
        setRedditInfo({
          name: d?.display_name,
          title: d?.title,
          description: d?.public_description,
          subscribers: d?.subscribers,
          activeUsers: d?.active_user_count,
          created: d?.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
          nsfw: d?.over18,
          url: `https://reddit.com/r/${subreddit}`,
        });
      } catch (err) {
        console.error('Error fetching subreddit info:', err);
      }
    };
    fetchAbout();
  }, [subreddit]);

  if (error) return (
    <main className="container mx-auto px-6 py-8">
      <div className="text-red-500">{error}</div>
    </main>
  );

  const generateButtonLabel = aiGenerating
    ? 'Generating...'
    : ((!!aiSummary || !!aiSummaryStructured)
      ? (aiPromptUsed === prompt ? 'Summary cached' : 'Re-generate')
      : 'Generate');

  const generateDisabled = aiGenerating || (((!!aiSummary || !!aiSummaryStructured) && aiPromptUsed === prompt));

  const handleGenerate = async () => {
    try {
      setAiSummary('');
      setAiSummaryStructured([]);
      setAiError(null);
      setAiGenerating(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const duration = PERIOD_MAP[period] || period;
      const resp = await fetch(`${API_BASE_URL}/research/subreddit/summary/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          subreddit_name: subreddit,
          duration,
          prompt,
          reddit_data: {
            subreddit: researchInfo?.subreddit || subreddit,
            period: researchInfo?.period || duration,
            top_posts: researchInfo?.top_posts,
          },
        }),
        signal: controller.signal,
      });
      if (resp.status === 401 || resp.status === 403) {
        setAiError('Admin authentication required. Please sign in.');
        setAiGenerating(false);
        return;
      }
      if (!resp.body) throw new Error('No response body');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ndjsonBuffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        buffer += chunk;
        ndjsonBuffer += chunk;
        const lines = ndjsonBuffer.split(/\r?\n/);
        ndjsonBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === 'object') {
              setAiSummaryStructured((prev: any[] | null) => Array.isArray(prev) ? [...prev, obj] : [obj]);
            }
          } catch { }
        }
      }
      try {
        const parsed = JSON.parse(buffer);
        if (Array.isArray(parsed)) {
          setAiSummaryStructured(parsed);
          setAiSummary('');
          setAiPromptUsed(prompt);
        } else {
          if (!Array.isArray(aiSummaryStructured) || (aiSummaryStructured?.length ?? 0) === 0) {
            setAiSummary(buffer);
          }
          setAiPromptUsed(prompt);
        }
      } catch {
        setAiPromptUsed(prompt);
        setAiSummary((prev) => (Array.isArray(aiSummaryStructured) && aiSummaryStructured.length > 0 ? '' : buffer));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setAiError(null);
      } else {
        setAiError('Failed to generate summary');
      }
    } finally {
      setAiGenerating(false);
      abortRef.current = null;
    }
  };

  const handleDateNavigate = () => {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      router.push(`/r/${subreddit}/${trimmed}`);
    }
  };

  const posts = researchInfo?.top_posts ?? [];

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      {redditInfo && <SubredditHeader info={redditInfo} />}

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Period tabs */}
        <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
          {PERIOD_SLUGS.map(({ slug, label }) => (
            <Link
              key={slug}
              href={`/r/${subreddit}/${slug}`}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                period === slug
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-1.5">
          <CalendarIcon size={14} className="text-muted-foreground" />
          <Input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="w-40 h-8 text-sm"
          />
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleDateNavigate}>
            Go
          </Button>
        </div>

        {availableDates.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {availableDates.length} snapshot{availableDates.length !== 1 ? 's' : ''}
          </span>
        )}

        {isArchive && (
          <span className="px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded-full">
            Archive: {period}
          </span>
        )}

        {!isArchive && researchInfo?.cachedAt && (
          <span className="text-xs text-muted-foreground ml-auto">
            Updated {new Date(researchInfo.cachedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Admin actions */}
      {isAdmin && !isArchive && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generateDisabled}
            className="gap-1.5"
          >
            <Sparkles size={14} />
            {generateButtonLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPromptDialogOpen(true)} className="gap-1.5">
            <Settings size={14} />
            Prompt
          </Button>
          {aiGenerating && (
            <Button size="sm" variant="destructive" onClick={() => { try { abortRef.current?.abort(); } catch { } }} className="gap-1.5">
              <Square size={14} />
              Stop
            </Button>
          )}
          {aiError && <span className="text-xs text-destructive">{aiError}</span>}
        </div>
      )}

      {postsLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* AI Summary */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">AI Summary</h2>
            <div className="border rounded-lg bg-card p-4 min-h-[300px] max-h-[70vh] overflow-auto">
              {Array.isArray(aiSummaryStructured) && aiSummaryStructured.length > 0 ? (
                <ul className="space-y-3">
                  {aiSummaryStructured.map((item, idx) => {
                    const ids: string[] = Array.isArray(item?.sourceId) ? item.sourceId : [];
                    const postId = ids[0];
                    const commentId = ids[1];
                    const href = commentId
                      ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/comment/${commentId}`
                      : `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
                    return (
                      <li key={idx} className="border rounded-lg p-3 bg-background/50 hover:bg-background transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="font-medium text-sm">{item?.title || 'Untitled'}</div>
                            {item?.desc && <div className="text-sm text-muted-foreground leading-relaxed">{item.desc}</div>}
                          </div>
                          {postId && (
                            <Link href={href} target="_blank" aria-label="Open on Reddit" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                              <ExternalLink size={14} />
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : aiSummary ? (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</div>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  {isAdmin && !isArchive ? 'Click Generate to create an AI summary' : 'No summary available'}
                </div>
              )}
            </div>
          </div>

          {/* Posts */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Top Posts ({posts.length})
            </h2>
            <div className="border rounded-lg bg-card p-4 min-h-[300px] max-h-[70vh] overflow-auto">
              <RedditThreads subreddit={subreddit} posts={posts} />
            </div>
          </div>
        </div>
      )}

      {/* Prompt dialog */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI Prompt</DialogTitle>
            <DialogDescription>
              Configure the prompt used for AI summary generation for r/{subreddit}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`Write a custom prompt for r/${subreddit}`}
            className="min-h-[160px]"
            readOnly={!isAdmin}
          />
          {promptMessage && (
            <span className="text-xs text-muted-foreground">{promptMessage}</span>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromptDialogOpen(false)}>Cancel</Button>
            {isAdmin && (
              <Button
                onClick={async () => {
                  try {
                    setSavingPrompt(true);
                    setPromptMessage(null);
                    const resp = await fetch(
                      `${API_BASE_URL}/prompts/${encodeURIComponent(subreddit)}`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                        body: JSON.stringify({ prompt }),
                      },
                    );
                    if (!resp.ok) throw new Error('Failed to save');
                    const saved = await resp.json();
                    setIsDefaultPrompt(false);
                    setPrompt(saved.prompt);
                    setPromptMessage('Saved');
                  } catch (e: any) {
                    setPromptMessage('Failed to save');
                  } finally {
                    setSavingPrompt(false);
                  }
                }}
                disabled={savingPrompt || !prompt.trim()}
              >
                {savingPrompt ? 'Saving...' : 'Save'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
