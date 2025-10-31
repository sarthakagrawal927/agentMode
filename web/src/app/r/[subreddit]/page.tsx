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
  if (initialLoading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-500">{error}</div>;
  if (!data) return <div className="p-8">No data found</div>;

  return (
    <div className="space-y-8 p-8">
      <div>
        <h2 className="text-xl font-semibold mb-4">Subreddit</h2>
        <SubredditHeader info={data.redditInfo} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">AI Prompt</h2>
          {isDefaultPrompt ? (
            <span className="text-xs text-gray-500">Using default prompt</span>
          ) : (
            <span className="text-xs text-green-600">Custom prompt</span>
          )}
        </div>
        <div className="space-y-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`Write a custom prompt for r/${params.subreddit}`}
            className="min-h-[120px]"
          />
          <div className="flex items-center gap-3">
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
            {promptMessage && (
              <span className="text-xs text-gray-500">{promptMessage}</span>
            )}
          </div>
        </div>
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
          <>
            <div className="mb-3 flex items-center gap-3">
              <Button
                onClick={async () => {
                  try {
                    setAiSummary('');
                    setAiSummaryStructured(null);
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
                        // Send current prompt so backend uses it as system prompt
                        prompt,
                        // Send the same reddit data we are displaying
                        reddit_data: {
                          subreddit: data.researchInfo.subreddit || params.subreddit,
                          period: data.researchInfo.period || period,
                          top_posts: data.researchInfo.top_posts,
                        },
                      }),
                      signal: controller.signal,
                    });
                    if (!resp.body) {
                      throw new Error('No response body');
                    }
                    const reader = resp.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      const chunk = decoder.decode(value, { stream: true });
                      if (chunk) buffer += chunk;
                    }
                    // Try to parse JSON array
                    try {
                      const parsed = JSON.parse(buffer);
                      if (Array.isArray(parsed)) {
                        setAiSummaryStructured(parsed);
                        setAiPromptUsed(prompt);
                      } else {
                        setAiSummary(buffer);
                      }
                    } catch {
                      setAiSummary(buffer);
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
                }}
                disabled={aiGenerating || ((!!aiSummary || !!aiSummaryStructured) && aiPromptUsed === prompt)}
              >
                {aiGenerating ? 'Generating…' : (((!!aiSummary || !!aiSummaryStructured) && aiPromptUsed === prompt) ? 'Summary cached' : 'Generate AI summary')}
              </Button>
              {aiGenerating && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    try { abortRef.current?.abort(); } catch { }
                  }}
                >
                  Stop
                </Button>
              )}
            </div>
            {aiError && <div className="text-sm text-red-600 mb-2">{aiError}</div>}
            {Array.isArray(aiSummaryStructured) && aiSummaryStructured.length > 0 ? (
              <div className="mb-4 p-3 border rounded bg-white text-sm max-h-80 overflow-auto">
                <ul className="space-y-2">
                  {aiSummaryStructured.map((item, idx) => {
                    const ids: string[] = Array.isArray(item?.sourceId) ? item.sourceId : [];
                    const postId = ids[0];
                    const commentId = ids[1];
                    const href = commentId
                      ? `https://www.reddit.com/r/${params.subreddit}/comments/${postId}/comment/${commentId}`
                      : `https://www.reddit.com/r/${params.subreddit}/comments/${postId}`;
                    return (
                      <li key={idx} className="border rounded p-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium">{item?.title || 'Untitled'}</div>
                            {item?.desc && <div className="text-gray-700 whitespace-pre-wrap">{item.desc}</div>}
                          </div>
                          {postId && (
                            <Link href={href} target="_blank" className="shrink-0 text-blue-600 text-xs underline">
                              Open
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              aiSummary && (
                <div className="mb-4 p-3 border rounded bg-white text-sm max-h-80 overflow-auto">
                  {aiSummary}
                </div>
              )
            )}
            <RedditThreads subreddit={params.subreddit} posts={data.researchInfo?.top_posts ?? []} />
          </>
        )}
      </div>
    </div>
  );
}
