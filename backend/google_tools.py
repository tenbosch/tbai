"""Optional per-user Google integration (Calendar / Gmail / Drive, read-only).

Sign-in stays ID-token-only; connecting Google services is a separate opt-in
auth-code exchange (POST /auth/google/connect, wired in main.py). The refresh
token is stored Fernet-encrypted (key derived from JWT_SECRET) in
`google_credentials`; short-lived access tokens are cached in memory.

All content fetched from Google (email snippets, event titles, file names) is
third-party-writable — anyone can email you or invite you — so tool results
carry the same untrusted-data notice as web search results.
"""

import base64
import hashlib
import os
import time
from datetime import datetime, timedelta

import httpx
from cryptography.fernet import Fernet

from db import connect as db_connect
from tools import UNTRUSTED_DATA_NOTICE, ToolContext, register_tool

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/calendar.readonly "
    "https://www.googleapis.com/auth/gmail.readonly "
    "https://www.googleapis.com/auth/drive.metadata.readonly"
)

_NOT_CONNECTED = (
    "The user hasn't connected their Google account yet. Tell them they can "
    "connect it under Settings (profile icon) → Google services."
)

# user_id -> (access_token, expiry_epoch)
_token_cache: dict[int, tuple[str, float]] = {}


def _fernet() -> Fernet:
    digest = hashlib.sha256(os.environ["JWT_SECRET"].encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_refresh_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_refresh_token(blob: str) -> str:
    return _fernet().decrypt(blob.encode()).decode()


async def exchange_auth_code(code: str) -> dict:
    """Exchange an auth-code-flow code for tokens. Raises httpx.HTTPStatusError."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": os.environ["GOOGLE_CLIENT_ID"],
                "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                # @react-oauth/google's auth-code popup flow uses this literal value
                "redirect_uri": "postmessage",
                "grant_type": "authorization_code",
            },
        )
    resp.raise_for_status()
    return resp.json()


async def revoke_refresh_token(refresh_token: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(GOOGLE_REVOKE_URL, params={"token": refresh_token})
    except httpx.HTTPError:
        pass  # best-effort; the row is deleted regardless


async def _get_access_token(user_id: int) -> str | None:
    cached = _token_cache.get(user_id)
    if cached and cached[1] > time.time() + 60:
        return cached[0]

    async with db_connect() as db:
        async with db.execute(
            "SELECT refresh_token FROM google_credentials WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None

    refresh_token = decrypt_refresh_token(row[0])
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": os.environ["GOOGLE_CLIENT_ID"],
                "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                "grant_type": "refresh_token",
            },
        )
    if resp.status_code != 200:
        return None  # revoked/expired — user needs to reconnect
    data = resp.json()
    token = data["access_token"]
    _token_cache[user_id] = (token, time.time() + int(data.get("expires_in", 3600)))
    return token


def invalidate_token_cache(user_id: int) -> None:
    _token_cache.pop(user_id, None)


async def _google_get(token: str, url: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


def _clean(text: str, limit: int = 300) -> str:
    return " ".join((text or "").split())[:limit]


# ── Calendar ──────────────────────────────────────────────────────────────────

async def fetch_calendar_events(user_id: int, time_min: str, time_max: str) -> list[dict] | None:
    """Events on the primary calendar between two local 'YYYY-MM-DD' dates.
    Returns None if the user isn't connected."""
    token = await _get_access_token(user_id)
    if token is None:
        return None
    tz = datetime.now().astimezone().tzinfo
    start = datetime.strptime(time_min, "%Y-%m-%d").replace(tzinfo=tz)
    end = datetime.strptime(time_max, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=1)
    data = await _google_get(
        token,
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
            "timeMin": start.isoformat(),
            "timeMax": end.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 20,
        },
    )
    events = []
    for item in data.get("items", []):
        start_raw = item.get("start", {})
        events.append(
            {
                "summary": _clean(item.get("summary", "(no title)"), 120),
                "start": start_raw.get("dateTime") or start_raw.get("date") or "",
                "location": _clean(item.get("location", ""), 120),
            }
        )
    return events


