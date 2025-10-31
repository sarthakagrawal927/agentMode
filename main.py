from dotenv import load_dotenv

load_dotenv()
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl, constr
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from linkedinProfileExtractor import LinkedinProfile
from jobScraper import getJobDescriptions
from reddit import get_top_posts_for_topic, get_top_posts_for_subreddit
from llm_api import execute_chat_completion
import json
from cache import get_cache, set_cache, one_day_ttl_seconds
from datetime import datetime, timezone

app = FastAPI()

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ResearchRequest(BaseModel):
    role_title: str
    linkedin_urls: Optional[List[str]] = []  # Optional list of valid URLs
    industry_context: Optional[str] = None


SUBREDDIT_CACHE_NAMESPACE = "subreddit_research"


# ARCHIVED: Legacy role research endpoint (kept for reference)
@app.post("/api/research")
async def create_research(request: ResearchRequest):
    try:
        # find top posts for industry context
        reddit_top_posts = []
        if request.industry_context:
            reddit_top_posts = await get_top_posts_for_topic(request.industry_context)

        # Get LinkedIn profiles
        linkedInProfiles = []
        for url in request.linkedin_urls:
            profile = LinkedinProfile(url.split("/")[4])
            linkedInProfiles.append(profile.getProfile())

        # Get job descriptions
        jobDescriptions = getJobDescriptions([request.role_title])

        return {
            "status": "success",
            "message": "Research request received",
            "data": await execute_chat_completion(
                json.dumps(
                    {
                        "profiles": linkedInProfiles,
                        "jd": jobDescriptions,
                        "reddit": reddit_top_posts,
                    }
                )
            ),
        }
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/research/subreddit")
async def research_subreddit(data: dict):
    try:
        subreddit_name = data.get("subreddit_name")
        limit = data.get("limit", 20)
        duration = data.get("duration", "1week")

        if not subreddit_name:
            raise HTTPException(status_code=400, detail="Subreddit name required")
        try:
            limit = int(limit)
            if limit <= 0:
                limit = 20
        except Exception:
            limit = 20

        # Normalize key to avoid cache misses due to case differences
        cache_key = (
            f"{subreddit_name.strip().lower()}::limit={limit}::duration={duration}"
        )

        # Return cached value if valid
        cached = get_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key)
        if cached:
            return cached

        # Compute fresh value and cache it
        result = {
            "subreddit": subreddit_name,
            "period": duration,
            "cachedAt": datetime.now(timezone.utc).isoformat(),
            "top_posts": await get_top_posts_for_subreddit(
                subreddit_name, limit, duration
            ),
        }

        set_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key, result, one_day_ttl_seconds)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Test endpoint
@app.get("/")
async def read_root():
    return {"status": "API is running"}
