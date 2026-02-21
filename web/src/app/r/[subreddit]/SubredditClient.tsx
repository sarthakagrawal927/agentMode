'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ChevronDown, ExternalLink, Settings, Sparkles, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AuthUser, getStoredUser, getAuthHeaders } from '@/lib/auth';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_ADMIN_EMAIL = 'sarthakagrawal927@gmail.com';
const ADMIN_EMAILS = new Set(
  [
    FALLBACK_ADMIN_EMAIL,
    process.env.NEXT_PUBLIC_ADMIN_EMAIL || '',
    process.env.NEXT_PUBLIC_ADMIN_EMAILS || '',
  ]
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

const PERIOD_MAP: Record<string, string> = {
  day: '1d',
  week: '1week',
};

const PERIOD_SLUGS = [
  { slug: 'day', label: 'Day' },
  { slug: 'week', label: 'Week' },
];

type SummaryItem = {
  title?: string;
  desc?: string;
  sourceId?: string[];
};

type SummaryStructured = {
  key_trend?: SummaryItem;
  notable_discussions: SummaryItem[];
  key_action?: SummaryItem;
};

type PostComment = {
  id?: string;
  body?: string;
  score?: number;
};

type ResearchPost = {
  id?: string;
  title?: string;
  selftext?: string;
  score?: number;
  comments?: PostComment[];
};

interface SubredditClientProps {
  subreddit: string;
  initialResearch: any | null;
  initialPrompt: { prompt: string; isDefault: boolean } | null;
  period: string;
  isArchive: boolean;
}

function toDisplayDate(dateText: string): string {
  if (!DATE_REGEX.test(dateText)) return dateText;
  const [y, m, d] = dateText.split('-');
  return `${d}/${m}/${y}`;
}

function toSourceLink(subreddit: string, sourceId: unknown): string | null {
  if (!Array.isArray(sourceId) || sourceId.length === 0) return null;
  const postId = sourceId[0];
  const commentId = sourceId[1];
  if (typeof postId !== 'string' || !postId.trim()) return null;
  if (typeof commentId === 'string' && commentId.trim()) {
    return `https://www.reddit.com/r/${subreddit}/comments/${postId}/comment/${commentId}`;
  }
  return `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
}

function extractTakeaway(summaryText: string): string | null {
  const normalized = summaryText.trim();
  if (!normalized) return null;
  const firstParagraph = normalized.split(/\n+/)[0]?.trim();
  return firstParagraph || null;
}

function normalizeSummaryItem(value: unknown): SummaryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = `${raw.title ?? ''}`.trim();
  const desc = `${raw.desc ?? ''}`.trim();
  if (!title && !desc) return null;
  const sourceId = Array.isArray(raw.sourceId)
    ? raw.sourceId.map((item) => `${item ?? ''}`.trim()).filter(Boolean).slice(0, 2)
    : [];
  return { title, desc, sourceId };
}

function deriveKeyActionFromItem(item: SummaryItem | null): SummaryItem | null {
  if (!item) return null;
  const desc = `${item.desc || item.title || ''}`.trim();
  if (!desc) return null;
  return {
    title: 'Key Action',
    desc,
    sourceId: Array.isArray(item.sourceId) ? item.sourceId : undefined,
  };
}

function normalizeSummaryStructured(value: unknown): SummaryStructured | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeSummaryItem(item))
      .filter((item): item is SummaryItem => !!item);
    if (items.length === 0) return null;
    const first = items[0];
    const last = items.length > 1 ? items[items.length - 1] : undefined;
    const middle = items.length > 2 ? items.slice(1, items.length - 1) : [];
    const derivedAction =
      deriveKeyActionFromItem(last && last !== first ? last : null) ||
      deriveKeyActionFromItem(items[items.length - 1] || null) ||
      deriveKeyActionFromItem(first || null);
    return {
      key_trend: first,
      notable_discussions: middle,
      key_action: derivedAction || undefined,
    };
  }

  if (typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const keyTrend = normalizeSummaryItem(raw.key_trend || raw.overview);
  const keyAction = normalizeSummaryItem(
    raw.key_action || raw.actionable_takeaway || raw.action_item,
  );
  const notableRaw = Array.isArray(raw.notable_discussions)
    ? raw.notable_discussions
    : Array.isArray(raw.discussion_points)
      ? raw.discussion_points
      : [];
  const notable = notableRaw
    .map((item) => normalizeSummaryItem(item))
    .filter((item): item is SummaryItem => !!item);
  const finalKeyAction =
    keyAction ||
    (notable.length > 0 ? deriveKeyActionFromItem(notable[notable.length - 1] || null) : null) ||
    deriveKeyActionFromItem(keyTrend);

  if (!keyTrend && !finalKeyAction && notable.length === 0) return null;
  return {
    key_trend: keyTrend || undefined,
    notable_discussions: notable,
    key_action: finalKeyAction || undefined,
  };
}

function sanitizeSummaryJsonCandidate(input: string): string {
  return input.replace(/"sourceId"\s*:\s*\[([^\]]*)\]/g, (_match, inner: string) => {
    const parts = `${inner}`
      .split(',')
      .map((part) => `${part}`.trim())
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => {
        const quotedDouble = part.startsWith('"') && part.endsWith('"');
        const quotedSingle = part.startsWith("'") && part.endsWith("'");
        if (quotedDouble || quotedSingle) return JSON.stringify(part.slice(1, -1).trim());
        return JSON.stringify(part);
      });
    return `"sourceId":[${parts.join(',')}]`;
  });
}

function parseSummaryJsonCandidate(candidate: string): SummaryStructured | null {
  const attempts = [candidate, sanitizeSummaryJsonCandidate(candidate)];
  for (const raw of attempts) {
    try {
      const structured = normalizeSummaryStructured(JSON.parse(raw));
      if (structured) return structured;
    } catch {
      // Try next attempt.
    }
  }
  return null;
}

function looksLikeJsonBlob(text: string): boolean {
  const normalized = `${text}`.trim();
  if (!normalized) return false;
  if (normalized.startsWith('{') || normalized.startsWith('[')) return true;
  if (normalized.includes('"key_trend"')) return true;
  if (normalized.includes('"notable_discussions"')) return true;
  if (normalized.includes('"key_action"')) return true;
  return false;
}

function isStructuredSummaryMalformed(value: SummaryStructured | null): boolean {
  if (!value) return false;
  if (looksLikeJsonBlob(`${value.key_trend?.desc || ''}`)) return true;
  if (looksLikeJsonBlob(`${value.key_action?.desc || ''}`)) return true;
  return false;
}

function parseSummaryTextAsStructured(text: string): SummaryStructured | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsedDirect = parseSummaryJsonCandidate(withoutFences);
  if (parsedDirect) return parsedDirect;

  {
    const firstBrace = withoutFences.indexOf('{');
    const lastBrace = withoutFences.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const parsedCandidate = parseSummaryJsonCandidate(
        withoutFences.slice(firstBrace, lastBrace + 1),
      );
      if (parsedCandidate) return parsedCandidate;
    }

    const lines = withoutFences
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const bullets = lines
      .filter((line) => /^[-*•]\s+/.test(line))
      .map((line) => line.replace(/^[-*•]\s+/, '').trim())
      .filter(Boolean);
    const paragraphs = withoutFences
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (bullets.length === 0 && paragraphs.length === 0) return null;

    const actionPrefix = /^(key action|actionable takeaway|next step|action item)\s*[:\-]\s*/i;
    const actionLine = lines.find((line) => actionPrefix.test(line));
    const actionText = actionLine ? actionLine.replace(actionPrefix, '').trim() : '';
    const notableRaw = (bullets.length > 0 ? bullets : paragraphs.slice(1)).slice(0, 6);
    const notable = notableRaw
      .map((entry, idx) => {
        const colon = entry.indexOf(':');
        if (colon > 0 && colon < 80) {
          return normalizeSummaryItem({
            title: entry.slice(0, colon).trim(),
            desc: entry.slice(colon + 1).trim(),
          });
        }
        return normalizeSummaryItem({ title: `Discussion ${idx + 1}`, desc: entry });
      })
      .filter((item): item is SummaryItem => !!item);

    return normalizeSummaryStructured({
      key_trend: normalizeSummaryItem({
        title: 'Key Trend',
        desc: paragraphs[0] || bullets[0] || '',
      }),
      notable_discussions: notable,
      key_action: actionText
        ? normalizeSummaryItem({ title: 'Key Action', desc: actionText })
        : undefined,
    });
  }
}

function resolveStructuredSummary(data: any): SummaryStructured | null {
  const normalized = normalizeSummaryStructured(data?.ai_summary_structured);
  if (normalized && !isStructuredSummaryMalformed(normalized)) return normalized;
  if (typeof data?.ai_summary === 'string') {
    const parsed = parseSummaryTextAsStructured(data.ai_summary);
    if (parsed) return parsed;
  }
  return normalized;
}

export default function SubredditClient({
  subreddit,
  initialResearch,
  initialPrompt,
  period,
  isArchive,
}: SubredditClientProps) {
  const [researchInfo, setResearchInfo] = useState<any>(initialResearch);
  const [postsLoading, setPostsLoading] = useState(!initialResearch);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>(initialPrompt?.prompt || '');
  const [savingPrompt, setSavingPrompt] = useState<boolean>(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string>(() => {
    if (initialResearch && typeof initialResearch.ai_summary === 'string') {
      const parsed = parseSummaryTextAsStructured(initialResearch.ai_summary);
      if (parsed) return '';
      return initialResearch.ai_summary;
    }
    return '';
  });
  const [aiSummaryStructured, setAiSummaryStructured] = useState<SummaryStructured | null>(() => {
    if (!initialResearch) return null;
    return resolveStructuredSummary(initialResearch);
  });
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';
  const [promptDialogOpen, setPromptDialogOpen] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const isAdmin = !!authUser?.email && ADMIN_EMAILS.has(authUser.email.toLowerCase());

  useEffect(() => {
    setAuthUser(getStoredUser());
    setIsHydrated(true);
    const interval = setInterval(() => {
      setAuthUser(getStoredUser());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (researchInfo || !isHydrated) return;
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
          const structured = resolveStructuredSummary(data);
          setAiSummaryStructured(structured);
          if (structured) {
            setAiSummary('');
          } else if (typeof data.ai_summary === 'string') {
            setAiSummary(data.ai_summary);
          }
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
  }, [subreddit, period, isHydrated]);

  if (error) return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-[#2c1520] bg-[#14090f] px-4 py-3 text-red-300">{error}</div>
    </main>
  );

  const generateButtonLabel = aiGenerating
    ? 'Generating...'
    : 'Regenerate Summary';

  const generateDisabled = aiGenerating;

  const handleGenerate = async () => {
    try {
      setAiSummary('');
      setAiSummaryStructured(null);
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
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText || `Failed with ${resp.status}`);
      }
      const bodyText = await resp.text();
      const structured = parseSummaryTextAsStructured(bodyText);
      if (structured) {
        setAiSummaryStructured(structured);
        setAiSummary('');
      } else {
        setAiSummary(bodyText.trim());
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

  const posts: ResearchPost[] = Array.isArray(researchInfo?.top_posts) ? researchInfo.top_posts : [];
  const topSources = [...posts]
    .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)))
    .slice(0, 8);
  const keyTrend = aiSummaryStructured?.key_trend;
  const notableDiscussions = (aiSummaryStructured?.notable_discussions || []).slice(0, 6);
  const keyAction = aiSummaryStructured?.key_action;
  const fallbackSummary = aiSummary.trim();
  const actionableTakeaway = keyAction?.desc || extractTakeaway(fallbackSummary);
  const keyActionSourceHref = toSourceLink(subreddit, keyAction?.sourceId);

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-2xl border border-[#18253b] bg-[#060b14] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="border-b border-[#142137] px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[#6f86ad]">r/{subreddit}</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-[#f4f8ff]">Summary</h1>
            </div>
            {isAdmin && !isArchive && (
              <Button
                onClick={() => setPromptDialogOpen(true)}
                variant="outline"
                className="h-10 rounded-md border-[#22375a] bg-[#0b1526] px-3 text-[#d7e6ff] hover:bg-[#10203a] hover:text-[#eff5ff]"
              >
                <Settings size={14} className="mr-1.5" />
                Prompt
              </Button>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {isArchive && (
              <span className="rounded-md border border-[#564111] bg-[#251c07] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#f3c770]">
                Archived: {toDisplayDate(period)}
              </span>
            )}

            {/* Date navigation is temporarily disabled */}

            {!isArchive && researchInfo?.cachedAt && (
              <span className="text-xs text-[#5f769e]">
                Updated {new Date(researchInfo.cachedAt).toLocaleString()}
              </span>
            )}

            <div className="ml-auto flex items-center rounded-lg border border-[#1f2f4a] bg-[#09121f] p-1">
              {PERIOD_SLUGS.map(({ slug, label }) => (
                <Link
                  key={slug}
                  href={`/r/${subreddit}/${slug}`}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    period === slug
                      ? 'bg-[#2f75ff] text-white'
                      : 'text-[#8da3c5] hover:bg-[#12233f] hover:text-[#e7f0ff]'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {aiError && <div className="mt-3 text-sm text-[#ff9a9a]">{aiError}</div>}
        </div>

        {postsLoading || (!researchInfo && isHydrated) ? (
          <div className="grid grid-cols-1 gap-5 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[420px] animate-pulse rounded-xl bg-[#0d1626]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            <section className="rounded-xl border border-[#1a2940] bg-[#070f1b] p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#6ea8ff]" />
                <h2 className="text-3xl font-semibold tracking-tight text-[#f3f8ff]">Daily Insights</h2>
              </div>

              <div className="mt-7 space-y-7">
                <section>
                  <h3 className="text-[1.35rem] font-semibold tracking-tight text-[#edf4ff]">
                    {keyTrend?.title || 'Key Trends in Engineering Culture'}
                  </h3>
                  <p className="mt-3 text-[1.03rem] leading-relaxed text-[#becde7]">
                    {keyTrend?.desc || fallbackSummary || 'No summary available for this snapshot.'}
                  </p>
                </section>

                <section>
                  <h3 className="text-[1.35rem] font-semibold tracking-tight text-[#edf4ff]">Notable Discussions</h3>
                  {notableDiscussions.length > 0 ? (
                    <ul className="mt-3 space-y-3 text-[1.02rem] text-[#becde7]">
                      {notableDiscussions.map((item, idx) => {
                        const sourceHref = toSourceLink(subreddit, item?.sourceId);
                        return (
                          <li key={`${item?.title || 'summary'}-${idx}`} className="flex gap-3">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6ea8ff]" />
                            <p className="leading-relaxed">
                              <span className="font-semibold text-[#e4eeff]">{item?.title || 'Untitled'}:</span>{' '}
                              {item?.desc || 'No detail provided.'}
                              {sourceHref && (
                                <>
                                  {' '}
                                  <Link
                                    href={sourceHref}
                                    target="_blank"
                                    className="inline-flex items-center gap-1 text-[#7db0ff] hover:text-[#9ec3ff]"
                                  >
                                    from r/{subreddit}
                                    <ExternalLink size={12} />
                                  </Link>
                                </>
                              )}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[1.02rem] leading-relaxed text-[#8da2c4]">
                      No structured discussion highlights are available yet.
                    </p>
                  )}
                </section>

                {actionableTakeaway && (
                  <section className="rounded-lg border border-[#20406b] bg-[#081831] p-4">
                    <h4 className="text-lg font-semibold text-[#8fbfff]">{keyAction?.title || 'Key Action'}</h4>
                    <p className="mt-2 text-[1.02rem] leading-relaxed text-[#c8daf6]">{actionableTakeaway}</p>
                    {keyActionSourceHref && (
                      <Link
                        href={keyActionSourceHref}
                        target="_blank"
                        className="mt-2 inline-flex items-center gap-1 text-sm text-[#7db0ff] hover:text-[#9ec3ff]"
                      >
                        View source
                        <ExternalLink size={12} />
                      </Link>
                    )}
                  </section>
                )}
              </div>

              <div className="mt-8 border-t border-[#15263e] pt-5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isAdmin && !isArchive ? (
                    <>
                      {aiGenerating && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => { try { abortRef.current?.abort(); } catch { } }}
                          className="h-10 rounded-md px-4"
                        >
                          <Square size={14} className="mr-1.5" />
                          Stop
                        </Button>
                      )}
                      <Button
                        onClick={handleGenerate}
                        disabled={generateDisabled}
                        className="h-10 rounded-md bg-[#2f75ff] px-5 text-sm font-medium text-white hover:bg-[#2a67df]"
                      >
                        <Sparkles size={14} className="mr-2" />
                        {generateButtonLabel}
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-[#6f86ad]">
                      {isArchive ? 'Archive view is read-only.' : 'Admin access is required to regenerate summary.'}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <aside className="overflow-hidden rounded-xl border border-[#1a2940] bg-[#070f1b]">
              <div className="flex items-center justify-between border-b border-[#142137] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8ea3c7]">Top Sources</p>
                <p className="text-xs text-[#5f769e]">Sorted by Impact</p>
              </div>

              <div className="max-h-[720px] overflow-auto">
                {topSources.length > 0 ? (
                  topSources.map((post, idx) => {
                    const title = post?.title || 'Untitled source';
                    const score = Math.round(Number(post?.score || 0));
                    const sourceUrl = post?.id
                      ? `https://www.reddit.com/r/${subreddit}/comments/${post.id}`
                      : null;
                    const topComment = Array.isArray(post?.comments) ? post.comments[0] : null;

                    return (
                      <details
                        key={`${post?.id || 'post'}-${idx}`}
                        className="border-b border-[#142137] px-4 py-3 last:border-b-0"
                      >
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-lg font-medium leading-snug text-[#eef5ff]">{title}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <p className="text-sm text-[#8fa5c8]">Score: {score} • Reddit r/{subreddit}</p>
                              {sourceUrl && (
                                <Link
                                  href={sourceUrl}
                                  target="_blank"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs text-[#7db0ff] hover:text-[#9ec3ff]"
                                >
                                  Open post
                                  <ExternalLink size={12} />
                                </Link>
                              )}
                            </div>
                          </div>
                          <ChevronDown size={16} className="mt-1 shrink-0 text-[#6f86ad]" />
                        </summary>

                        <div className="space-y-3 pb-1 pt-3 text-sm text-[#c4d3ec]">
                          {post?.selftext ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{post.selftext}</p>
                          ) : (
                            <p className="leading-relaxed text-[#8da2c4]">No post body available.</p>
                          )}

                          {topComment?.body && (
                            <p className="rounded-md border border-[#183152] bg-[#0a1527] p-3 leading-relaxed text-[#b8cae8]">
                              <span className="font-semibold text-[#dce8ff]">Top comment:</span> {topComment.body}
                            </p>
                          )}

                          {sourceUrl && (
                            <Link
                              href={sourceUrl}
                              target="_blank"
                              className="inline-flex items-center gap-1 text-[#7db0ff] hover:text-[#9ec3ff]"
                            >
                              Open thread
                              <ExternalLink size={13} />
                            </Link>
                          )}
                        </div>
                      </details>
                    );
                  })
                ) : (
                  <div className="px-4 py-6 text-sm text-[#8da2c4]">No sources available for this period.</div>
                )}
              </div>
            </aside>
          </div>
        )}
      </section>

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
