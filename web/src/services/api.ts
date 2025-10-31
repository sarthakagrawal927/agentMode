const API_BASE_URL = "http://localhost:8000/api";

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
};
