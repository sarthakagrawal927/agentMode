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
from pathlib import Path

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


# Feed endpoint: return all cached subreddit results for a given duration
@app.get("/api/research/subreddit/feed")
async def subreddit_feed(duration: str = "1week"):
    try:
        # Normalize/validate duration
        allowed = {"1d", "1week", "1month"}
        if duration not in allowed:
            duration = "1week"

        # Locate subreddit cache directory
        cache_root = Path(__file__).parent / ".cache" / SUBREDDIT_CACHE_NAMESPACE
        items = []
        now = datetime.now(timezone.utc)
        if cache_root.exists():
            for f in cache_root.glob("*.json"):
                try:
                    with f.open("r", encoding="utf-8") as fh:
                        doc = json.load(fh)
                    if not isinstance(doc, dict):
                        continue
                    bucket = doc.get(duration) or {}
                    if not isinstance(bucket, dict) or not bucket:
                        continue
                    # choose the highest available limit entry (unexpired only)
                    best_entry = None
                    best_limit = -1
                    expired_keys = []
                    for k, v in bucket.items():
                        if not isinstance(v, dict):
                            continue
                        if not k.startswith("limit="):
                            continue
                        # Skip expired entries and mark for pruning
                        try:
                            exp = v.get("expires_at")
                            exp_dt = (
                                datetime.fromisoformat(exp)
                                if isinstance(exp, str)
                                else None
                            )
                        except Exception:
                            exp_dt = None
                        if not exp_dt or exp_dt <= now:
                            expired_keys.append(k)
                            continue
                        try:
                            lim = int(k.split("=", 1)[1])
                        except Exception:
                            lim = 0
                        if lim > best_limit:
                            best_limit = lim
                            best_entry = v
                    # Prune expired keys from the file if any
                    if expired_keys:
                        try:
                            for ek in expired_keys:
                                bucket.pop(ek, None)
                            with f.open("w", encoding="utf-8") as outfh:
                                json.dump(doc, outfh, ensure_ascii=False)
                        except Exception:
                            pass

                    if best_entry and isinstance(best_entry.get("data"), dict):
                        items.append(
                            best_entry["data"]
                        )  # includes subreddit, cachedAt, top_posts
                except Exception:
                    # Ignore malformed files
                    continue

        return {"duration": duration, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
