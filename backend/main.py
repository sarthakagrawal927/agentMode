# =============================================================================
# DEPRECATED: This Python/FastAPI backend is no longer deployed in production.
# The production backend is the Cloudflare Worker at cloudflare/backend/.
# This code is kept as reference only.
# =============================================================================

from dotenv import load_dotenv

load_dotenv()
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
# from linkedinProfileExtractor import LinkedinProfile
# from jobScraper import getJobDescriptions
from reddit import get_top_posts_for_topic, get_top_posts_for_subreddit
from llm_api import execute_chat_completion, client
import json
from cache import get_cache, set_cache, one_day_ttl_seconds, save_snapshot, get_snapshot, list_snapshot_dates
from db import init_db, close_db, get_pool
from auth import require_admin
from datetime import datetime, timezone
from fastapi.responses import StreamingResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(lifespan=lifespan)

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

DEFAULT_PROMPT = (
    "Analyze top posts and comments for r/{subreddit}. "
    "Summarize key themes, actionable insights, and representative quotes."
)


def _load_prompt_defaults() -> dict[str, str]:
    try:
        prompts_file = Path(__file__).parent / "prompts.json"
        if not prompts_file.exists():
            return {}
        with prompts_file.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        out: dict[str, str] = {}
        for k, v in data.items():
            key = str(k).strip()
            value = str(v).strip()
            if key and value:
                out[key] = value
        return out
    except Exception:
        return {}


PROMPT_DEFAULTS = _load_prompt_defaults()
ALLOWED_SUBREDDITS = {k.lower() for k in PROMPT_DEFAULTS.keys()}


