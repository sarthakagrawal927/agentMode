const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api";

interface ResearchParams {
  role_title: string;
  linkedin_urls: string[];
  industry_context: string | null;
}

interface SubredditParams {
  subreddit_name: string;
  duration?: "1d" | "1week" | "1month";
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
};
