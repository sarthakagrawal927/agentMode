# DEPRECATED: Production backend is now cloudflare/backend/. Kept as reference.

import json
import os
import ssl
from pathlib import Path

import asyncpg

_pool: asyncpg.Pool | None = None

_SCHEMA_SQL = """
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
"""


async def init_db() -> None:
    global _pool
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    # CockroachDB requires SSL; use system CA bundle so it works on any host
    ssl_ctx = ssl.create_default_context()
    _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10, ssl=ssl_ctx)
    async with _pool.acquire() as conn:
        await conn.execute(_SCHEMA_SQL)
    await _seed_prompts_if_needed()


async def close_db() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_db() first.")
    return _pool


async def _seed_prompts_if_needed() -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM prompts")
        if count > 0:
            return

        prompts_file = Path(__file__).parent / "prompts.json"
        if not prompts_file.exists():
            return

        with prompts_file.open("r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict) or not data:
            return

        await conn.executemany(
            "INSERT INTO prompts (subreddit, prompt) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [(k, v) for k, v in data.items()],
        )
