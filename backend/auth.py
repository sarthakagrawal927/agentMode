# DEPRECATED: Production backend is now cloudflare/backend/. Kept as reference.

import os

import httpx
from fastapi import HTTPException, Request


def _load_admin_emails() -> set[str]:
    candidates = [
        os.environ.get("ADMIN_EMAIL", ""),
        os.environ.get("ADMIN_EMAILS", ""),
    ]
    emails: set[str] = set()
    for raw in candidates:
        for value in raw.split(","):
            normalized = value.strip().lower()
            if normalized:
                emails.add(normalized)
    return emails


ADMIN_EMAILS = _load_admin_emails()


async def verify_google_token(token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": token},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    return resp.json()


async def require_admin(request: Request) -> str:
    if not ADMIN_EMAILS:
        raise HTTPException(
            status_code=500,
            detail="Admin access is not configured on the server",
        )
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = auth_header[len("Bearer "):]
    info = await verify_google_token(token)
    email = (info.get("email", "") or "").strip().lower()
    if not email or email not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return email
