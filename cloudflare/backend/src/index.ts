import { Client } from "pg";
import promptDefaultsRaw from "../prompts.json";

type JsonRecord = Record<string, unknown>;

type Env = {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_EMAILS?: string;
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
const DEFAULT_PROMPT =
  "Analyze top posts and comments for r/{subreddit}. Summarize key themes, actionable insights, and representative quotes.";

const PROMPT_DEFAULTS = normalizePromptDefaults(promptDefaultsRaw as JsonRecord);
const ALLOWED_SUBREDDITS = new Set(
  Object.keys(PROMPT_DEFAULTS).map((item) => item.toLowerCase()),
);

const CORS_BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const DB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cache_entries (
    namespace VARCHAR(255) NOT NULL,
    key       TEXT         NOT NULL,
    data      JSONB        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (namespace, key)
);

CREATE TABLE IF NOT EXISTS prompts (
    subreddit VARCHAR(255) UNIQUE NOT NULL,
    prompt    TEXT                NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
    subreddit  VARCHAR(255) NOT NULL,
    snap_date  DATE         NOT NULL,
    period     VARCHAR(20)  NOT NULL,
    data       JSONB        NOT NULL,
    created_at TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE (subreddit, snap_date, period)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_sub_date
    ON snapshots (subreddit, snap_date DESC);
`;

let dbInitPromise: Promise<void> | null = null;
let redditTokenCache: { token: string; expiresAtMs: number } | null = null;

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

function normalizeSubredditName(input: unknown): string {
  const raw = `${input ?? ""}`.trim();
  if (!raw) return "";
  return raw.replace(/^r\//i, "");
}

function normalizeDuration(input: unknown): "1d" | "1week" | "1month" {
  const raw = `${input ?? ""}`;
  if (raw === "1d" || raw === "1week" || raw === "1month") return raw;
  return "1week";
}

function parseSummaryStructured(text: string): JsonRecord[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withoutFences = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(withoutFences);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      ) as JsonRecord[];
    }
  } catch {
    return null;
  }
  return null;
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

async function verifyGoogleToken(idToken: string): Promise<{ email: string }> {
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("id_token", idToken);
  const resp = await fetch(tokenInfoUrl.toString(), { method: "GET" });
  if (!resp.ok) throw new HttpError(401, "Invalid Google token");
  const data = (await resp.json()) as JsonRecord;
  const email = `${data.email ?? ""}`.trim().toLowerCase();
  if (!email) throw new HttpError(401, "Google token missing email");
  return { email };
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

async function withDb<T>(
  env: Env,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const useSsl = !env.DATABASE_URL.includes("sslmode=disable");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

async function ensureDbInitialized(env: Env): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await withDb(env, async (client) => {
        await client.query(DB_SCHEMA_SQL);
        const countRes = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM prompts",
        );
        const count = Number.parseInt(countRes.rows[0]?.count || "0", 10);
        if (count > 0) return;
        for (const [subreddit, prompt] of Object.entries(PROMPT_DEFAULTS)) {
          await client.query(
            `
            INSERT INTO prompts (subreddit, prompt)
            VALUES ($1, $2)
            ON CONFLICT (subreddit) DO NOTHING
            `,
            [subreddit, prompt],
          );
        }
      });
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
  return withDb(env, async (client) => {
    const res = await client.query<{ data: unknown }>(
      `
      SELECT data FROM cache_entries
      WHERE namespace = $1 AND key = $2 AND expires_at > NOW()
      `,
      [namespace, key],
    );
    if (res.rows.length === 0) return null;
    return parseJsonColumn(res.rows[0]?.data ?? null);
  });
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
  await withDb(env, async (client) => {
    await client.query(
      `
      INSERT INTO cache_entries (namespace, key, data, expires_at)
      VALUES ($1, $2, $3::jsonb, $4::timestamptz)
      ON CONFLICT (namespace, key)
      DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at
      `,
      [namespace, key, JSON.stringify(data), expiresAt],
    );
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
  await withDb(env, async (client) => {
    await client.query(
      `
      INSERT INTO snapshots (subreddit, snap_date, period, data)
      VALUES ($1, $2::date, $3, $4::jsonb)
      ON CONFLICT (subreddit, snap_date, period)
      DO UPDATE SET data = EXCLUDED.data
      `,
      [subreddit.trim().toLowerCase(), today, period, JSON.stringify(data)],
    );
  });
}

async function getSnapshot(
  env: Env,
  subreddit: string,
  dateStr: string,
  period?: string,
): Promise<unknown | null> {
  await ensureDbInitialized(env);
  return withDb(env, async (client) => {
    const normalizedSubreddit = subreddit.trim().toLowerCase();
    const res = period
      ? await client.query<{ data: unknown }>(
          `
          SELECT data FROM snapshots
          WHERE subreddit = $1 AND snap_date = $2::date AND period = $3
          `,
          [normalizedSubreddit, dateStr, period],
        )
      : await client.query<{ data: unknown }>(
          `
          SELECT data FROM snapshots
          WHERE subreddit = $1 AND snap_date = $2::date
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [normalizedSubreddit, dateStr],
        );
    if (res.rows.length === 0) return null;
    return parseJsonColumn(res.rows[0]?.data ?? null);
  });
}

