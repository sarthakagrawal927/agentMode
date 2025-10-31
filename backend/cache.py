from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import hashlib
import json
import os
from pathlib import Path

# Simple namespaced file-based TTL cache.

one_day_ttl_seconds = 24 * 60 * 60


# ----------------------
# Time helpers
# ----------------------
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_expires_at(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


# ----------------------
# Filesystem helpers
# ----------------------
_BASE_DIR = Path(__file__).parent / ".cache"


def _ensure_namespace_dir(namespace: str) -> Path:
    namespace_dir = _BASE_DIR / namespace
    namespace_dir.mkdir(parents=True, exist_ok=True)
    return namespace_dir


def _read_json(path: Path) -> Optional[Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _atomic_write_json(path: Path, obj: Any) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


def _delete_file_quietly(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


def _default_entry_path(namespace: str, key: str) -> Path:
    """Return the file path for a generic cache entry (hashed key)."""
    namespace_dir = _BASE_DIR / namespace
    hashed_key = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return namespace_dir / f"{hashed_key}.json"


# ----------------------
# Subreddit specialization
# ----------------------
_SUBREDDIT_NAMESPACE = "subreddit_research"
_SUBREDDIT_BUCKETS = ("1d", "1week", "1month")


def _is_subreddit_namespace(namespace: str) -> bool:
    return namespace == _SUBREDDIT_NAMESPACE


def _sanitize_filename(name: str) -> str:
    """Filesystem-safe lowering/sanitization for subreddit filenames."""
    safe = []
    for ch in name.lower():
        if ch.isalnum() or ch in ("-", "_", "."):
            safe.append(ch)
        else:
            safe.append("_")
    return "".join(safe) or "_"


def _parse_subreddit_key(key: str) -> Dict[str, str]:
    """Parse key of the form "<subreddit>::limit=<N>::duration=<D>"."""
    parts = key.split("::")
    subreddit = parts[0] if parts else ""
    params: Dict[str, str] = {}
    for fragment in parts[1:]:
        if "=" in fragment:
            k, v = fragment.split("=", 1)
            params[k] = v
    duration = params.get("duration", "1week")
    limit_value = params.get("limit", "20")
    return {
        "subreddit": subreddit,
        "duration": duration,
        "limit_key": f"limit={limit_value}",
    }


def _subreddit_file_path(namespace: str, subreddit: str) -> Path:
    namespace_dir = _BASE_DIR / namespace
    return namespace_dir / f"{_sanitize_filename(subreddit)}.json"


def _get_from_subreddit_cache(namespace: str, key: str) -> Optional[Any]:
    parsed = _parse_subreddit_key(key)
    path = _subreddit_file_path(namespace, parsed["subreddit"])
    if not path.exists():
        return None

    doc = _read_json(path)
    if not isinstance(doc, dict):
        _delete_file_quietly(path)
        return None

    bucket: Dict[str, Any] = doc.get(parsed["duration"], {})
    entry = bucket.get(parsed["limit_key"])
    if not isinstance(entry, dict):
        return None

    expires_at = _parse_expires_at(entry.get("expires_at"))
    if not expires_at or expires_at <= _now_utc():
        # Expired/bad entry: remove and persist
        try:
            bucket.pop(parsed["limit_key"], None)
            _atomic_write_json(path, doc)
        except Exception:
            pass
        return None

    return entry.get("data")


def _set_in_subreddit_cache(
    namespace: str, key: str, data: Any, expires_at: datetime
) -> None:
    parsed = _parse_subreddit_key(key)
    path = _subreddit_file_path(namespace, parsed["subreddit"])

    # Load existing or initialize canonical structure
    doc: Dict[str, Dict[str, Any]] = {k: {} for k in _SUBREDDIT_BUCKETS}
    loaded = _read_json(path)
    if isinstance(loaded, dict):
        doc.update(loaded)

    bucket = doc.setdefault(parsed["duration"], {})
    # Prune obviously expired entries in this bucket
    try:
        keys_to_delete = []
        for existing_key, existing_entry in bucket.items():
            if not isinstance(existing_entry, dict):
                keys_to_delete.append(existing_key)
                continue
            exp = _parse_expires_at(existing_entry.get("expires_at"))
            if not exp or exp <= _now_utc():
                keys_to_delete.append(existing_key)
        for k in keys_to_delete:
            bucket.pop(k, None)
    except Exception:
        pass

    bucket[parsed["limit_key"]] = {
        "expires_at": expires_at.isoformat(),
        "data": data,
    }

    _atomic_write_json(path, doc)


# ----------------------
# Public API
# ----------------------
def get_cache(namespace: str, key: str):
    if _is_subreddit_namespace(namespace):
        return _get_from_subreddit_cache(namespace, key)

    # Default layout: one file per entry (hashed key)
    path = _default_entry_path(namespace, key)
    if not path.exists():
        return None

    payload = _read_json(path)
    if not isinstance(payload, dict):
        _delete_file_quietly(path)
        return None

    expires_at = _parse_expires_at(payload.get("expires_at"))
    if not expires_at or expires_at <= _now_utc():
        _delete_file_quietly(path)
        return None

    return payload.get("data")


def set_cache(namespace: str, key: str, data: Any, ttl_seconds: int) -> None:
    expires_at = _now_utc() + timedelta(seconds=ttl_seconds)
    _ensure_namespace_dir(namespace)

    if _is_subreddit_namespace(namespace):
        _set_in_subreddit_cache(namespace, key, data, expires_at)
        return None

    # Default layout: one file per entry (hashed key)
    path = _default_entry_path(namespace, key)
    payload = {"expires_at": expires_at.isoformat(), "data": data}
    _atomic_write_json(path, payload)
    return None
