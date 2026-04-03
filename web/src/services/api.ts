import { getAuthHeaders } from "@/lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api";

interface ResearchParams {
  role_title: string;
  linkedin_urls: string[];
  industry_context: string | null;
}

interface SubredditParams {
  subreddit_name: string;
  duration?: "1d" | "1week";
  limit?: number;
}

interface PromptMapResponse {
  defaultPrompt: string;
  prompts: Record<string, string>;
}

interface SubredditPromptResponse {
  subreddit: string;
  prompt: string;
  isDefault: boolean;
}

export interface TrackedSubreddit {
  id: string;
  subreddit: string;
  created_at: string;
  latest_snapshot: any | null;
}

export interface TrackedSubredditsResponse {
  items: TrackedSubreddit[];
  plan: string;
  limit: number;
}

export interface DigestPreference {
  id: string;
  tracked_subreddit_id: string;
  subreddit: string;
  channel: string;
  frequency: string;
  enabled: boolean;
  last_sent_at: string | null;
}

const callApi = async <T>(endpoint: string, params: T) => {
  const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error("Network response was not ok");
  }

  return response.json();
};

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = { ...getAuthHeaders(), ...options.headers } as Record<string, string>;
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
}

export const api = {
  async research(params: ResearchParams) {
    return callApi<ResearchParams>("research", params);
  },

  async subredditResearch(params: SubredditParams) {
    return callApi<SubredditParams>("research/subreddit", params);
  },

  async getPrompts(): Promise<PromptMapResponse> {
    const resp = await fetch(`${API_BASE_URL}/prompts`, { cache: "no-store" });
    if (!resp.ok) throw new Error("Failed to fetch prompts");
    return resp.json();
  },

  async getSubredditPrompt(subreddit: string): Promise<SubredditPromptResponse> {
    const resp = await fetch(`${API_BASE_URL}/prompts/${encodeURIComponent(subreddit)}`, {
      cache: "no-store",
    });
    if (!resp.ok) throw new Error("Failed to fetch subreddit prompt");
    return resp.json();
  },

  async saveSubredditPrompt(subreddit: string, prompt: string): Promise<{ status: string; subreddit: string; prompt: string }> {
    const resp = await fetch(`${API_BASE_URL}/prompts/${encodeURIComponent(subreddit)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!resp.ok) throw new Error("Failed to save subreddit prompt");
    return resp.json();
  },

  async checkAdmin(authHeaders: Record<string, string>): Promise<boolean> {
    try {
      const resp = await fetch(`${API_BASE_URL}/admin/check`, {
        headers: authHeaders,
        cache: "no-store",
      });
      if (!resp.ok) return false;
      const data = await resp.json() as { isAdmin?: boolean };
      return !!data.isAdmin;
    } catch {
      return false;
    }
  },

  // --- Tracked subreddits ---
  async trackSubreddit(subreddit: string): Promise<{ id: string; subreddit: string }> {
    const resp = await authedFetch("/subreddits/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subreddit }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: "Failed to track" }));
      throw new Error(err.detail || "Failed to track subreddit");
    }
    return resp.json();
  },

  async getTrackedSubreddits(): Promise<TrackedSubredditsResponse> {
    const resp = await authedFetch("/subreddits/mine");
    if (!resp.ok) throw new Error("Failed to fetch tracked subreddits");
    return resp.json();
  },

  async untrackSubreddit(id: string): Promise<void> {
    const resp = await authedFetch(`/subreddits/track/${id}`, { method: "DELETE" });
    if (!resp.ok) throw new Error("Failed to untrack subreddit");
  },

  // --- Digest preferences ---
  async getDigestPreferences(): Promise<{ items: DigestPreference[] }> {
    const resp = await authedFetch("/digest-preferences");
    if (!resp.ok) throw new Error("Failed to fetch digest preferences");
    return resp.json();
  },

  async saveDigestPreference(params: {
    tracked_subreddit_id: string;
    channel?: string;
    frequency?: string;
    enabled?: boolean;
  }): Promise<DigestPreference> {
    const resp = await authedFetch("/digest-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: "Failed to save" }));
      throw new Error(err.detail || "Failed to save digest preference");
    }
    return resp.json();
  },

  async deleteDigestPreference(id: string): Promise<void> {
    const resp = await authedFetch(`/digest-preferences/${id}`, { method: "DELETE" });
    if (!resp.ok) throw new Error("Failed to delete digest preference");
  },
};
