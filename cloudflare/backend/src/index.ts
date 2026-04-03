import { createClient, type Client } from "@libsql/client";
import promptDefaultsRaw from "../prompts.json";

type JsonRecord = Record<string, unknown>;

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
  OPENAI_API_KEY: string;
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_EMAILS?: string;
  RESEND_API_KEY?: string;
};

type RedditComment = {
  id: string | null;
  opId: string | null;
  body: string;
  score: number;
  replies: RedditComment[];
};

type RedditPost = {
  id: string | null;
  title: string;
  selftext: string;
  score: number;
  comments: RedditComment[];
};

const SUBREDDIT_CACHE_NAMESPACE = "subreddit_research";
const ONE_DAY_TTL_SECONDS = 24 * 60 * 60;
const SUMMARY_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const EMPTY_POSTS_REFRESH_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PROMPT =
  "Analyze top posts and comments for r/{subreddit}. Summarize key themes, actionable insights, and representative quotes.";

const PROMPT_DEFAULTS = normalizePromptDefaults(promptDefaultsRaw as JsonRecord);
const ALLOWED_SUBREDDITS = new Set(
  Object.keys(PROMPT_DEFAULTS).map((item) => item.toLowerCase()),
);

const CORS_BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const DB_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cache_entries (
    namespace TEXT NOT NULL,
    key       TEXT NOT NULL,
    data      TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE (namespace, key)
  )`,
  `CREATE TABLE IF NOT EXISTS prompts (
    subreddit TEXT UNIQUE NOT NULL,
    prompt    TEXT        NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    subreddit  TEXT NOT NULL,
    snap_date  TEXT NOT NULL,
    period     TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (subreddit, snap_date, period)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_sub_date
    ON snapshots (subreddit, snap_date DESC)`,
  `CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    name       TEXT,
    picture    TEXT,
    plan       TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tracked_subreddits (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    subreddit  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (user_id, subreddit)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_user
    ON tracked_subreddits (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_subreddit
    ON tracked_subreddits (subreddit)`,
  `CREATE TABLE IF NOT EXISTS digest_preferences (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    tracked_subreddit_id TEXT NOT NULL,
    channel              TEXT NOT NULL DEFAULT 'email',
    frequency            TEXT NOT NULL DEFAULT 'daily',
    enabled              INTEGER DEFAULT 1,
    last_sent_at         TEXT,
    created_at           TEXT DEFAULT (datetime('now')),
    UNIQUE (user_id, tracked_subreddit_id, channel)
  )`,
];

const PLAN_LIMITS: Record<string, number> = {
  free: 1,
  pro: 999,
  team: 999,
};

let dbInitPromise: Promise<void> | null = null;
let redditTokenCache: { token: string; expiresAtMs: number } | null = null;

// --------------- In-memory rate limiter ---------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_RESEARCH = 10; // /api/research/subreddit
const RATE_LIMIT_DEFAULT = 30; // all other endpoints

type RateBucket = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateBucket>();

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const key = `${ip}:${limit}`;
  const bucket = rateLimitMap.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

// Periodic cleanup to avoid unbounded memory growth
let lastRateLimitCleanup = Date.now();
function cleanupRateLimits(): void {
  const now = Date.now();
  if (now - lastRateLimitCleanup < RATE_LIMIT_WINDOW_MS) return;
  lastRateLimitCleanup = now;
  for (const [key, bucket] of rateLimitMap) {
    if (now >= bucket.resetAt) rateLimitMap.delete(key);
  }
}

class HttpError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : "HTTP error");
    this.status = status;
    this.detail = detail;
  }
}

function normalizePromptDefaults(raw: JsonRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = `${key}`.trim();
    const normalizedValue = `${value ?? ""}`.trim();
    if (normalizedKey && normalizedValue) {
      out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

function mergeHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(CORS_BASE_HEADERS);
  if (extra) {
    new Headers(extra).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: mergeHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function textResponse(
  content: string,
  contentType = "text/plain; charset=utf-8",
  status = 200,
): Response {
  return new Response(content, {
    status,
    headers: mergeHeaders({ "Content-Type": contentType }),
  });
}

function noContent(status = 204): Response {
  return new Response(null, { status, headers: mergeHeaders() });
}

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const asString = `${value}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  return null;
}

function parseJsonColumn(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

const SUBREDDIT_NAME_RE = /^[A-Za-z0-9_]{1,21}$/;

function normalizeSubredditName(input: unknown): string {
  const raw = `${input ?? ""}`.trim();
  if (!raw) return "";
  const stripped = raw.replace(/^r\//i, "");
  if (!SUBREDDIT_NAME_RE.test(stripped)) {
    throw new HttpError(400, "Invalid subreddit name. Must be 1-21 alphanumeric/underscore characters.");
  }
  return stripped;
}

function normalizeDuration(input: unknown): "1d" | "1week" | "1month" {
  const raw = `${input ?? ""}`;
  if (raw === "1d" || raw === "1week" || raw === "1month") return raw;
  return "1week";
}

function normalizeSourceId(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((item) => `${item ?? ""}`.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (normalized.length === 0) return null;
  return normalized;
}

function normalizeSummaryLink(value: unknown): string | null {
  const raw = `${value ?? ""}`.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

function toRedditSourceLink(
  subreddit: string,
  sourceId: unknown,
): string | null {
  const normalized = normalizeSourceId(sourceId);
  if (!normalized || normalized.length === 0) return null;
  const postId = `${normalized[0] ?? ""}`.trim();
  const commentId = `${normalized[1] ?? ""}`.trim();
  if (!postId) return null;
  if (commentId) {
    return `https://www.reddit.com/r/${subreddit}/comments/${postId}/comment/${commentId}`;
  }
  return `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
}

function fallbackSourceIdFromTopPosts(topPosts: unknown): string[] | null {
  if (!Array.isArray(topPosts)) return null;
  for (const item of topPosts) {
    const post = asRecord(item);
    const id = `${post?.id ?? ""}`.trim();
    if (id) return [id];
  }
  return null;
}

function normalizeSummaryPoint(value: unknown): JsonRecord | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const title = `${rec.title ?? ""}`.trim();
  const desc = `${rec.desc ?? ""}`.trim();
  if (!title && !desc) return null;
  const sourceId = normalizeSourceId(rec.sourceId);
  const link = normalizeSummaryLink(rec.link);
  const out: JsonRecord = {};
  if (title) out.title = title;
  if (desc) out.desc = desc;
  if (sourceId) out.sourceId = sourceId;
  if (link) out.link = link;
  return out;
}

function deriveKeyActionFromPoint(point: JsonRecord | null): JsonRecord | null {
  if (!point) return null;
  const desc = `${point.desc ?? point.title ?? ""}`.trim();
  if (!desc) return null;
  return normalizeSummaryPoint({
    title: "Key Action",
    desc,
    sourceId: point.sourceId,
  });
}

function sanitizeSummaryJsonCandidate(input: string): string {
  return input.replace(
    /"sourceId"\s*:\s*\[([^\]]*)\]/g,
    (_match, inner: string) => {
      const parts = `${inner}`
        .split(",")
        .map((part) => `${part}`.trim())
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => {
          const quotedDouble = part.startsWith('"') && part.endsWith('"');
          const quotedSingle = part.startsWith("'") && part.endsWith("'");
          if (quotedDouble || quotedSingle) {
            return JSON.stringify(part.slice(1, -1).trim());
          }
          return JSON.stringify(part);
        });
      return `"sourceId":[${parts.join(",")}]`;
    },
  );
}

function parseSummaryJsonCandidate(candidate: string): JsonRecord | null {
  const attempts = [candidate, sanitizeSummaryJsonCandidate(candidate)];
  for (const raw of attempts) {
    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeSummaryStructured(parsed);
      if (normalized) return normalized;
    } catch {
      // Try next attempt.
    }
  }
  return null;
}

function normalizeSummaryStructured(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    const points = value
      .map((item) => normalizeSummaryPoint(item))
      .filter((item): item is JsonRecord => Boolean(item));
    if (points.length === 0) return null;

    const first = points[0];
    const last = points.length > 1 ? points[points.length - 1] : null;
    const middle =
      points.length > 2 ? points.slice(1, points.length - 1) : [];
    const derivedAction =
      deriveKeyActionFromPoint(last && last !== first ? last : null) ||
      deriveKeyActionFromPoint(points[points.length - 1] || null) ||
      deriveKeyActionFromPoint(first || null);
    return {
      key_trend: first,
      notable_discussions: middle,
      key_action: derivedAction || undefined,
    };
  }

  const rec = asRecord(value);
  if (!rec) return null;
  const keyTrend = normalizeSummaryPoint(rec.key_trend || rec.overview);
  const keyAction = normalizeSummaryPoint(
    rec.key_action || rec.actionable_takeaway || rec.action_item,
  );
  const notableRaw = Array.isArray(rec.notable_discussions)
    ? rec.notable_discussions
    : Array.isArray(rec.discussion_points)
      ? rec.discussion_points
      : [];
  const notable = notableRaw
    .map((item) => normalizeSummaryPoint(item))
    .filter((item): item is JsonRecord => Boolean(item));
  const fallbackFromNotable =
    notable.length > 0
      ? deriveKeyActionFromPoint(notable[notable.length - 1] || null)
      : null;
  const finalKeyAction = keyAction || fallbackFromNotable || deriveKeyActionFromPoint(keyTrend);

  if (!keyTrend && !finalKeyAction && notable.length === 0) return null;
  return {
    key_trend: keyTrend || undefined,
    notable_discussions: notable,
    key_action: finalKeyAction || undefined,
  };
}

function parseSummaryStructured(text: string): JsonRecord | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withoutFences = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsedDirect = parseSummaryJsonCandidate(withoutFences);
  if (parsedDirect) return parsedDirect;

  {
    const firstBrace = withoutFences.indexOf("{");
    const lastBrace = withoutFences.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = withoutFences.slice(firstBrace, lastBrace + 1).trim();
      const parsedCandidate = parseSummaryJsonCandidate(candidate);
      if (parsedCandidate) return parsedCandidate;
    }

    const actionPatterns = [
      /^key action\s*[:\-]\s*/i,
      /^actionable takeaway\s*[:\-]\s*/i,
      /^next step\s*[:\-]\s*/i,
      /^action item\s*[:\-]\s*/i,
    ];
    const cleanedLines = withoutFences
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const actionLine = cleanedLines.find((line) =>
      actionPatterns.some((pattern) => pattern.test(line)),
    );
    const cleanedAction = actionLine
      ? actionPatterns.reduce(
          (acc, pattern) => acc.replace(pattern, "").trim(),
          actionLine,
        )
      : "";

    const bulletLines = withoutFences
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*•]\s+/.test(line))
      .map((line) => line.replace(/^[-*•]\s+/, "").trim())
      .filter(Boolean)
      .filter((line) => !actionPatterns.some((pattern) => pattern.test(line)));
    const paragraphs = withoutFences
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (bulletLines.length === 0 && paragraphs.length === 0) return null;

    const notable = (bulletLines.length > 0 ? bulletLines : paragraphs.slice(1))
      .slice(0, 6)
      .map((line, idx) => {
        const colon = line.indexOf(":");
        if (colon > 0 && colon < 80) {
          return normalizeSummaryPoint({
            title: line.slice(0, colon).trim(),
            desc: line.slice(colon + 1).trim(),
          });
        }
        return normalizeSummaryPoint({
          title: `Discussion ${idx + 1}`,
          desc: line,
        });
      })
      .filter((item): item is JsonRecord => Boolean(item));

    const keyTrendDesc = paragraphs[0] || bulletLines[0] || "";
    const keyActionDesc =
      cleanedAction ||
      (paragraphs.length > 1
        ? paragraphs[paragraphs.length - 1]
        : bulletLines.length > 1
          ? bulletLines[bulletLines.length - 1]
          : "");

    const derived = {
      key_trend: normalizeSummaryPoint({
        title: "Key Trend",
        desc: keyTrendDesc,
      }),
      notable_discussions: notable,
      key_action: keyActionDesc
        ? normalizeSummaryPoint({ title: "Key Action", desc: keyActionDesc })
        : undefined,
    };
    return normalizeSummaryStructured(derived);
  }
}

function hasStructuredSummary(value: unknown): boolean {
  const rec = asRecord(value);
  if (!rec) return false;
  if (rec.key_trend) return true;
  if (Array.isArray(rec.notable_discussions) && rec.notable_discussions.length > 0)
    return true;
  if (rec.key_action) return true;
  return false;
}

function looksLikeJsonBlob(text: string): boolean {
  const normalized = `${text}`.trim();
  if (!normalized) return false;
  if (normalized.startsWith("{") || normalized.startsWith("[")) return true;
  if (normalized.includes('"key_trend"')) return true;
  if (normalized.includes('"notable_discussions"')) return true;
  if (normalized.includes('"key_action"')) return true;
  return false;
}

function isStructuredSummaryMalformed(value: unknown): boolean {
  const rec = asRecord(value);
  if (!rec) return false;
  const keyTrend = asRecord(rec.key_trend);
  const keyAction = asRecord(rec.key_action);
  const keyTrendDesc = `${keyTrend?.desc ?? ""}`.trim();
  const keyActionDesc = `${keyAction?.desc ?? ""}`.trim();
  if (looksLikeJsonBlob(keyTrendDesc) || looksLikeJsonBlob(keyActionDesc)) return true;
  return false;
}

function hydrateSummaryPointWithLink(
  point: unknown,
  subreddit: string,
  fallbackSourceId: string[] | null,
): JsonRecord | null {
  const normalized = normalizeSummaryPoint(point);
  if (!normalized) return null;
  const sourceId = normalizeSourceId(normalized.sourceId) || fallbackSourceId;
  const explicitLink = normalizeSummaryLink(normalized.link);
  const link = explicitLink || toRedditSourceLink(subreddit, sourceId);
  const out: JsonRecord = {
    ...normalized,
  };
  if (sourceId) out.sourceId = sourceId;
  if (link) out.link = link;
  return out;
}

function hydrateSummaryLinks(
  structured: unknown,
  subreddit: string,
  topPosts: unknown,
): JsonRecord | null {
  const normalized = normalizeSummaryStructured(structured);
  if (!normalized) return null;
  const fallbackSourceId = fallbackSourceIdFromTopPosts(topPosts);
  const keyTrend = hydrateSummaryPointWithLink(
    normalized.key_trend,
    subreddit,
    fallbackSourceId,
  );
  const notableRaw = Array.isArray(normalized.notable_discussions)
    ? normalized.notable_discussions
    : [];
  const notable = notableRaw
    .map((item) => hydrateSummaryPointWithLink(item, subreddit, fallbackSourceId))
    .filter((item): item is JsonRecord => Boolean(item));
  const keyAction = hydrateSummaryPointWithLink(
    normalized.key_action,
    subreddit,
    fallbackSourceId,
  );
  if (!keyTrend && !keyAction && notable.length === 0) return null;
  return {
    key_trend: keyTrend || undefined,
    notable_discussions: notable,
    key_action: keyAction || undefined,
  };
}

function truncateText(value: unknown, maxLen: number): string {
  const text = `${value ?? ""}`.trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function slimPayloadForModel(payload: JsonRecord): JsonRecord {
  const subreddit = truncateText(payload.subreddit, 120);
  const period = truncateText(payload.period, 32);
  const rawPosts = Array.isArray(payload.top_posts) ? payload.top_posts : [];

  const topPosts = rawPosts.slice(0, 12).map((item) => {
    const post = asRecord(item) || {};
    const rawComments = Array.isArray(post.comments) ? post.comments : [];
    const comments = rawComments.slice(0, 8).map((commentItem) => {
      const comment = asRecord(commentItem) || {};
      const rawReplies = Array.isArray(comment.replies) ? comment.replies : [];
      const replies = rawReplies.slice(0, 3).map((replyItem) => {
        const reply = asRecord(replyItem) || {};
        return {
          id: truncateText(reply.id, 64),
          score: Number(reply.score ?? 0),
          body: truncateText(reply.body, 280),
        };
      });
      return {
        id: truncateText(comment.id, 64),
        score: Number(comment.score ?? 0),
        body: truncateText(comment.body, 420),
        replies,
      };
    });

    return {
      id: truncateText(post.id, 64),
      title: truncateText(post.title, 280),
      selftext: truncateText(post.selftext, 1100),
      score: Number(post.score ?? 0),
      comments,
    };
  });

  return { subreddit, period, top_posts: topPosts };
}

async function parseRequestJson(request: Request): Promise<JsonRecord> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed) || {};
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function adminEmailSet(env: Env): Set<string> {
  const combined = `${env.ADMIN_EMAIL || ""},${env.ADMIN_EMAILS || ""}`;
  return new Set(
    combined
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function verifyGoogleToken(
  idToken: string,
): Promise<{ email: string; name?: string; picture?: string }> {
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("id_token", idToken);
  const resp = await fetch(tokenInfoUrl.toString(), { method: "GET" });
  if (!resp.ok) throw new HttpError(401, "Invalid Google token");
  const data = (await resp.json()) as JsonRecord;
  const email = `${data.email ?? ""}`.trim().toLowerCase();
  if (!email) throw new HttpError(401, "Google token missing email");
  return {
    email,
    name: `${data.name ?? ""}`.trim() || undefined,
    picture: `${data.picture ?? ""}`.trim() || undefined,
  };
}

async function requireAdmin(request: Request, env: Env): Promise<string> {
  const allowed = adminEmailSet(env);
  if (allowed.size === 0) {
    throw new HttpError(500, "Admin access is not configured on the server");
  }
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing Authorization header");
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) throw new HttpError(401, "Missing Authorization token");
  const info = await verifyGoogleToken(token);
  if (!allowed.has(info.email)) throw new HttpError(403, "Admin access required");
  return info.email;
}

type UserRow = { id: string; email: string; name: string | null; picture: string | null; plan: string };

async function requireUser(
  request: Request,
  env: Env,
): Promise<UserRow> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Missing Authorization header");
  const token = auth.slice("Bearer ".length).trim();
  if (!token) throw new HttpError(401, "Missing Authorization token");
  const info = await verifyGoogleToken(token);
  await ensureDbInitialized(env);
  const db = getDb(env);
  const existing = await db.execute({
    sql: "SELECT id, email, name, picture, plan FROM users WHERE email = ?",
    args: [info.email],
  });
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      id: `${row.id}`,
      email: `${row.email}`,
      name: row.name ? `${row.name}` : null,
      picture: row.picture ? `${row.picture}` : null,
      plan: `${row.plan || "free"}`,
    };
  }
  const userId = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO users (id, email, name, picture, plan) VALUES (?, ?, ?, ?, 'free')",
    args: [userId, info.email, info.name || null, info.picture || null],
  });
  return { id: userId, email: info.email, name: info.name || null, picture: info.picture || null, plan: "free" };
}

async function handleAuthSession(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return jsonResponse(user);
}

async function handleTrackSubreddit(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await parseRequestJson(request);
  const subreddit = normalizeSubredditName(body.subreddit);
  if (!subreddit) throw new HttpError(400, "Valid subreddit name required");

  const db = getDb(env);
  const countRes = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM tracked_subreddits WHERE user_id = ?",
    args: [user.id],
  });
  const count = Number(countRes.rows[0]?.count ?? 0);
  const limit = PLAN_LIMITS[user.plan] ?? 1;
  if (count >= limit) {
    throw new HttpError(403, `Free plan allows ${limit} tracked subreddit${limit === 1 ? "" : "s"}. Upgrade for more.`);
  }

  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO tracked_subreddits (id, user_id, subreddit) VALUES (?, ?, ?)
      ON CONFLICT (user_id, subreddit) DO NOTHING`,
    args: [id, user.id, subreddit],
  });
  return jsonResponse({ id, subreddit, created: true }, 201);
}

async function handleListTrackedSubreddits(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await ensureDbInitialized(env);
  const db = getDb(env);
  const res = await db.execute({
    sql: `SELECT ts.id, ts.subreddit, ts.created_at,
      (SELECT s.data FROM snapshots s WHERE s.subreddit = LOWER(ts.subreddit) ORDER BY s.created_at DESC LIMIT 1) AS latest_snapshot
      FROM tracked_subreddits ts WHERE ts.user_id = ? ORDER BY ts.created_at DESC`,
    args: [user.id],
  });
  const items = res.rows.map((row) => ({
    id: `${row.id}`,
    subreddit: `${row.subreddit}`,
    created_at: `${row.created_at}`,
    latest_snapshot: parseJsonColumn(row.latest_snapshot ?? null),
  }));
  return jsonResponse({ items, plan: user.plan, limit: PLAN_LIMITS[user.plan] ?? 1 });
}

async function handleUntrackSubreddit(request: Request, env: Env, trackId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const db = getDb(env);
  const res = await db.execute({
    sql: "DELETE FROM tracked_subreddits WHERE id = ? AND user_id = ? RETURNING id",
    args: [trackId, user.id],
  });
  if (res.rows.length === 0) throw new HttpError(404, "Tracked subreddit not found");
  // Also clean up digest preferences
  await db.execute({
    sql: "DELETE FROM digest_preferences WHERE tracked_subreddit_id = ? AND user_id = ?",
    args: [trackId, user.id],
  }).catch(() => undefined);
  return jsonResponse({ removed: true });
}

async function handleSaveDigestPreference(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await parseRequestJson(request);
  const trackedSubredditId = `${body.tracked_subreddit_id ?? ""}`.trim();
  if (!trackedSubredditId) throw new HttpError(400, "tracked_subreddit_id required");

  // Verify ownership
  const db = getDb(env);
  const ownership = await db.execute({
    sql: "SELECT id FROM tracked_subreddits WHERE id = ? AND user_id = ?",
    args: [trackedSubredditId, user.id],
  });
  if (ownership.rows.length === 0) throw new HttpError(404, "Tracked subreddit not found");

  const channel = `${body.channel ?? "email"}`.trim();
  if (channel !== "email" && channel !== "slack") throw new HttpError(400, "channel must be email or slack");
  const frequency = `${body.frequency ?? "daily"}`.trim();
  if (frequency !== "daily" && frequency !== "weekly") throw new HttpError(400, "frequency must be daily or weekly");
  const enabled = body.enabled !== false && body.enabled !== 0 ? 1 : 0;
  const slackWebhook = channel === "slack" ? `${body.slack_webhook_url ?? ""}`.trim() : null;
  if (channel === "slack" && !slackWebhook) throw new HttpError(400, "slack_webhook_url required for slack channel");

  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO digest_preferences (id, user_id, tracked_subreddit_id, channel, frequency, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, tracked_subreddit_id, channel)
      DO UPDATE SET frequency = EXCLUDED.frequency, enabled = EXCLUDED.enabled`,
    args: [id, user.id, trackedSubredditId, channel, frequency, enabled],
  });
  return jsonResponse({ id, channel, frequency, enabled: !!enabled }, 201);
}

async function handleListDigestPreferences(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await ensureDbInitialized(env);
  const db = getDb(env);
  const res = await db.execute({
    sql: `SELECT dp.id, dp.tracked_subreddit_id, dp.channel, dp.frequency, dp.enabled, dp.last_sent_at,
      ts.subreddit
      FROM digest_preferences dp
      JOIN tracked_subreddits ts ON ts.id = dp.tracked_subreddit_id
      WHERE dp.user_id = ?
      ORDER BY dp.created_at DESC`,
    args: [user.id],
  });
  const items = res.rows.map((row) => ({
    id: `${row.id}`,
    tracked_subreddit_id: `${row.tracked_subreddit_id}`,
    subreddit: `${row.subreddit}`,
    channel: `${row.channel}`,
    frequency: `${row.frequency}`,
    enabled: !!row.enabled,
    last_sent_at: row.last_sent_at ? `${row.last_sent_at}` : null,
  }));
  return jsonResponse({ items });
}

async function handleDeleteDigestPreference(request: Request, env: Env, prefId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const db = getDb(env);
  const res = await db.execute({
    sql: "DELETE FROM digest_preferences WHERE id = ? AND user_id = ? RETURNING id",
    args: [prefId, user.id],
  });
  if (res.rows.length === 0) throw new HttpError(404, "Digest preference not found");
  return jsonResponse({ removed: true });
}

async function sendResendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SubWatch Digest <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function buildDigestHtml(subreddit: string, snapshot: JsonRecord): string {
  const structured = asRecord(snapshot.ai_summary_structured);
  const keyTrend = asRecord(structured?.key_trend);
  const notable = Array.isArray(structured?.notable_discussions)
    ? structured.notable_discussions
    : [];
  const keyAction = asRecord(structured?.key_action);

  let html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">`;
  html += `<h2 style="color:#1a1a2e;">r/${subreddit} — AI Summary</h2>`;

  if (keyTrend) {
    html += `<h3 style="color:#16213e;">${keyTrend.title || "Key Trend"}</h3>`;
    html += `<p>${keyTrend.desc || ""}</p>`;
  }

  if (notable.length > 0) {
    html += `<h3 style="color:#16213e;">Notable Discussions</h3><ul>`;
    for (const item of notable) {
      const rec = asRecord(item);
      if (!rec) continue;
      html += `<li><strong>${rec.title || ""}</strong>: ${rec.desc || ""}</li>`;
    }
    html += `</ul>`;
  }

  if (keyAction) {
    html += `<h3 style="color:#16213e;">Key Action</h3>`;
    html += `<p>${keyAction.desc || ""}</p>`;
  }

  html += `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />`;
  html += `<p style="color:#888;font-size:12px;">Sent by SubWatch. <a href="https://agent-mode.vercel.app/dashboard">Manage preferences</a></p>`;
  html += `</div>`;
  return html;
}

function getDb(env: Env): Client {
  return createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
}

async function ensureDbInitialized(env: Env): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const db = getDb(env);
      for (const stmt of DB_SCHEMA_STATEMENTS) {
        await db.execute(stmt);
      }
      const countRes = await db.execute("SELECT COUNT(*) AS count FROM prompts");
      const count = Number(countRes.rows[0]?.count ?? 0);
      if (count > 0) return;
      for (const [subreddit, prompt] of Object.entries(PROMPT_DEFAULTS)) {
        await db.execute({
          sql: "INSERT INTO prompts (subreddit, prompt) VALUES (?, ?) ON CONFLICT (subreddit) DO NOTHING",
          args: [subreddit, prompt],
        });
      }
    })().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  await dbInitPromise;
}

async function getCache(
  env: Env,
  namespace: string,
  key: string,
): Promise<unknown | null> {
  await ensureDbInitialized(env);
  const db = getDb(env);
  const res = await db.execute({
    sql: "SELECT data FROM cache_entries WHERE namespace = ? AND key = ? AND expires_at > datetime('now')",
    args: [namespace, key],
  });
  if (res.rows.length === 0) return null;
  return parseJsonColumn(res.rows[0]?.data ?? null);
}

async function setCache(
  env: Env,
  namespace: string,
  key: string,
  data: unknown,
  ttlSeconds: number,
): Promise<void> {
  await ensureDbInitialized(env);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const db = getDb(env);
  await db.execute({
    sql: `INSERT INTO cache_entries (namespace, key, data, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (namespace, key)
      DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    args: [namespace, key, JSON.stringify(data), expiresAt],
  });
}

async function saveSnapshot(
  env: Env,
  subreddit: string,
  period: string,
  data: unknown,
): Promise<void> {
  await ensureDbInitialized(env);
  const today = new Date().toISOString().slice(0, 10);
  const db = getDb(env);
  await db.execute({
    sql: `INSERT INTO snapshots (subreddit, snap_date, period, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (subreddit, snap_date, period)
      DO UPDATE SET data = EXCLUDED.data`,
    args: [subreddit.trim().toLowerCase(), today, period, JSON.stringify(data)],
  });
}

async function getSnapshot(
  env: Env,
  subreddit: string,
  dateStr: string,
  period?: string,
): Promise<unknown | null> {
  await ensureDbInitialized(env);
  const db = getDb(env);
  const normalizedSubreddit = subreddit.trim().toLowerCase();
  const res = period
    ? await db.execute({
        sql: "SELECT data FROM snapshots WHERE subreddit = ? AND snap_date = ? AND period = ?",
        args: [normalizedSubreddit, dateStr, period],
      })
    : await db.execute({
        sql: "SELECT data FROM snapshots WHERE subreddit = ? AND snap_date = ? ORDER BY created_at DESC LIMIT 1",
        args: [normalizedSubreddit, dateStr],
      });
  if (res.rows.length === 0) return null;
  return parseJsonColumn(res.rows[0]?.data ?? null);
}

async function listSnapshotDates(env: Env, subreddit: string): Promise<string[]> {
  await ensureDbInitialized(env);
  const db = getDb(env);
  const res = await db.execute({
    sql: "SELECT DISTINCT snap_date FROM snapshots WHERE subreddit = ? ORDER BY snap_date DESC",
    args: [subreddit.trim().toLowerCase()],
  });
  return res.rows
    .map((row) => toIsoDate(row.snap_date))
    .filter((item): item is string => Boolean(item));
}

async function readPromptMap(env: Env): Promise<Record<string, string>> {
  await ensureDbInitialized(env);
  try {
    const db = getDb(env);
    const res = await db.execute("SELECT subreddit, prompt FROM prompts");
    const mapped: Record<string, string> = {};
    for (const row of res.rows) {
      const key = `${row.subreddit}`.trim();
      const value = `${row.prompt}`.trim();
      if (!key || !value) continue;
      mapped[key] = value;
    }
    const merged: Record<string, string> = { ...PROMPT_DEFAULTS };
    Object.assign(merged, mapped);
    return merged;
  } catch {
    return { ...PROMPT_DEFAULTS };
  }
}

async function writePromptMap(
  env: Env,
  subreddit: string,
  prompt: string,
): Promise<void> {
  await ensureDbInitialized(env);
  const db = getDb(env);
  await db.execute({
    sql: `INSERT INTO prompts (subreddit, prompt)
      VALUES (?, ?)
      ON CONFLICT (subreddit)
      DO UPDATE SET prompt = EXCLUDED.prompt`,
    args: [subreddit, prompt],
  });
}

async function getRedditAccessToken(env: Env): Promise<string> {
  if (redditTokenCache && redditTokenCache.expiresAtMs > Date.now() + 10_000) {
    return redditTokenCache.token;
  }
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const resp = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "web:agentdata:1.0 (by /u/agentdata_bot)",
    },
    body: body.toString(),
    redirect: "manual",
  });
  if (resp.status >= 300 && resp.status < 400) {
    throw new HttpError(502, "Reddit auth endpoint redirected — credentials may be invalid");
  }
  if (!resp.ok) {
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      throw new HttpError(502, `Reddit auth returned HTML (status ${resp.status}) — credentials may be invalid`);
    }
    const message = await resp.text();
    throw new HttpError(502, `Reddit auth failed (${resp.status}): ${message.slice(0, 200)}`);
  }
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    throw new HttpError(502, "Reddit auth returned HTML instead of JSON");
  }
  const data = (await resp.json()) as JsonRecord;
  const token = `${data.access_token ?? ""}`.trim();
  const expiresInSec = Number(data.expires_in ?? 3600);
  if (!token) throw new HttpError(502, `Reddit auth returned empty token (response keys: ${Object.keys(data).join(", ")})`);
  redditTokenCache = {
    token,
    expiresAtMs: Date.now() + Math.max(30, expiresInSec) * 1000,
  };
  return token;
}

async function redditGet(
  env: Env,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<unknown> {
  const perform = async (token: string): Promise<Response> => {
    const url = new URL(`https://oauth.reddit.com${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, `${value}`);
    }
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "web:agentdata:1.0 (by /u/agentdata_bot)",
      },
      redirect: "manual",
    });
  };

  let token = await getRedditAccessToken(env);
  let resp = await perform(token);
  // Reddit redirects to www.reddit.com on expired/invalid tokens — treat as 401
  if (resp.status === 401) {
    redditTokenCache = null;
    token = await getRedditAccessToken(env);
    resp = await perform(token);
  }
  // Redirect — could be auth issue or quarantined subreddit; retry with fresh token once
  if (resp.status >= 300 && resp.status < 400) {
    redditTokenCache = null;
    token = await getRedditAccessToken(env);
    // Retry following redirects this time (Reddit may redirect valid requests)
    const url = new URL(`https://oauth.reddit.com${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, `${value}`);
    }
    resp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "web:agentdata:1.0 (by /u/agentdata_bot)",
      },
    });
  }
  if (!resp.ok) {
    if (resp.status === 404) {
      throw new HttpError(404, `Subreddit not found on Reddit (r/${path.split("/")[2] || "unknown"})`);
    }
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      throw new HttpError(502, `Reddit API returned HTML (status ${resp.status}) — possible auth or subreddit issue`);
    }
    const message = await resp.text();
    throw new HttpError(502, `Reddit API failed (${resp.status}): ${message.slice(0, 200)}`);
  }
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    throw new HttpError(502, `Reddit API returned HTML instead of JSON — possible redirect`);
  }
  return resp.json();
}

async function getTopCommentsForPost(
  env: Env,
  subreddit: string,
  postId: string,
  commentThreshold: number,
  replyThreshold: number,
): Promise<RedditComment[]> {
  try {
    const response = await redditGet(env, `/r/${subreddit}/comments/${postId}`, {
      sort: "top",
      limit: 25,
      depth: 2,
      raw_json: 1,
    });
    if (!Array.isArray(response) || response.length < 2) return [];
    const commentsListing = asRecord(response[1]);
    const commentsData = asRecord(commentsListing?.data);
    const children = Array.isArray(commentsData?.children)
      ? commentsData?.children
      : [];

    const comments: RedditComment[] = [];
    for (const child of children) {
      const node = asRecord(child);
      if (!node || `${node.kind ?? ""}` !== "t1") continue;
      const data = asRecord(node.data);
      if (!data) continue;
      const topScore = Number(data.score ?? 0);
      if (topScore < commentThreshold) continue;

      const replies: RedditComment[] = [];
      const repliesListing = asRecord(data.replies);
      const repliesData = asRecord(repliesListing?.data);
      const replyChildren = Array.isArray(repliesData?.children)
        ? repliesData.children
        : [];
      for (const replyChild of replyChildren) {
        const replyNode = asRecord(replyChild);
        if (!replyNode || `${replyNode.kind ?? ""}` !== "t1") continue;
        const replyData = asRecord(replyNode.data);
        if (!replyData) continue;
        const replyScore = Number(replyData.score ?? 0);
        if (replyScore < replyThreshold) continue;
        replies.push({
          id: replyData.id ? `${replyData.id}` : null,
          opId: postId,
          body: `${replyData.body ?? ""}`,
          score: replyScore,
          replies: [],
        });
      }

      comments.push({
        id: data.id ? `${data.id}` : null,
        opId: postId,
        body: `${data.body ?? ""}`,
        score: topScore,
        replies,
      });
    }
    return comments;
  } catch {
    return [];
  }
}

async function getTopPostsForSubreddit(
  env: Env,
  subredditInput: string,
  limit = 20,
  duration: "1d" | "1week" | "1month" = "1week",
): Promise<RedditPost[]> {
  const subreddit = normalizeSubredditName(subredditInput);
  if (!subreddit) return [];

  let memberCount = 0;
  try {
    const about = await redditGet(env, `/r/${subreddit}/about`, { raw_json: 1 });
    const aboutRec = asRecord(about);
    const aboutData = asRecord(aboutRec?.data);
    memberCount = Number(aboutData?.subscribers ?? 0);
  } catch {
    memberCount = 0;
  }

  const logMembers = Math.log10(Math.max(1, memberCount));
  const commentThreshold = logMembers;
  const postThreshold = 2 * logMembers;
  const replyThreshold = 0.5 * logMembers;

  const durationMap: Record<
    "1d" | "1week" | "1month",
    { timeFilter: "day" | "week" | "month"; seconds: number }
  > = {
    "1d": { timeFilter: "day", seconds: 24 * 60 * 60 },
    "1week": { timeFilter: "week", seconds: 7 * 24 * 60 * 60 },
    "1month": { timeFilter: "month", seconds: 30 * 24 * 60 * 60 },
  };
  const config = durationMap[duration] || durationMap["1week"];
  const cutoffSeconds = Date.now() / 1000 - config.seconds;

  const listing = await redditGet(env, `/r/${subreddit}/top`, {
    t: config.timeFilter,
    limit: Math.max(5, limit * 2),
    raw_json: 1,
  });
  const listingRec = asRecord(listing);
  const listingData = asRecord(listingRec?.data);
  const children = Array.isArray(listingData?.children) ? listingData.children : [];

  const posts: RedditPost[] = [];
  const fallbackCandidates: Array<{
    id: string | null;
    title: string;
    selftext: string;
    score: number;
  }> = [];
  for (const child of children) {
    const node = asRecord(child);
    if (!node || `${node.kind ?? ""}` !== "t3") continue;
    const data = asRecord(node.data);
    if (!data) continue;

    const createdUtc = Number(data.created_utc ?? 0);
    if (createdUtc < cutoffSeconds) continue;

    const score = Number(data.score ?? 0);
    const postId = data.id ? `${data.id}` : null;
    const fallbackItem = {
      id: postId,
      title: `${data.title ?? ""}`,
      selftext: `${data.selftext ?? ""}`,
      score,
    };
    if (score < postThreshold) {
      fallbackCandidates.push(fallbackItem);
      continue;
    }

    const comments = postId
      ? await getTopCommentsForPost(
          env,
          subreddit,
          postId,
          commentThreshold,
          replyThreshold,
        )
      : [];

    posts.push({
      id: postId,
      title: fallbackItem.title,
      selftext: fallbackItem.selftext,
      score,
      comments,
    });

    if (posts.length >= limit) break;
  }

  if (posts.length < limit && fallbackCandidates.length > 0) {
    const existingIds = new Set(
      posts
        .map((item) => item.id)
        .filter((item): item is string => Boolean(item)),
    );
    for (const candidate of fallbackCandidates) {
      if (posts.length >= limit) break;
      if (candidate.id && existingIds.has(candidate.id)) continue;
      const comments = candidate.id
        ? await getTopCommentsForPost(
            env,
            subreddit,
            candidate.id,
            Math.max(1, commentThreshold * 0.5),
            Math.max(1, replyThreshold * 0.5),
          )
        : [];
      posts.push({
        id: candidate.id,
        title: candidate.title,
        selftext: candidate.selftext,
        score: candidate.score,
        comments,
      });
      if (candidate.id) existingIds.add(candidate.id);
    }
  }

  return posts;
}

async function generateSummaryText(
  env: Env,
  subreddit: string,
  duration: string,
  systemPrompt: string,
  redditPayload: JsonRecord,
): Promise<string> {
  const nowIso = new Date().toISOString();
  const periodLabel =
    duration === "1d"
      ? "last day"
      : duration === "1month"
        ? "last month"
        : "last week";
  const enrichedSystemPrompt = `${systemPrompt}

Context: Today is ${nowIso}. Data period: ${periodLabel} (key: ${duration}) for r/${subreddit}.

Key Rule: Give information, instead of telling what info the post gives.
Respond ONLY with a JSON object (no preamble, no code fences) in this exact shape:
{
  "key_trend": {"title": string, "desc": string, "sourceId": [postId, optionalCommentId]},
  "notable_discussions": [{"title": string, "desc": string, "sourceId": [postId, optionalCommentId]}],
  "key_action": {"title": "Key Action", "desc": string, "sourceId": [postId, optionalCommentId]}
}
Use exact IDs from the provided data. If referencing a post only, sourceId = [postId]. If referencing a specific comment, sourceId = [postId, commentId]. Keep notable_discussions between 3 and 6 items. No extra keys, no trailing commas.`;

  const openAiResp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: enrichedSystemPrompt },
        { role: "user", content: JSON.stringify(slimPayloadForModel(redditPayload)) },
      ],
      temperature: 0.1,
    }),
  });

  if (!openAiResp.ok) {
    const message = await openAiResp.text();
    throw new HttpError(502, `OpenAI request failed: ${message}`);
  }

  const openAiJson = (await openAiResp.json()) as JsonRecord;
  const choices = Array.isArray(openAiJson.choices) ? openAiJson.choices : [];
  const first = asRecord(choices[0]);
  const messageRec = asRecord(first?.message);
  const contentRaw = messageRec?.content;

  if (typeof contentRaw === "string") return contentRaw;
  if (Array.isArray(contentRaw)) {
    return contentRaw
      .map((item) => {
        const part = asRecord(item);
        return part?.text ? `${part.text}` : "";
      })
      .join("");
  }

  throw new HttpError(502, "OpenAI response did not contain summary content");
}

async function maybeAttachAiSummary(
  env: Env,
  subredditName: string,
  duration: "1d" | "1week" | "1month",
  baseCache: JsonRecord,
): Promise<JsonRecord> {
  const normalizedExisting = normalizeSummaryStructured(baseCache.ai_summary_structured);
  if (normalizedExisting) {
    const linkedExisting =
      hydrateSummaryLinks(normalizedExisting, subredditName, baseCache.top_posts) ||
      normalizedExisting;
    if (
      hasStructuredSummary(baseCache.ai_summary_structured) &&
      !isStructuredSummaryMalformed(normalizedExisting)
    ) {
      return {
        ...baseCache,
        ai_summary_structured: linkedExisting,
      };
    }
    if (typeof baseCache.ai_summary === "string") {
      const repairedFromText = parseSummaryStructured(baseCache.ai_summary);
      if (repairedFromText && !isStructuredSummaryMalformed(repairedFromText)) {
        const linkedRepaired =
          hydrateSummaryLinks(repairedFromText, subredditName, baseCache.top_posts) ||
          repairedFromText;
        return {
          ...baseCache,
          ai_summary_structured: linkedRepaired,
          ai_summary_generation_status: "success",
          ai_summary_generation_attempted_at:
            `${baseCache.ai_summary_generation_attempted_at ?? ""}`.trim() ||
            new Date().toISOString(),
          ai_summary_generation_error: null,
        };
      }
    }
    return {
      ...baseCache,
      ai_summary_structured: linkedExisting,
    };
  }

  const status = `${baseCache.ai_summary_generation_status ?? ""}`.trim();
  const attemptedAt = Date.parse(
    `${baseCache.ai_summary_generation_attempted_at ?? ""}`.trim(),
  );

  if (typeof baseCache.ai_summary === "string") {
    const parsedFromText = parseSummaryStructured(baseCache.ai_summary);
    if (parsedFromText) {
      const linkedFromText =
        hydrateSummaryLinks(parsedFromText, subredditName, baseCache.top_posts) ||
        parsedFromText;
      return {
        ...baseCache,
        ai_summary_structured: linkedFromText,
        ai_summary_generation_status: "success",
        ai_summary_generation_attempted_at:
          `${baseCache.ai_summary_generation_attempted_at ?? ""}`.trim() ||
          new Date().toISOString(),
        ai_summary_generation_error: null,
      };
    }
    // If we already generated raw text once and still cannot structure it,
    // avoid auto-calling OpenAI repeatedly on every page load.
    if (status === "success_raw") return baseCache;
  }

  if (status === "failed") {
    return baseCache;
  }
  if (
    status === "skipped_no_posts" &&
    Number.isFinite(attemptedAt) &&
    Date.now() - attemptedAt < SUMMARY_RETRY_COOLDOWN_MS
  ) {
    return baseCache;
  }

  const topPosts = Array.isArray(baseCache.top_posts) ? baseCache.top_posts : [];
  const attemptedAtIso = new Date().toISOString();
  if (topPosts.length === 0) {
    return {
      ...baseCache,
      ai_summary_generation_status: "skipped_no_posts",
      ai_summary_generation_attempted_at: attemptedAtIso,
    };
  }

  try {
    const promptMap = await readPromptMap(env);
    const customPrompt = promptMap[subredditName];
    const systemPrompt = customPrompt?.trim()
      ? customPrompt
      : DEFAULT_PROMPT.replace("{subreddit}", subredditName);

    const redditPayload: JsonRecord = {
      subreddit: subredditName,
      period: duration,
      top_posts: topPosts,
    };
    const text = await generateSummaryText(
      env,
      subredditName,
      duration,
      systemPrompt,
      redditPayload,
    );
    const structured = parseSummaryStructured(text);

    if (structured) {
      const linkedStructured =
        hydrateSummaryLinks(structured, subredditName, baseCache.top_posts) ||
        structured;
      return {
        ...baseCache,
        ai_summary_structured: linkedStructured,
        ai_prompt_used: systemPrompt,
        ai_summary_generation_status: "success",
        ai_summary_generation_attempted_at: attemptedAtIso,
        ai_summary_generation_error: null,
      };
    }
    return {
      ...baseCache,
      ai_summary: text,
      ai_prompt_used: systemPrompt,
      ai_summary_generation_status: "success_raw",
      ai_summary_generation_attempted_at: attemptedAtIso,
      ai_summary_generation_error: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "summary generation failed";
    return {
      ...baseCache,
      ai_summary_generation_status: "failed",
      ai_summary_generation_attempted_at: attemptedAtIso,
      ai_summary_generation_error: truncateText(detail, 240),
    };
  }
}

async function handleResearchSubreddit(
  request: Request,
  env: Env,
): Promise<Response> {
  const data = await parseRequestJson(request);
  const subredditName = normalizeSubredditName(data.subreddit_name);
  const duration = normalizeDuration(data.duration);
  const limitRaw = Number(data.limit ?? 20);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 20;
  if (!subredditName) throw new HttpError(400, "Subreddit name required");

  const cacheKey = `${subredditName.toLowerCase()}::limit=${limit}::duration=${duration}`;
  const cached = await getCache(env, SUBREDDIT_CACHE_NAMESPACE, cacheKey);
  if (cached) {
    const cachedRecord = asRecord(cached);
    if (!cachedRecord) return jsonResponse(cached);

    const cachedTopPosts = Array.isArray(cachedRecord.top_posts)
      ? cachedRecord.top_posts
      : [];
    if (cachedTopPosts.length === 0) {
      const lastRefreshAttemptMs = Date.parse(
        `${cachedRecord.top_posts_refresh_attempted_at ?? ""}`.trim(),
      );
      if (
        Number.isFinite(lastRefreshAttemptMs) &&
        Date.now() - lastRefreshAttemptMs < EMPTY_POSTS_REFRESH_COOLDOWN_MS
      ) {
        return jsonResponse(cachedRecord);
      }

      const refreshed: JsonRecord = {
        ...cachedRecord,
        subreddit: subredditName,
        period: duration,
        cachedAt: new Date().toISOString(),
        top_posts_refresh_attempted_at: new Date().toISOString(),
        top_posts: await getTopPostsForSubreddit(env, subredditName, limit, duration),
      };
      const enrichedRefreshed = await maybeAttachAiSummary(
        env,
        subredditName,
        duration,
        refreshed,
      );
      await setCache(
        env,
        SUBREDDIT_CACHE_NAMESPACE,
        cacheKey,
        enrichedRefreshed,
        ONE_DAY_TTL_SECONDS,
      );
      await saveSnapshot(env, subredditName, duration, enrichedRefreshed).catch(
        () => undefined,
      );
      return jsonResponse(enrichedRefreshed);
    }

    const hadAiSummary =
      hasStructuredSummary(cachedRecord.ai_summary_structured) ||
      Array.isArray(cachedRecord.ai_summary_structured) ||
      typeof cachedRecord.ai_summary === "string";
    const enrichedCached = await maybeAttachAiSummary(
      env,
      subredditName,
      duration,
      cachedRecord,
    );
    const hasAiSummaryNow =
      hasStructuredSummary(enrichedCached.ai_summary_structured) ||
      Array.isArray(enrichedCached.ai_summary_structured) ||
      typeof enrichedCached.ai_summary === "string";
    const generationAttemptChanged =
      `${enrichedCached.ai_summary_generation_attempted_at ?? ""}` !==
      `${cachedRecord.ai_summary_generation_attempted_at ?? ""}`;
    const summaryShapeChanged =
      JSON.stringify(enrichedCached.ai_summary_structured ?? null) !==
      JSON.stringify(cachedRecord.ai_summary_structured ?? null);
    if (
      (!hadAiSummary && hasAiSummaryNow) ||
      generationAttemptChanged ||
      summaryShapeChanged
    ) {
      await setCache(
        env,
        SUBREDDIT_CACHE_NAMESPACE,
        cacheKey,
        enrichedCached,
        ONE_DAY_TTL_SECONDS,
      );
      await saveSnapshot(env, subredditName, duration, enrichedCached).catch(() => undefined);
    }
    return jsonResponse(enrichedCached);
  }

  const topPosts = await getTopPostsForSubreddit(env, subredditName, limit, duration);
  const result: JsonRecord = {
    subreddit: subredditName,
    period: duration,
    cachedAt: new Date().toISOString(),
    top_posts: topPosts,
  };
  const enrichedResult = await maybeAttachAiSummary(
    env,
    subredditName,
    duration,
    result,
  );

  await setCache(
    env,
    SUBREDDIT_CACHE_NAMESPACE,
    cacheKey,
    enrichedResult,
    ONE_DAY_TTL_SECONDS,
  );
  await saveSnapshot(env, subredditName, duration, enrichedResult).catch(
    () => undefined,
  );

  return jsonResponse(enrichedResult);
}

async function handleSnapshot(
  env: Env,
  subreddit: string,
  dateStr: string,
  period: string | null,
): Promise<Response> {
  const normalizedSubreddit = normalizeSubredditName(subreddit);
  const normalizedDate = `${dateStr}`.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throw new HttpError(400, "Date must be YYYY-MM-DD");
  }
  const normalizedPeriod = period ? normalizeDuration(period) : undefined;

  const existing = await getSnapshot(
    env,
    normalizedSubreddit,
    normalizedDate,
    normalizedPeriod,
  );
  if (existing !== null) {
    const rec = asRecord(existing);
    if (!rec) return jsonResponse(existing);
    const normalizedStructured = normalizeSummaryStructured(rec.ai_summary_structured);
    const parsedFromText =
      (typeof rec.ai_summary === "string" &&
        (!normalizedStructured || isStructuredSummaryMalformed(normalizedStructured)))
        ? parseSummaryStructured(rec.ai_summary)
        : null;
    const linkedStructured = hydrateSummaryLinks(
      parsedFromText || normalizedStructured,
      normalizedSubreddit,
      rec.top_posts,
    );
    if (linkedStructured) {
      return jsonResponse({
        ...rec,
        ai_summary_structured: linkedStructured,
      });
    }
    return jsonResponse(existing);
  }

  const duration = normalizedPeriod || "1week";
  const result = {
    subreddit: normalizedSubreddit,
    period: duration,
    cachedAt: new Date().toISOString(),
    top_posts: await getTopPostsForSubreddit(env, normalizedSubreddit, 20, duration),
  };
  await saveSnapshot(env, normalizedSubreddit, duration, result).catch(() => undefined);
  return jsonResponse(result);
}

async function handleDates(env: Env, subreddit: string): Promise<Response> {
  const normalizedSubreddit = normalizeSubredditName(subreddit);
  const dates = await listSnapshotDates(env, normalizedSubreddit);
  return jsonResponse({ subreddit: normalizedSubreddit, dates });
}

async function handleFeed(url: URL, env: Env): Promise<Response> {
  const duration = normalizeDuration(url.searchParams.get("duration"));
  await ensureDbInitialized(env);
  const db = getDb(env);
  const feedRes = await db.execute({
    sql: "SELECT key, data FROM cache_entries WHERE namespace = ? AND key LIKE ? AND expires_at > datetime('now')",
    args: [SUBREDDIT_CACHE_NAMESPACE, `%::duration=${duration}`],
  });
  const rows = feedRes.rows as Array<{ key: string; data: unknown }>;

  const bestBySubreddit = new Map<string, { limit: number; data: unknown }>();
  for (const row of rows) {
    const key = `${row.key ?? ""}`;
    const subreddit = key.split("::")[0] || "";
    const limitMatch = key.match(/::limit=(\d+)::/);
    const limit = Number.parseInt(limitMatch?.[1] || "0", 10);
    const data = parseJsonColumn(row.data);
    const current = bestBySubreddit.get(subreddit);
    if (!current || limit > current.limit) {
      bestBySubreddit.set(subreddit, { limit, data });
    }
  }

  const items = [...bestBySubreddit.entries()].map(([subredditFromKey, entry]) => {
    const rec = asRecord(entry.data);
    if (!rec) return entry.data;
    const subreddit = normalizeSubredditName(rec.subreddit || subredditFromKey || "");
    const normalizedStructured = normalizeSummaryStructured(rec.ai_summary_structured);
    const parsedFromText =
      (typeof rec.ai_summary === "string" &&
        (!normalizedStructured || isStructuredSummaryMalformed(normalizedStructured)))
        ? parseSummaryStructured(rec.ai_summary)
        : null;
    const linkedStructured = hydrateSummaryLinks(
      parsedFromText || normalizedStructured,
      subreddit,
      rec.top_posts,
    );
    if (!linkedStructured) return rec;
    return {
      ...rec,
      ai_summary_structured: linkedStructured,
    };
  });
  return jsonResponse({ duration, items });
}

async function handleListPrompts(env: Env): Promise<Response> {
  const prompts = await readPromptMap(env);
  return jsonResponse({ defaultPrompt: DEFAULT_PROMPT, prompts });
}

async function handleGetPrompt(env: Env, subreddit: string): Promise<Response> {
  const normalized = normalizeSubredditName(subreddit);
  const prompts = await readPromptMap(env);
  const value = prompts[normalized];
  if (typeof value === "string" && value.trim()) {
    return jsonResponse({ subreddit: normalized, prompt: value, isDefault: false });
  }
  if (PROMPT_DEFAULTS[normalized]) {
    return jsonResponse({
      subreddit: normalized,
      prompt: PROMPT_DEFAULTS[normalized],
      isDefault: true,
    });
  }
  return jsonResponse({
    subreddit: normalized,
    prompt: DEFAULT_PROMPT.replace("{subreddit}", normalized),
    isDefault: true,
  });
}

async function handleSavePrompt(
  request: Request,
  env: Env,
  subreddit: string,
): Promise<Response> {
  await requireAdmin(request, env);
  const normalized = normalizeSubredditName(subreddit);
  const body = await parseRequestJson(request);
  const prompt = `${body.prompt ?? ""}`.trim();
  if (!prompt) throw new HttpError(400, "Prompt must be non-empty");
  await writePromptMap(env, normalized, prompt);
  // Add to curated list if new
  let addedToCurated = false;
  if (!ALLOWED_SUBREDDITS.has(normalized.toLowerCase())) {
    ALLOWED_SUBREDDITS.add(normalized.toLowerCase());
    PROMPT_DEFAULTS[normalized] = prompt;
    addedToCurated = true;
  }
  return jsonResponse({ status: "ok", subreddit: normalized, prompt, addedToCurated });
}

async function handleDeletePrompt(
  request: Request,
  env: Env,
  subreddit: string,
): Promise<Response> {
  await requireAdmin(request, env);
  const normalized = normalizeSubredditName(subreddit);
  if (!ALLOWED_SUBREDDITS.has(normalized.toLowerCase())) {
    throw new HttpError(404, "Subreddit not found in curated list");
  }
  // Remove from in-memory sets
  ALLOWED_SUBREDDITS.delete(normalized.toLowerCase());
  // Remove from PROMPT_DEFAULTS (case-insensitive key match)
  for (const key of Object.keys(PROMPT_DEFAULTS)) {
    if (key.toLowerCase() === normalized.toLowerCase()) {
      delete PROMPT_DEFAULTS[key];
      break;
    }
  }
  // Remove from DB
  try {
    const db = getDb(env);
    await db.execute({
      sql: "DELETE FROM prompts WHERE LOWER(subreddit) = LOWER(?)",
      args: [normalized],
    });
  } catch {
    // best-effort DB cleanup
  }
  return jsonResponse({ status: "ok", subreddit: normalized, removed: true });
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const body = await parseRequestJson(request);

  const subredditName = normalizeSubredditName(body.subreddit_name);
  if (!subredditName) throw new HttpError(400, "Subreddit name required");

  const duration = normalizeDuration(body.duration);
  const limitRaw = Number(body.limit ?? 20);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 20;
  const overridePrompt = `${body.prompt ?? ""}`.trim();

  let systemPrompt = overridePrompt;
  if (!systemPrompt) {
    const promptMap = await readPromptMap(env);
    const customPrompt = promptMap[subredditName];
    systemPrompt = customPrompt?.trim()
      ? customPrompt
      : DEFAULT_PROMPT.replace("{subreddit}", subredditName);
  }

  const providedRedditData = asRecord(body.reddit_data);
  const redditPayload =
    providedRedditData ||
    ({
      subreddit: subredditName,
      period: duration,
      top_posts: await getTopPostsForSubreddit(env, subredditName, limit, duration),
    } as JsonRecord);

  const cacheKey = `${subredditName.toLowerCase()}::limit=${limit}::duration=${duration}`;
  const cached = asRecord(await getCache(env, SUBREDDIT_CACHE_NAMESPACE, cacheKey));
  if (cached) {
    const cachedPrompt = `${cached.ai_prompt_used ?? ""}`;
    const cachedStructured = normalizeSummaryStructured(cached.ai_summary_structured);
    const linkedCachedStructured = hydrateSummaryLinks(
      cachedStructured,
      subredditName,
      cached.top_posts,
    );
    if (
      cachedPrompt === systemPrompt &&
      linkedCachedStructured &&
      !isStructuredSummaryMalformed(linkedCachedStructured)
    ) {
      return textResponse(
        JSON.stringify(linkedCachedStructured),
        "application/json; charset=utf-8",
      );
    }
    if (cachedPrompt === systemPrompt && typeof cached.ai_summary === "string") {
      const parsedFromText = parseSummaryStructured(cached.ai_summary);
      if (parsedFromText) {
        const linkedParsed =
          hydrateSummaryLinks(parsedFromText, subredditName, cached.top_posts) ||
          parsedFromText;
        cached.ai_summary_structured = linkedParsed;
        delete cached.ai_summary;
        cached.ai_summary_generation_status = "success";
        cached.ai_summary_generation_attempted_at =
          `${cached.ai_summary_generation_attempted_at ?? ""}`.trim() ||
          new Date().toISOString();
        cached.ai_summary_generation_error = null;
        await setCache(
          env,
          SUBREDDIT_CACHE_NAMESPACE,
          cacheKey,
          cached,
          ONE_DAY_TTL_SECONDS,
        );
        await saveSnapshot(env, subredditName, duration, cached).catch(() => undefined);
        return textResponse(
          JSON.stringify(linkedParsed),
          "application/json; charset=utf-8",
        );
      }
      return textResponse(`${cached.ai_summary}`, "text/plain; charset=utf-8");
    }
  }

  const text = await generateSummaryText(
    env,
    subredditName,
    duration,
    systemPrompt,
    redditPayload,
  );
  const structured = parseSummaryStructured(text);

  const baseCache = (cached && typeof cached === "object"
    ? { ...cached }
    : {
        subreddit: subredditName,
        period: duration,
        cachedAt: new Date().toISOString(),
        top_posts: redditPayload.top_posts || [],
      }) as JsonRecord;

  if (structured) {
    baseCache.ai_summary_structured =
      hydrateSummaryLinks(structured, subredditName, baseCache.top_posts) || structured;
    delete baseCache.ai_summary;
    baseCache.ai_summary_generation_status = "success";
    baseCache.ai_summary_generation_attempted_at = new Date().toISOString();
    baseCache.ai_summary_generation_error = null;
  } else {
    baseCache.ai_summary = text;
    delete baseCache.ai_summary_structured;
    baseCache.ai_summary_generation_status = "success_raw";
    baseCache.ai_summary_generation_attempted_at = new Date().toISOString();
    baseCache.ai_summary_generation_error = null;
  }
  baseCache.ai_prompt_used = systemPrompt;

  await setCache(
    env,
    SUBREDDIT_CACHE_NAMESPACE,
    cacheKey,
    baseCache,
    ONE_DAY_TTL_SECONDS,
  );
  await saveSnapshot(env, subredditName, duration, baseCache).catch(() => undefined);

  if (structured) {
    const linkedStructured =
      hydrateSummaryLinks(structured, subredditName, baseCache.top_posts) || structured;
    return textResponse(
      JSON.stringify(linkedStructured),
      "application/json; charset=utf-8",
    );
  }
  return textResponse(text, "text/plain; charset=utf-8");
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ detail: error.detail }, error.status);
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return jsonResponse({ detail: message }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return noContent();

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const method = request.method.toUpperCase();

    // Rate limiting
    cleanupRateLimits();
    const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    const rateLimit = path === "/api/research/subreddit" ? RATE_LIMIT_RESEARCH : RATE_LIMIT_DEFAULT;
    if (path.startsWith("/api/") && !checkRateLimit(clientIp, rateLimit)) {
      return jsonResponse({ detail: "Too many requests. Please try again later." }, 429);
    }

    try {
      if (method === "GET" && path === "/") {
        return jsonResponse({ status: "API is running" });
      }

      if (method === "GET" && path === "/health") {
        try {
          await ensureDbInitialized(env);
          const db = getDb(env);
          await db.execute("SELECT 1");
          return jsonResponse({ status: "healthy", database: "connected" });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Database check failed";
          return jsonResponse(
            { status: "unhealthy", database: message },
            503,
          );
        }
      }

      if (method === "POST" && path === "/api/research/subreddit") {
        return await handleResearchSubreddit(request, env);
      }

      const snapshotMatch = path.match(
        /^\/api\/research\/subreddit\/([^/]+)\/snapshot\/([^/]+)$/,
      );
      if (method === "GET" && snapshotMatch) {
        return await handleSnapshot(
          env,
          decodeURIComponent(snapshotMatch[1] || ""),
          decodeURIComponent(snapshotMatch[2] || ""),
          url.searchParams.get("period"),
        );
      }

      const datesMatch = path.match(/^\/api\/research\/subreddit\/([^/]+)\/dates$/);
      if (method === "GET" && datesMatch) {
        return await handleDates(env, decodeURIComponent(datesMatch[1] || ""));
      }

      if (method === "GET" && path === "/api/research/subreddit/feed") {
        return await handleFeed(url, env);
      }

      if (method === "POST" && path === "/api/research/subreddit/summary/stream") {
        return await handleSummary(request, env);
      }

      if (method === "GET" && path === "/api/prompts") {
        return await handleListPrompts(env);
      }

      const promptMatch = path.match(/^\/api\/prompts\/([^/]+)$/);
      if (promptMatch && method === "GET") {
        return await handleGetPrompt(env, decodeURIComponent(promptMatch[1] || ""));
      }
      if (promptMatch && method === "POST") {
        return await handleSavePrompt(
          request,
          env,
          decodeURIComponent(promptMatch[1] || ""),
        );
      }
      if (promptMatch && method === "DELETE") {
        return await handleDeletePrompt(
          request,
          env,
          decodeURIComponent(promptMatch[1] || ""),
        );
      }

      // --- User auth + tracked subreddits ---
      if (method === "POST" && path === "/api/auth/session") {
        return await handleAuthSession(request, env);
      }

      if (method === "POST" && path === "/api/subreddits/track") {
        return await handleTrackSubreddit(request, env);
      }

      if (method === "GET" && path === "/api/subreddits/mine") {
        return await handleListTrackedSubreddits(request, env);
      }

      const untrackMatch = path.match(/^\/api\/subreddits\/track\/([^/]+)$/);
      if (method === "DELETE" && untrackMatch) {
        return await handleUntrackSubreddit(request, env, decodeURIComponent(untrackMatch[1] || ""));
      }

      // --- Digest preferences ---
      if (method === "POST" && path === "/api/digest-preferences") {
        return await handleSaveDigestPreference(request, env);
      }

      if (method === "GET" && path === "/api/digest-preferences") {
        return await handleListDigestPreferences(request, env);
      }

      const digestPrefMatch = path.match(/^\/api\/digest-preferences\/([^/]+)$/);
      if (method === "DELETE" && digestPrefMatch) {
        return await handleDeleteDigestPreference(request, env, decodeURIComponent(digestPrefMatch[1] || ""));
      }

      if (method === "GET" && path === "/api/admin/check") {
        const auth = request.headers.get("Authorization") || "";
        if (!auth.startsWith("Bearer ")) {
          return jsonResponse({ isAdmin: false });
        }
        const token = auth.slice("Bearer ".length).trim();
        if (!token) return jsonResponse({ isAdmin: false });
        try {
          const info = await verifyGoogleToken(token);
          const allowed = adminEmailSet(env);
          return jsonResponse({ isAdmin: allowed.has(info.email) });
        } catch {
          return jsonResponse({ isAdmin: false });
        }
      }

      return jsonResponse({ detail: "Not found" }, 404);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      await ensureDbInitialized(env);
      const db = getDb(env);

      // 1. Get all distinct tracked subreddits
      const trackedRes = await db.execute(
        "SELECT DISTINCT subreddit FROM tracked_subreddits",
      );
      const subreddits = trackedRes.rows.map((r) => `${r.subreddit}`).filter(Boolean);

      // 2. For each: fetch Reddit data, generate AI summary, save snapshot
      const duration = "1week" as const;
      for (const sub of subreddits) {
        try {
          const cacheKey = `${sub.toLowerCase()}::limit=20::duration=${duration}`;
          const topPosts = await getTopPostsForSubreddit(env, sub, 20, duration);
          const result: JsonRecord = {
            subreddit: sub,
            period: duration,
            cachedAt: new Date().toISOString(),
            top_posts: topPosts,
          };
          const enriched = await maybeAttachAiSummary(env, sub, duration, result);
          await setCache(env, SUBREDDIT_CACHE_NAMESPACE, cacheKey, enriched, ONE_DAY_TTL_SECONDS);
          await saveSnapshot(env, sub, duration, enriched).catch(() => undefined);
        } catch {
          // Continue to next subreddit on failure
        }
      }

      // 3. Send digests
      if (!env.RESEND_API_KEY) return;

      const now = new Date();
      const isNewDay = now.getUTCHours() < 6; // First run of the day (0:00 UTC)
      const isSaturday = now.getUTCDay() === 6;

      const digestRes = await db.execute(
        `SELECT dp.id, dp.user_id, dp.tracked_subreddit_id, dp.channel, dp.frequency, dp.last_sent_at,
          ts.subreddit, u.email
          FROM digest_preferences dp
          JOIN tracked_subreddits ts ON ts.id = dp.tracked_subreddit_id
          JOIN users u ON u.id = dp.user_id
          WHERE dp.enabled = 1 AND dp.channel = 'email'`,
      );

      for (const row of digestRes.rows) {
        const frequency = `${row.frequency}`;
        const lastSent = `${row.last_sent_at ?? ""}`.trim();

        // Skip if not the right time
        if (frequency === "weekly" && !isSaturday) continue;
        if (frequency === "daily" && !isNewDay) continue;

        // Skip if already sent today
        if (lastSent) {
          const lastSentDate = lastSent.slice(0, 10);
          const todayDate = now.toISOString().slice(0, 10);
          if (lastSentDate === todayDate) continue;
        }

        const sub = `${row.subreddit}`;
        const email = `${row.email}`;
        const prefId = `${row.id}`;

        // Get latest snapshot
        const snapRes = await db.execute({
          sql: "SELECT data FROM snapshots WHERE subreddit = ? ORDER BY created_at DESC LIMIT 1",
          args: [sub.toLowerCase()],
        });
        if (snapRes.rows.length === 0) continue;

        const snapshot = asRecord(parseJsonColumn(snapRes.rows[0]?.data ?? null));
        if (!snapshot) continue;

        const html = buildDigestHtml(sub, snapshot);
        const sent = await sendResendEmail(
          env.RESEND_API_KEY,
          email,
          `Your SubWatch Digest — r/${sub}`,
          html,
        );

        if (sent) {
          await db.execute({
            sql: "UPDATE digest_preferences SET last_sent_at = ? WHERE id = ?",
            args: [now.toISOString(), prefId],
          }).catch(() => undefined);
        }
      }
    } catch {
      // Scheduled handler should not throw
    }
  },
};
