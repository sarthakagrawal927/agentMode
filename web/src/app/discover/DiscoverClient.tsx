'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExternalLink, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type Duration = '1d' | '1week';

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

type FeedItem = {
  subreddit: string;
  period: Duration;
  cachedAt?: string;
  ai_summary_structured?: SummaryStructured | SummaryItem[];
  ai_summary?: string;
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

const DURATION_SLUGS: Record<string, string> = {
  '1d': 'day',
  '1week': 'week',
};

const DURATIONS = [
  { value: '1d' as Duration, label: 'Day' },
  { value: '1week' as Duration, label: 'Week' },
];

function normalizeSummaryItem(value: unknown): SummaryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = `${raw.title ?? ''}`.trim();
  const desc = `${raw.desc ?? ''}`.trim();
  if (!title && !desc) return null;
  return { title, desc };
}

function deriveKeyActionFromItem(item: SummaryItem | null): SummaryItem | null {
  if (!item) return null;
  const desc = `${item.desc || item.title || ''}`.trim();
  if (!desc) return null;
  return { title: 'Key Action', desc };
}

function normalizeStructured(value: unknown): SummaryStructured | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeSummaryItem(item))
      .filter((item): item is SummaryItem => !!item);
    if (items.length === 0) return null;
    const first = items[0];
    const last = items.length > 1 ? items[items.length - 1] : undefined;
    const derivedAction =
      deriveKeyActionFromItem(last && last !== first ? last : null) ||
      deriveKeyActionFromItem(items[items.length - 1] || null) ||
      deriveKeyActionFromItem(first || null);
    return {
      key_trend: first,
      notable_discussions: items.slice(1, Math.max(1, items.length - 1)),
      key_action: derivedAction || undefined,
    };
  }
  if (typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const notableRaw = Array.isArray(raw.notable_discussions) ? raw.notable_discussions : [];
  const notable = notableRaw
    .map((item) => normalizeSummaryItem(item))
    .filter((item): item is SummaryItem => !!item);
  const keyTrend = normalizeSummaryItem(raw.key_trend);
  const keyAction = normalizeSummaryItem(raw.key_action);
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
      const structured = normalizeStructured(JSON.parse(raw));
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
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return parseSummaryJsonCandidate(withoutFences.slice(firstBrace, lastBrace + 1));
  }
  return null;
}

function previewItems(item: FeedItem): SummaryItem[] {
  const normalized = normalizeStructured(item.ai_summary_structured);
  const structured =
    (normalized && !isStructuredSummaryMalformed(normalized)
      ? normalized
      : null) ||
    (typeof item.ai_summary === 'string'
      ? parseSummaryTextAsStructured(item.ai_summary)
      : null) ||
    normalized;
  if (!structured) return [];
  const list: SummaryItem[] = [];
  if (structured.key_trend) list.push(structured.key_trend);
  list.push(...structured.notable_discussions);
  if (structured.key_action) list.push(structured.key_action);
  return list.slice(0, 4);
}

interface DiscoverClientProps {
  initialItems: FeedItem[];
  initialDuration: Duration;
}

export default function DiscoverClient({ initialItems, initialDuration }: DiscoverClientProps) {
  const [duration, setDuration] = useState<Duration>(initialDuration);
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (duration === initialDuration && items.length > 0) return;

    const fetchFeed = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${API_BASE_URL}/research/subreddit/feed?duration=${duration}`,
          { cache: 'no-store' },
        );
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  return (
    <main className="container mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
          <p className="text-muted-foreground mt-1">Browse AI-powered summaries from tracked communities</p>
        </div>
        <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
          {DURATIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setDuration(value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                duration === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-80 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      )}

      {error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No cached posts found for this period.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item) => {
          const preview = previewItems(item);
          const hasStructured = preview.length > 0;
          const hasSummary = typeof item.ai_summary === 'string' && item.ai_summary.trim().length > 0;
          const hasTopPosts = Array.isArray(item.top_posts) && item.top_posts.length > 0;
          const slug = DURATION_SLUGS[item.period] || 'week';

          return (
            <Link
              key={`${item.subreddit}-${item.period}`}
              href={`/r/${item.subreddit}/${slug}`}
              className="group block"
            >
              <div className="h-80 flex flex-col border rounded-xl bg-card hover:border-foreground/20 hover:shadow-md transition-all overflow-hidden">
                <div className="px-4 pt-4 pb-2 shrink-0">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className="font-medium">r/{item.subreddit}</Badge>
                    <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {item.cachedAt && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {new Date(item.cachedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>

                <div className="px-4 pb-4 flex-1 overflow-hidden relative">
                  {hasStructured ? (
                    <ul className="space-y-2">
                      {preview.map((s, idx) => (
                        <li key={idx} className="text-sm">
                          <div className="font-medium truncate">{s?.title || 'Untitled'}</div>
                          {s?.desc && <div className="text-muted-foreground line-clamp-2 text-xs mt-0.5">{s.desc}</div>}
                        </li>
                      ))}
                    </ul>
                  ) : hasSummary ? (
                    <div className="prose prose-sm max-h-full overflow-hidden text-sm text-muted-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.ai_summary!}</ReactMarkdown>
                    </div>
                  ) : hasTopPosts ? (
                    <ul className="space-y-1.5">
                      {item.top_posts!.slice(0, 5).map((p, idx) => (
                        <li key={idx} className="text-sm truncate">{p.title}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-muted-foreground">No posts available.</div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