@register_tool(
    "calendar_list_events",
    description=(
        "List events on the user's Google Calendar between two dates. "
        "Dates are local 'YYYY-MM-DD'; use the same date twice for a single day."
    ),
    parameters={
        "type": "object",
        "properties": {
            "time_min": {"type": "string", "description": "Start date, 'YYYY-MM-DD'"},
            "time_max": {"type": "string", "description": "End date (inclusive), 'YYYY-MM-DD'"},
        },
        "required": ["time_min", "time_max"],
    },
    status="Checking the calendar…",
)
async def calendar_list_events(args: dict, ctx: ToolContext):
    try:
        events = await fetch_calendar_events(
            ctx.user_id, args.get("time_min") or "", args.get("time_max") or ""
        )
    except ValueError:
        return "Error: dates must be 'YYYY-MM-DD'."
    except httpx.HTTPError as exc:
        return f"Error: calendar request failed ({exc})."
    if events is None:
        return _NOT_CONNECTED
    if not events:
        return "No events in that period."
    lines = [
        f"- {e['start']}: {e['summary']}" + (f" @ {e['location']}" if e["location"] else "")
        for e in events
    ]
    return UNTRUSTED_DATA_NOTICE + "Calendar events:\n" + "\n".join(lines)


# ── Gmail ─────────────────────────────────────────────────────────────────────

@register_tool(
    "gmail_search",
    description=(
        "Search the user's Gmail. Supports Gmail query syntax "
        "(e.g. 'from:school newer_than:7d', 'subject:invoice is:unread')."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Gmail search query"},
            "max_results": {"type": "integer", "description": "Max messages to return (default 5)"},
        },
        "required": ["query"],
    },
    status="Searching email…",
)
async def gmail_search(args: dict, ctx: ToolContext):
    token = await _get_access_token(ctx.user_id)
    if token is None:
        return _NOT_CONNECTED
    query = (args.get("query") or "").strip()
    if not query:
        return "Error: no query provided."
    max_results = min(int(args.get("max_results") or 5), 10)
    try:
        listing = await _google_get(
            token,
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            {"q": query, "maxResults": max_results},
        )
        ids = [m["id"] for m in listing.get("messages", [])]
        if not ids:
            return "No emails match that search."
        lines = []
        for mid in ids:
            msg = await _google_get(
                token,
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{mid}",
                {"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
            )
            headers = {
                h["name"]: h["value"]
                for h in msg.get("payload", {}).get("headers", [])
            }
            lines.append(
                f"- From: {_clean(headers.get('From', '?'), 80)} | "
                f"Date: {_clean(headers.get('Date', '?'), 40)} | "
                f"Subject: {_clean(headers.get('Subject', '(none)'), 120)}\n"
                f"  {_clean(msg.get('snippet', ''), 250)}"
            )
    except httpx.HTTPError as exc:
        return f"Error: Gmail request failed ({exc})."
    return UNTRUSTED_DATA_NOTICE + "Email results:\n" + "\n".join(lines)


# ── Drive ─────────────────────────────────────────────────────────────────────

@register_tool(
    "drive_search",
    description="Search the user's Google Drive by file name or content keywords.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keywords to search for"},
        },
        "required": ["query"],
    },
    status="Searching Drive…",
)
async def drive_search(args: dict, ctx: ToolContext):
    token = await _get_access_token(ctx.user_id)
    if token is None:
        return _NOT_CONNECTED
    query = (args.get("query") or "").strip().replace("'", r"\'")
    if not query:
        return "Error: no query provided."
    try:
        data = await _google_get(
            token,
            "https://www.googleapis.com/drive/v3/files",
            {
                "q": f"name contains '{query}' and trashed = false",
                "fields": "files(name, mimeType, webViewLink, modifiedTime)",
                "pageSize": 10,
            },
        )
    except httpx.HTTPError as exc:
        return f"Error: Drive request failed ({exc})."
    files = data.get("files", [])
    if not files:
        return "No Drive files match that search."
    lines = [
        f"- {_clean(f.get('name'), 100)} ({f.get('mimeType', '?').split('.')[-1]}, "
        f"modified {_clean(f.get('modifiedTime', '?'), 20)}) {f.get('webViewLink', '')}"
        for f in files
    ]
    return UNTRUSTED_DATA_NOTICE + "Drive files:\n" + "\n".join(lines)