async function listSnapshotDates(env: Env, subreddit: string): Promise<string[]> {
  await ensureDbInitialized(env);
  return withDb(env, async (client) => {
    const res = await client.query<{ snap_date: unknown }>(
      `
      SELECT DISTINCT snap_date
      FROM snapshots
      WHERE subreddit = $1
      ORDER BY snap_date DESC
      `,
      [subreddit.trim().toLowerCase()],
    );
    return res.rows
      .map((row) => toIsoDate(row.snap_date))
      .filter((item): item is string => Boolean(item));
  });
}

async function readPromptMap(env: Env): Promise<Record<string, string>> {
  await ensureDbInitialized(env);
  try {
    const dbPrompts = await withDb(env, async (client) => {
      const res = await client.query<{ subreddit: string; prompt: string }>(
        "SELECT subreddit, prompt FROM prompts",
      );
      const mapped: Record<string, string> = {};
      for (const row of res.rows) {
        const key = `${row.subreddit}`.trim();
        const value = `${row.prompt}`.trim();
        if (!key || !value) continue;
        if (ALLOWED_SUBREDDITS.size > 0 && !ALLOWED_SUBREDDITS.has(key.toLowerCase())) {
          continue;
        }
        mapped[key] = value;
      }
      return mapped;
    });
    const merged: Record<string, string> = { ...PROMPT_DEFAULTS };
    Object.assign(merged, dbPrompts);
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
  await withDb(env, async (client) => {
    await client.query(
      `
      INSERT INTO prompts (subreddit, prompt)
      VALUES ($1, $2)
      ON CONFLICT (subreddit)
      DO UPDATE SET prompt = EXCLUDED.prompt
      `,
      [subreddit, prompt],
    );
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
      "User-Agent": "AgentDataWorker/1.0",
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    const message = await resp.text();
    throw new HttpError(502, `Reddit auth failed: ${message}`);
  }
  const data = (await resp.json()) as JsonRecord;
  const token = `${data.access_token ?? ""}`.trim();
  const expiresInSec = Number(data.expires_in ?? 3600);
  if (!token) throw new HttpError(502, "Reddit auth returned empty token");
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
        "User-Agent": "AgentDataWorker/1.0",
      },
    });
  };

  let token = await getRedditAccessToken(env);
  let resp = await perform(token);
  if (resp.status === 401) {
    redditTokenCache = null;
    token = await getRedditAccessToken(env);
    resp = await perform(token);
  }
  if (!resp.ok) {
    const message = await resp.text();
    throw new HttpError(502, `Reddit API failed: ${message}`);
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
  for (const child of children) {
    const node = asRecord(child);
    if (!node || `${node.kind ?? ""}` !== "t3") continue;
    const data = asRecord(node.data);
    if (!data) continue;

    const createdUtc = Number(data.created_utc ?? 0);
    if (createdUtc < cutoffSeconds) continue;

    const score = Number(data.score ?? 0);
    if (score < postThreshold) {
      if (posts.length >= 5) break;
      continue;
    }

    const postId = data.id ? `${data.id}` : null;
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
      title: `${data.title ?? ""}`,
      selftext: `${data.selftext ?? ""}`,
      score,
      comments,
    });

    if (posts.length >= limit) break;
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

