from datetime import datetime, timedelta, timezone
from typing import Any, Dict

# Simple namespaced in-memory TTL cache.
_CACHE: Dict[str, Dict[str, Dict[str, Any]]] = {}

one_day_ttl_seconds = 24 * 60 * 60


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_cache(namespace: str, key: str):
    ns = _CACHE.get(namespace)
    if not ns:
        return None
    entry = ns.get(key)
    if not entry:
        return None
    expires_at = entry.get("expires_at")
    if not expires_at or expires_at <= _now_utc():
        # Expired; cleanup and miss
        try:
            del ns[key]
        except Exception:
            pass
        return None
    return entry.get("data")


def set_cache(namespace: str, key: str, data: Any, ttl_seconds: int) -> None:
    expires_at = _now_utc() + timedelta(seconds=ttl_seconds)
    ns = _CACHE.setdefault(namespace, {})
    ns[key] = {"expires_at": expires_at, "data": data}


