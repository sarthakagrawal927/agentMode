# DEPRECATED: Production backend is now cloudflare/backend/. Kept as reference.

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional

from db import get_pool

one_day_ttl_seconds = 24 * 60 * 60


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def get_cache(namespace: str, key: str) -> Optional[Any]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT data FROM cache_entries
            WHERE namespace = $1 AND key = $2 AND expires_at > $3
            """,
            namespace,
            key,
            _now_utc(),
        )
    if row is None:
        return None
    return json.loads(row["data"])


async def set_cache(namespace: str, key: str, data: Any, ttl_seconds: int) -> None:
    expires_at = _now_utc() + timedelta(seconds=ttl_seconds)
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO cache_entries (namespace, key, data, expires_at)
            VALUES ($1, $2, $3::jsonb, $4)
            ON CONFLICT (namespace, key)
            DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at
            """,
            namespace,
            key,
            json.dumps(data, ensure_ascii=False),
            expires_at,
        )


async def save_snapshot(subreddit: str, period: str, data: Any) -> None:
    today = date.today()
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO snapshots (subreddit, snap_date, period, data)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (subreddit, snap_date, period)
            DO UPDATE SET data = EXCLUDED.data
            """,
            subreddit.strip().lower(),
            today,
            period,
            json.dumps(data, ensure_ascii=False),
        )


async def get_snapshot(
    subreddit: str, date_str: str, period: Optional[str] = None
) -> Optional[Any]:
    pool = get_pool()
    async with pool.acquire() as conn:
        if period:
            row = await conn.fetchrow(
                """
                SELECT data FROM snapshots
                WHERE subreddit = $1 AND snap_date = $2 AND period = $3
                """,
                subreddit.strip().lower(),
                date.fromisoformat(date_str),
                period,
            )
        else:
            row = await conn.fetchrow(
                """
                SELECT data FROM snapshots
                WHERE subreddit = $1 AND snap_date = $2
                ORDER BY created_at DESC LIMIT 1
                """,
                subreddit.strip().lower(),
                date.fromisoformat(date_str),
            )
    if row is None:
        return None
    return json.loads(row["data"])


async def list_snapshot_dates(subreddit: str) -> List[str]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT snap_date FROM snapshots
            WHERE subreddit = $1
            ORDER BY snap_date DESC
            """,
            subreddit.strip().lower(),
        )
    return [row["snap_date"].isoformat() for row in rows]