def _persist_prompt_defaults() -> None:
    """Write current PROMPT_DEFAULTS back to prompts.json."""
    try:
        prompts_file = Path(__file__).parent / "prompts.json"
        with prompts_file.open("w", encoding="utf-8") as f:
            json.dump(PROMPT_DEFAULTS, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except Exception:
        pass  # best-effort


async def _read_prompt_map() -> dict:
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT subreddit, prompt FROM prompts")
        db_prompt_map = {row["subreddit"]: row["prompt"] for row in rows}
        if not PROMPT_DEFAULTS:
            return db_prompt_map
        merged = dict(PROMPT_DEFAULTS)
        merged.update(db_prompt_map)
        return merged
    except Exception:
        return dict(PROMPT_DEFAULTS)


async def _write_prompt_map(subreddit: str, prompt: str) -> None:
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO prompts (subreddit, prompt) VALUES ($1, $2)
                ON CONFLICT (subreddit) DO UPDATE SET prompt = EXCLUDED.prompt
                """,
                subreddit,
                prompt,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ARCHIVED: Legacy role research endpoint (disabled — LinkedIn/jobScraper deps removed)
# @app.post("/api/research")
# async def create_research(request: ResearchRequest):
#     ...


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
        cached = await get_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key)
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

        await set_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key, result, one_day_ttl_seconds)

        # Archive today's snapshot
        try:
            await save_snapshot(subreddit_name, duration, result)
        except Exception:
            pass  # best-effort

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Snapshot endpoints
@app.get("/api/research/subreddit/{subreddit}/snapshot/{date}")
async def get_subreddit_snapshot(subreddit: str, date: str, period: str | None = None):
    try:
        data = await get_snapshot(subreddit, date, period)
        if data is not None:
            return data

        # No snapshot exists — fetch fresh data and save it
        duration = period or "1week"
        result = {
            "subreddit": subreddit,
            "period": duration,
            "cachedAt": datetime.now(timezone.utc).isoformat(),
            "top_posts": await get_top_posts_for_subreddit(subreddit, 20, duration),
        }
        try:
            await save_snapshot(subreddit, duration, result)
        except Exception:
            pass
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/research/subreddit/{subreddit}/dates")
async def get_subreddit_dates(subreddit: str):
    try:
        dates = await list_snapshot_dates(subreddit)
        return {"subreddit": subreddit, "dates": dates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Test endpoint
@app.get("/")
async def read_root():
    return {"status": "API is running"}


@app.get("/health")
async def health_check():
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail={"status": "unhealthy", "database": str(e)},
        )


# Feed endpoint: return all cached subreddit results for a given duration
@app.get("/api/research/subreddit/feed")
async def subreddit_feed(duration: str = "1week"):
    try:
        # Normalize/validate duration
        allowed = {"1d", "1week", "1month"}
        if duration not in allowed:
            duration = "1week"

        pool = get_pool()
        now = datetime.now(timezone.utc)

        # Query all non-expired cache entries for the subreddit namespace
        # The key format is: "<subreddit>::limit=<N>::duration=<D>"
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT key, data FROM cache_entries
                WHERE namespace = $1
                  AND key LIKE $2
                  AND expires_at > $3
                """,
                SUBREDDIT_CACHE_NAMESPACE,
                f"%::duration={duration}",
                now,
            )

        # Group by subreddit (first segment of key) and pick the highest limit
        best_by_subreddit: dict = {}
        for row in rows:
            data = json.loads(row["data"])
            if not isinstance(data, dict):
                continue
            key_str: str = row["key"]
            subreddit = key_str.split("::")[0]
            # Extract limit from key
            try:
                limit_part = [p for p in key_str.split("::") if p.startswith("limit=")][0]
                limit_val = int(limit_part.split("=")[1])
            except Exception:
                limit_val = 0
            existing = best_by_subreddit.get(subreddit)
            if existing is None or limit_val > existing[0]:
                best_by_subreddit[subreddit] = (limit_val, data)

        items = [entry[1] for entry in best_by_subreddit.values()]

        return {"duration": duration, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Prompt API
@app.get("/api/prompts")
async def list_prompts():
    try:
        prompts = await _read_prompt_map()
        return {"defaultPrompt": DEFAULT_PROMPT, "prompts": prompts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Streaming AI summary for subreddit data
@app.post("/api/research/subreddit/summary/stream")
async def subreddit_summary_stream(data: dict, admin_email: str = Depends(require_admin)):
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
            prompts = await _read_prompt_map()
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
        cached_data = await get_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key)
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
            "Key Rule: Give information, instead of telling what info the post gives."
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
                        base = await get_cache(SUBREDDIT_CACHE_NAMESPACE, cache_key)
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
                        await set_cache(
                            SUBREDDIT_CACHE_NAMESPACE,
                            cache_key,
                            base,
                            one_day_ttl_seconds,
                        )
                        # Update today's snapshot with AI summary
                        try:
                            await save_snapshot(subreddit_name, duration, base)
                        except Exception:
                            pass
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
        prompts = await _read_prompt_map()
        value = prompts.get(s)
        if isinstance(value, str) and value.strip():
            return {"subreddit": s, "prompt": value, "isDefault": False}
        if s in PROMPT_DEFAULTS:
            return {"subreddit": s, "prompt": PROMPT_DEFAULTS[s], "isDefault": True}
        # Fall back to default prompt with token replacement
        prompt = DEFAULT_PROMPT.replace("{subreddit}", s)
        return {"subreddit": s, "prompt": prompt, "isDefault": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SavePromptRequest(BaseModel):
    prompt: str


@app.post("/api/prompts/{subreddit}")
async def save_subreddit_prompt(subreddit: str, data: SavePromptRequest, admin_email: str = Depends(require_admin)):
    try:
        s = subreddit.strip()
        new_prompt = (data.prompt or "").strip()
        if not new_prompt:
            raise HTTPException(status_code=400, detail="Prompt must be non-empty")
        await _write_prompt_map(s, new_prompt)
        # Add to curated list if new
        added_to_curated = False
        if s.lower() not in ALLOWED_SUBREDDITS:
            ALLOWED_SUBREDDITS.add(s.lower())
            PROMPT_DEFAULTS[s] = new_prompt
            _persist_prompt_defaults()
            added_to_curated = True
        return {"status": "ok", "subreddit": s, "prompt": new_prompt, "addedToCurated": added_to_curated}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/prompts/{subreddit}")
async def delete_subreddit_prompt(subreddit: str, admin_email: str = Depends(require_admin)):
    try:
        s = subreddit.strip()
        if s.lower() not in ALLOWED_SUBREDDITS:
            raise HTTPException(status_code=404, detail="Subreddit not found in curated list")
        # Remove from in-memory sets
        ALLOWED_SUBREDDITS.discard(s.lower())
        # Remove from PROMPT_DEFAULTS (case-insensitive key match)
        key_to_remove = next((k for k in PROMPT_DEFAULTS if k.lower() == s.lower()), None)
        if key_to_remove:
            del PROMPT_DEFAULTS[key_to_remove]
        _persist_prompt_defaults()
        # Remove from DB
        try:
            pool = get_pool()
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM prompts WHERE LOWER(subreddit) = LOWER($1)", s)
        except Exception:
            pass  # best-effort DB cleanup
        return {"status": "ok", "subreddit": s, "removed": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
