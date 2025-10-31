'use client';

import { useEffect, useRef, useState } from 'react';
import DataTree from '@/components/DataTree';
import SubredditHeader from '@/components/SubredditHeader';
import RedditThreads from '@/components/RedditThreads';
import { api } from '@/services/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
// removed card wrapper for AI prompt section
import { ExternalLink } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  const [prompt, setPrompt] = useState<string>('');
  const [isDefaultPrompt, setIsDefaultPrompt] = useState<boolean>(true);
  const [savingPrompt, setSavingPrompt] = useState<boolean>(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiSummaryStructured, setAiSummaryStructured] = useState<any[] | null>(null);
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';
  const [aiPromptUsed, setAiPromptUsed] = useState<string | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState<boolean>(false);

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

  // Fetch prompt for this subreddit
  useEffect(() => {
    const loadPrompt = async () => {
      try {
        const res = await api.getSubredditPrompt(params.subreddit);
        setPrompt(res.prompt || '');
        setIsDefaultPrompt(!!res.isDefault);
        setPromptMessage(null);
      } catch (e: any) {
        setPrompt('');
        setIsDefaultPrompt(true);
        setPromptMessage('Failed to load prompt');
      }
    };
    loadPrompt();
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
        if (researchData && typeof researchData === 'object') {
          if (Array.isArray(researchData.ai_summary_structured)) setAiSummaryStructured(researchData.ai_summary_structured);
          else setAiSummaryStructured(null);
          if (typeof researchData.ai_summary === 'string') setAiSummary(researchData.ai_summary);
          else setAiSummary('');
          if (typeof researchData.ai_prompt_used === 'string') setAiPromptUsed(researchData.ai_prompt_used);
          else setAiPromptUsed(null);
        }
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
  if (initialLoading) return (
    <main className="container mx-auto p-8">
      <div className="text-sm text-gray-500">Loading…</div>
    </main>
  );
  if (error) return (
    <main className="container mx-auto p-8">
      <div className="text-red-500">{error}</div>
    </main>
  );
  if (!data) return (
    <main className="container mx-auto p-8">
      <div>No data found</div>
    </main>
  );

  const generateButtonLabel = aiGenerating
    ? 'Generating…'
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
      const resp = await fetch(`${API_BASE_URL}/research/subreddit/summary/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subreddit_name: params.subreddit,
          duration: period,
          prompt,
          reddit_data: {
            subreddit: data.researchInfo.subreddit || params.subreddit,
            period: data.researchInfo.period || period,
            top_posts: data.researchInfo.top_posts,
          },
        }),
        signal: controller.signal,
      });
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
        // Try NDJSON/SSE-style lines: parse only complete JSON lines
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
          // If not an array, treat as plain text summary
          if (!Array.isArray(aiSummaryStructured) || (aiSummaryStructured?.length ?? 0) === 0) {
            setAiSummary(buffer);
          }
          setAiPromptUsed(prompt);
        }
      } catch {
        // Fallback: if we parsed some NDJSON items, keep them; otherwise show text
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

  return (
    <main className="container mx-auto p-8 space-y-8">
      {/* Subreddit content (no box) */}
      <div>
        <SubredditHeader info={data.redditInfo} />
      </div>

      {/* Summary + Posts split view */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Summary</h2>
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
          <>
            {/* Draggable split: left summary, right posts */}
            <SplitSummaryPosts
              subreddit={params.subreddit}
              aiSummary={aiSummary}
              aiSummaryStructured={aiSummaryStructured}
              posts={data.researchInfo?.top_posts ?? []}
              onGenerateClick={handleGenerate}
              generateLabel={generateButtonLabel}
              generateDisabled={generateDisabled}
              aiGenerating={aiGenerating}
              onStopGenerate={() => { try { abortRef.current?.abort(); } catch { } }}
              onViewPrompt={() => setPromptDialogOpen(true)}
            />
          </>
        )}
      </div>
      {/* Prompt modal */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>View / edit AI prompt</DialogTitle>
            <DialogDescription>
              This prompt guides the AI summary generation for r/{params.subreddit}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Write a custom prompt for r/${params.subreddit}`}
              className="min-h-[160px]"
            />
            {promptMessage && (
              <span className="text-xs text-gray-500">{promptMessage}</span>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPromptDialogOpen(false)}
            >
              Close
            </Button>
            <Button
              onClick={async () => {
                try {
                  setSavingPrompt(true);
                  setPromptMessage(null);
                  const saved = await api.saveSubredditPrompt(params.subreddit, prompt);
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
              {savingPrompt ? 'Saving…' : 'Save prompt'}
            </Button>
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
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rightWidth, setRightWidth] = useState(0); // px; 0 = collapsed
  const HANDLE_WIDTH = 6;
  const MIN_RIGHT = 320;
  const MAX_RIGHT_PCT = 0.6; // max 60% of container
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

  if (isMobile) {
    return (
      <div className="border rounded bg-card text-card-foreground">
        <div className="p-2 flex items-center gap-1 justify-end">
          <Button size="sm" onClick={onGenerateClick} disabled={generateDisabled} className="h-8 px-2 text-xs">{generateLabel}</Button>
          <Button size="sm" variant="outline" onClick={onViewPrompt} className="h-8 px-2 text-xs">View prompt</Button>
          {aiGenerating && (
            <Button size="sm" variant="secondary" onClick={onStopGenerate} className="h-8 px-2 text-xs">Stop</Button>
          )}
        </div>
        <div className="p-3">
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
        </div>
        <div className="border-t p-3">
          <RedditThreads subreddit={subreddit} posts={posts ?? []} />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative grid border rounded bg-card text-card-foreground pt-12" style={{ gridTemplateColumns: `1fr ${HANDLE_WIDTH}px ${Math.max(rightWidth, 0)}px` }}>
      {/* Toolbar in corner */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {!showPosts && (
          <Button size="sm" variant="secondary" onClick={() => setRightWidth(420)} className="h-8 px-2 text-xs">Show posts</Button>
        )}
        <Button size="sm" onClick={onGenerateClick} disabled={generateDisabled} className="h-8 px-2 text-xs">{generateLabel}</Button>
        <Button size="sm" variant="outline" onClick={onViewPrompt} className="h-8 px-2 text-xs">View prompt</Button>
        {aiGenerating && (
          <Button size="sm" variant="secondary" onClick={onStopGenerate} className="h-8 px-2 text-xs">Stop</Button>
        )}
      </div>
      {/* Left: Summary */}
      <div className="min-h-[400px] max-h-[70vh] overflow-auto p-3">
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
                      <Link href={href} target="_blank" aria-label="Open on Reddit" className="shrink-0 text-gray-500 hover:text-gray-700">
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
      </div>

      {/* Handle */}
      <div
        role="separator"
        aria-label="Resize posts panel"
        className="cursor-col-resize bg-muted hover:bg-muted/80"
        onMouseDown={() => setIsDragging(true)}
      />

      {/* Right: Posts (collapsible) */}
      <div className={`min-h-[400px] max-h-[70vh] overflow-auto ${showPosts ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity`}>
        <div className="p-3">
          <RedditThreads subreddit={subreddit} posts={posts ?? []} />
        </div>
      </div>

      {/* (Show posts handled in toolbar) */}
    </div>
  );
}





