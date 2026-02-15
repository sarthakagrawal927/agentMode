'use client';

import { useEffect, useRef, useState } from 'react';
import SubredditHeader from '@/components/SubredditHeader';
import RedditThreads from '@/components/RedditThreads';
import { api } from '@/services/api';
import { useRouter } from 'next/navigation';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
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
  const [dateInput, setDateInput] = useState('');

  const isAdmin = !!authUser && !!ADMIN_EMAIL && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Listen for auth changes
  useEffect(() => {
    setAuthUser(getStoredUser());
    const interval = setInterval(() => {
      setAuthUser(getStoredUser());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Reddit info client-side (Reddit blocks server IPs)
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
    <main className="container mx-auto p-8">
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

  return (
    <main className="container mx-auto p-8 space-y-8">
      {redditInfo && (
        <div>
          <SubredditHeader info={redditInfo} />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Summary</h2>
          <div className="flex items-center gap-1">
            {PERIOD_SLUGS.map(({ slug, label }) => (
              <Link
                key={slug}
                href={`/r/${subreddit}/${slug}`}
                className={`px-3 py-1 text-sm rounded border transition-colors ${
                  period === slug
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {isArchive && (
          <div className="mb-4">
            <span className="inline-block px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 rounded">
              Archived: {period}
            </span>
          </div>
        )}

        {!isArchive && (
          <p className="text-sm text-gray-500 mb-4">
            Period: {period} | Cached at:{' '}
            {postsLoading ? 'Loading...' : (researchInfo?.cachedAt ? new Date(researchInfo.cachedAt).toLocaleString() : '---')}
          </p>
        )}

        {/* Date picker for archive navigation */}
        <div className="flex items-center gap-2 mb-4">
          <Input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="w-44 h-8 text-sm"
          />
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleDateNavigate}>
            Go to date
          </Button>
          {availableDates.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {availableDates.length} snapshot{availableDates.length !== 1 ? 's' : ''} available
            </span>
          )}
        </div>

        {postsLoading ? (
          <div className="p-4 text-sm text-gray-500">Loading hot posts...</div>
        ) : (
          <SplitSummaryPosts
            subreddit={subreddit}
            aiSummary={aiSummary}
            aiSummaryStructured={aiSummaryStructured}
            posts={researchInfo?.top_posts ?? []}
            onGenerateClick={handleGenerate}
            generateLabel={generateButtonLabel}
            generateDisabled={generateDisabled}
            aiGenerating={aiGenerating}
            onStopGenerate={() => { try { abortRef.current?.abort(); } catch { } }}
            onViewPrompt={() => setPromptDialogOpen(true)}
            isAdmin={isAdmin}
            isArchive={isArchive}
          />
        )}
      </div>

      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>View / edit AI prompt</DialogTitle>
            <DialogDescription>
              This prompt guides the AI summary generation for r/{subreddit}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Write a custom prompt for r/${subreddit}`}
              className="min-h-[160px]"
              readOnly={!isAdmin}
            />
            {promptMessage && (
              <span className="text-xs text-gray-500">{promptMessage}</span>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPromptDialogOpen(false)}>Close</Button>
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
                {savingPrompt ? 'Saving...' : 'Save prompt'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function SplitSummaryPosts({
  subreddit,
  aiSummary,
  aiSummaryStructured,
  posts,
  onGenerateClick,
  generateLabel,
  generateDisabled,
  aiGenerating,
  onStopGenerate,
  onViewPrompt,
  isAdmin,
  isArchive,
}: {
  subreddit: string;
  aiSummary: string;
  aiSummaryStructured: any[] | null;
  posts: any[];
  onGenerateClick: () => void;
  generateLabel: string;
  generateDisabled: boolean;
  aiGenerating: boolean;
  onStopGenerate: () => void;
  onViewPrompt: () => void;
  isAdmin: boolean;
  isArchive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rightWidth, setRightWidth] = useState(0);
  const HANDLE_WIDTH = 6;
  const MIN_RIGHT = 320;
  const MAX_RIGHT_PCT = 0.6;
  const isMobile = useIsMobile();

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const maxRight = rect.width * MAX_RIGHT_PCT;
      const fromLeft = e.clientX - rect.left;
      const newRight = Math.max(0, Math.min(maxRight, rect.width - fromLeft));
      setRightWidth(newRight < MIN_RIGHT ? 0 : Math.max(MIN_RIGHT, newRight));
    }
    function onUp() { setIsDragging(false); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const showPosts = rightWidth > 0;

  const actionButtons = (
    <>
      {isAdmin && !isArchive && (
        <Button size="sm" onClick={onGenerateClick} disabled={generateDisabled} className="h-8 px-2 text-xs">{generateLabel}</Button>
      )}
      {isAdmin && (
        <Button size="sm" variant="outline" onClick={onViewPrompt} className="h-8 px-2 text-xs">View prompt</Button>
      )}
      {aiGenerating && (
        <Button size="sm" variant="secondary" onClick={onStopGenerate} className="h-8 px-2 text-xs">Stop</Button>
      )}
    </>
  );

  const summaryContent = (
    <>
      {Array.isArray(aiSummaryStructured) && aiSummaryStructured.length > 0 ? (
        <ul className="space-y-2">
          {aiSummaryStructured.map((item, idx) => {
            const ids: string[] = Array.isArray(item?.sourceId) ? item.sourceId : [];
            const postId = ids[0];
            const commentId = ids[1];
            const href = commentId
              ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/comment/${commentId}`
              : `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
            return (
              <li key={idx} className="border rounded p-2 text-sm bg-background/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{item?.title || 'Untitled'}</div>
                    {item?.desc && <div className="text-muted-foreground whitespace-pre-wrap">{item.desc}</div>}
                  </div>
                  {postId && (
                    <Link href={href} target="_blank" aria-label="Open on Reddit" className="shrink-0 text-muted-foreground hover:text-foreground">
                      <ExternalLink size={16} />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        aiSummary ? (
          <div className="text-sm whitespace-pre-wrap">{aiSummary}</div>
        ) : (
          <div className="text-sm text-muted-foreground">No summary available.</div>
        )
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="border rounded bg-card text-card-foreground">
        <div className="p-2 flex items-center gap-1 justify-end">
          {actionButtons}
        </div>
        <div className="p-3">
          {summaryContent}
        </div>
        <div className="border-t p-3">
          <RedditThreads subreddit={subreddit} posts={posts ?? []} />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative grid border rounded bg-card text-card-foreground pt-12" style={{ gridTemplateColumns: `1fr ${HANDLE_WIDTH}px ${Math.max(rightWidth, 0)}px` }}>
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {!showPosts && (
          <Button size="sm" variant="secondary" onClick={() => setRightWidth(420)} className="h-8 px-2 text-xs">Show posts</Button>
        )}
        {actionButtons}
      </div>
      <div className="min-h-[400px] max-h-[70vh] overflow-auto p-3">
        {summaryContent}
      </div>

      <div
        role="separator"
        aria-label="Resize posts panel"
        className="cursor-col-resize bg-muted hover:bg-muted/80"
        onMouseDown={() => setIsDragging(true)}
      />

      <div className={`min-h-[400px] max-h-[70vh] overflow-auto ${showPosts ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity`}>
        <div className="p-3">
          <RedditThreads subreddit={subreddit} posts={posts ?? []} />
        </div>
      </div>
    </div>
  );
}