Key Rule: Give information, instead of telling what info the post gives. Respond ONLY with a JSON array (no preamble, no code fences). Each item must be: {"title": string, "desc": string, "sourceId": [postId, optionalCommentId] }. Use exact IDs from the provided data. If referencing a post only, sourceId = [postId]. If referencing a specific comment, sourceId = [postId, commentId]. No extra keys, no trailing commas.`;

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
        { role: "user", content: JSON.stringify(redditPayload) },
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
  if (cached) return jsonResponse(cached);

  const topPosts = await getTopPostsForSubreddit(env, subredditName, limit, duration);
  const result = {
    subreddit: subredditName,
    period: duration,
    cachedAt: new Date().toISOString(),
    top_posts: topPosts,
  };

  await setCache(
    env,
    SUBREDDIT_CACHE_NAMESPACE,
    cacheKey,
    result,
    ONE_DAY_TTL_SECONDS,
  );
  await saveSnapshot(env, subredditName, duration, result).catch(() => undefined);

  return jsonResponse(result);
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
  if (existing !== null) return jsonResponse(existing);

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
  const rows = await withDb(env, async (client) => {
    const res = await client.query<{ key: string; data: unknown }>(
      `
      SELECT key, data FROM cache_entries
      WHERE namespace = $1
        AND key LIKE $2
        AND expires_at > NOW()
      `,
      [SUBREDDIT_CACHE_NAMESPACE, `%::duration=${duration}`],
    );
    return res.rows;
  });

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

  const items = [...bestBySubreddit.values()].map((entry) => entry.data);
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
  if (
    ALLOWED_SUBREDDITS.size > 0 &&
    !ALLOWED_SUBREDDITS.has(normalized.toLowerCase())
  ) {
    throw new HttpError(400, "Subreddit is not in the curated allowed list");
  }
  const body = await parseRequestJson(request);
  const prompt = `${body.prompt ?? ""}`.trim();
  if (!prompt) throw new HttpError(400, "Prompt must be non-empty");
  await writePromptMap(env, normalized, prompt);
  return jsonResponse({ status: "ok", subreddit: normalized, prompt });
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
    if (cachedPrompt === systemPrompt && Array.isArray(cached.ai_summary_structured)) {
      return textResponse(
        JSON.stringify(cached.ai_summary_structured),
        "application/json; charset=utf-8",
      );
    }
    if (cachedPrompt === systemPrompt && typeof cached.ai_summary === "string") {
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
    baseCache.ai_summary_structured = structured;
    delete baseCache.ai_summary;
  } else {
    baseCache.ai_summary = text;
    delete baseCache.ai_summary_structured;
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
    return textResponse(JSON.stringify(structured), "application/json; charset=utf-8");
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

    try {
      if (method === "GET" && path === "/") {
        return jsonResponse({ status: "API is running" });
      }

      if (method === "GET" && path === "/health") {
        try {
          await ensureDbInitialized(env);
          await withDb(env, async (client) => {
            await client.query("SELECT 1");
          });
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

      return jsonResponse({ detail: "Not found" }, 404);
    } catch (error) {
      return toErrorResponse(error);
    }
  },
};
