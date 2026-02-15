import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

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
