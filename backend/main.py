from dotenv import load_dotenv

load_dotenv()
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl, constr
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from linkedinProfileExtractor import LinkedinProfile
from jobScraper import getJobDescriptions
from reddit import get_top_posts_for_topic, get_top_posts_for_subreddit
from llm_api import execute_chat_completion, client
import json
from cache import get_cache, set_cache, one_day_ttl_seconds
from datetime import datetime, timezone
from pathlib import Path
from fastapi.responses import StreamingResponse

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

# File-backed prompt store
PROMPTS_FILE = Path(__file__).parent / "prompts.json"
DEFAULT_PROMPT = (
    "Analyze top posts and comments for r/{subreddit}. "
    "Summarize key themes, actionable insights, and representative quotes."
)


def _read_prompt_map() -> dict:
    try:
        if PROMPTS_FILE.exists():
            with PROMPTS_FILE.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
                return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return {}


def _write_prompt_map(prompts: dict) -> None:
    try:
        with PROMPTS_FILE.open("w", encoding="utf-8") as fh:
            json.dump(prompts or {}, fh, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


# Prompt API
@app.get("/api/prompts")
async def list_prompts():
    try:
        prompts = _read_prompt_map()
        return {"defaultPrompt": DEFAULT_PROMPT, "prompts": prompts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Streaming AI summary for subreddit data
@app.post("/api/research/subreddit/summary/stream")
async def subreddit_summary_stream(data: dict):
    try:
        subreddit_name = (data.get("subreddit_name") or "").strip()
        duration = data.get("duration", "1week")
        limit = int(data.get("limit", 20))
        override_prompt = (data.get("prompt") or "").strip()
        provided_reddit_data = data.get(
            "reddit_data"
        )  # Optional pre-fetched data from client

        if not subreddit_name:
            raise HTTPException(status_code=400, detail="Subreddit name required")

        # Determine prompt: override > custom map > default
        if override_prompt:
            system_prompt = override_prompt
        else:
            prompts = _read_prompt_map()
            raw = prompts.get(subreddit_name)
            if isinstance(raw, str) and raw.strip():
                system_prompt = raw
            else:
                system_prompt = DEFAULT_PROMPT.replace("{subreddit}", subreddit_name)

        # Get reddit research data (either from request or freshly computed)
        if provided_reddit_data and isinstance(provided_reddit_data, dict):
            reddit_payload = provided_reddit_data
        else:
            reddit_payload = {
                "subreddit": subreddit_name,
                "period": duration,
                "top_posts": await get_top_posts_for_subreddit(
                    subreddit_name, limit, duration
                ),
            }

        # Check subreddit cache for existing AI summary matching the effective prompt
        cache_key = (
            f"{subreddit_name.strip().lower()}::limit={limit}::duration={duration}"
        )
        cached_data = get_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key)
        if isinstance(cached_data, dict):
            cached_prompt = cached_data.get("ai_prompt_used")
            cached_struct = cached_data.get("ai_summary_structured")
            cached_text = cached_data.get("ai_summary")
            if (
                isinstance(cached_struct, list)
                and isinstance(cached_prompt, str)
                and cached_prompt == system_prompt
            ):

                async def cached_generator():
                    yield json.dumps(cached_struct, ensure_ascii=False)

                return StreamingResponse(
                    cached_generator(), media_type="application/json"
                )
            if (
                isinstance(cached_text, str)
                and isinstance(cached_prompt, str)
                and cached_prompt == system_prompt
            ):

                async def cached_text_gen():
                    yield cached_text

                return StreamingResponse(
                    cached_text_gen(), media_type="text/plain; charset=utf-8"
                )

        # Add temporal and period context to the system message and enforce JSON shape
        now_iso = datetime.now(timezone.utc).isoformat()
        period_label = {
            "1d": "last day",
            "1week": "last week",
            "1month": "last month",
        }.get(duration, duration)
        enriched_system = (
            f"{system_prompt}\n\nContext: Today is {now_iso}. "
            f"Data period: {period_label} (key: {duration}) for r/{subreddit_name}.\n\n"
            "Respond ONLY with a JSON array (no preamble, no code fences). Each item must be: "
            '{"title": string, "desc": string, "sourceId": [postId, optionalCommentId] }. '
            "Use exact IDs from the provided data. If referencing a post only, sourceId = [postId]. "
            "If referencing a specific comment, sourceId = [postId, commentId]. No extra keys, no trailing commas."
        )

        messages = [
            {"role": "system", "content": enriched_system},
            {
                "role": "user",
                "content": json.dumps(reddit_payload, ensure_ascii=False),
            },
        ]

        async def token_generator():
            try:
                stream = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages,
                    stream=True,
                )
                full_text = []
                async for chunk in stream:
                    try:
                        delta = chunk.choices[0].delta
                        content = getattr(delta, "content", None)
                        if content:
                            full_text.append(content)
                            yield content
                    except Exception:
                        continue
                # Persist AI summary and prompt used to subreddit cache
                try:
                    text = "".join(full_text)
                    if text:
                        # Merge into existing cached data if present; otherwise build a minimal structure
                        base = get_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key)
                        if not isinstance(base, dict):
                            base = {
                                "subreddit": subreddit_name,
                                "period": duration,
                                "cachedAt": datetime.now(timezone.utc).isoformat(),
                                "top_posts": reddit_payload.get("top_posts", []),
                            }
                        # Try strict JSON parse -> store structured; else keep text fallback
                        try:
                            parsed = json.loads(text)
                            if isinstance(parsed, list):
                                base["ai_summary_structured"] = parsed
                                base.pop("ai_summary", None)
                            else:
                                base["ai_summary"] = text
                        except Exception:
                            base["ai_summary"] = text
                        base["ai_prompt_used"] = system_prompt
                        set_cache(
                            SUBREDDIT_CACHE_NAMESPACE,
                            cache_key,
                            base,
                            one_day_ttl_seconds,
                        )
                except Exception:
                    # Best-effort cache write; ignore failures
                    pass
            except Exception as e:
                # Emit an error marker and stop
                yield f"\n[Error] {str(e)}\n"

        return StreamingResponse(token_generator(), media_type="application/json")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prompts/{subreddit}")
async def get_subreddit_prompt(subreddit: str):
    try:
        s = subreddit.strip()
        prompts = _read_prompt_map()
        value = prompts.get(s)
        if isinstance(value, str) and value.strip():
            return {"subreddit": s, "prompt": value, "isDefault": False}
        # Fall back to default prompt with token replacement
        prompt = DEFAULT_PROMPT.replace("{subreddit}", s)
        return {"subreddit": s, "prompt": prompt, "isDefault": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SavePromptRequest(BaseModel):
    prompt: str


@app.post("/api/prompts/{subreddit}")
async def save_subreddit_prompt(subreddit: str, data: SavePromptRequest):
    try:
        s = subreddit.strip()
        new_prompt = (data.prompt or "").strip()
        if not new_prompt:
            raise HTTPException(status_code=400, detail="Prompt must be non-empty")
        prompts = _read_prompt_map()
        prompts[s] = new_prompt
        _write_prompt_map(prompts)
        return {"status": "ok", "subreddit": s, "prompt": new_prompt}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
