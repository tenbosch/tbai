import asyncio
import base64
import json
import logging
import os
import uuid
from pathlib import Path

import aiosqlite
import httpx
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from google.auth import exceptions as google_exceptions
from pydantic import BaseModel, EmailStr, Field
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from auth import create_app_jwt, get_current_user, require_admin, verify_google_token
from agent_logic import stream_agent
from db import connect as db_connect
import databricks_provider
import google_tools  # importing registers the calendar/gmail/drive tools
import wikipedia_tools  # importing registers the wikipedia_lookup tool
import mcp_client
import providers
import skills  # importing also registers the load_skill tool
from lists import router as lists_router  # importing also registers list tools
from memory import delete_user_fact, get_user_facts  # importing also registers memory tools
from reminders import router as reminders_router  # importing also registers reminder tools
from scheduler import scheduler_loop
from security import get_client_ip, get_user_or_ip, limiter
from tools import ToolContext

load_dotenv()

log = logging.getLogger("tbai.main")


async def init_db():
    async with db_connect() as db:
        # WAL lets concurrent readers proceed while a writer commits — without it,
        # two family members chatting at once hit "database is locked". The mode
        # persists in the DB file, so setting it once at startup is enough.
        await db.execute("PRAGMA journal_mode = WAL")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT UNIQUE NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL DEFAULT 1,
                title      TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content    TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)

        # Additive migrations — safe to run on every startup
        for alter_stmt in [
            "ALTER TABLE users ADD COLUMN email        TEXT",
            "ALTER TABLE users ADD COLUMN google_sub   TEXT",
            "ALTER TABLE users ADD COLUMN display_name TEXT",
            "ALTER TABLE users ADD COLUMN given_name   TEXT",
            "ALTER TABLE users ADD COLUMN avatar_url   TEXT",
            "ALTER TABLE users ADD COLUMN is_admin     INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN custom_name  TEXT",
            "ALTER TABLE users ADD COLUMN theme_mode   TEXT NOT NULL DEFAULT 'light'",
            "ALTER TABLE users ADD COLUMN theme_accent TEXT NOT NULL DEFAULT 'mauve'",
        ]:
            try:
                await db.execute(alter_stmt)
            except Exception:
                pass  # column already exists on subsequent startups

        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email "
            "ON users(email) WHERE email IS NOT NULL"
        )
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub "
            "ON users(google_sub) WHERE google_sub IS NOT NULL"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"
        )

        await db.execute("""
            CREATE TABLE IF NOT EXISTS allowed_emails (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                email      TEXT UNIQUE NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS login_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                email        TEXT NOT NULL,
                display_name TEXT,
                outcome      TEXT NOT NULL,
                ip_address   TEXT,
                created_at   TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS activity_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER,
                email        TEXT,
                display_name TEXT,
                event        TEXT NOT NULL,
                session_id   INTEGER,
                model        TEXT,
                ip_address   TEXT,
                created_at   TEXT DEFAULT (datetime('now'))
            )
        """)

        for alter_stmt in [
            "ALTER TABLE activity_log ADD COLUMN message_id    INTEGER",
            "ALTER TABLE activity_log ADD COLUMN feedback_text TEXT",
        ]:
            try:
                await db.execute(alter_stmt)
            except Exception:
                pass  # column already exists on subsequent startups

        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_facts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                fact       TEXT NOT NULL,
                category   TEXT NOT NULL DEFAULT 'general',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id)"
        )

        await db.execute("""
            CREATE TABLE IF NOT EXISTS lists (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL DEFAULT 'todo' CHECK(kind IN ('shopping','todo','meal')),
                created_by INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS list_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id    INTEGER NOT NULL,
                text       TEXT NOT NULL,
                done       INTEGER NOT NULL DEFAULT 0,
                added_by   INTEGER,
                created_at TEXT DEFAULT (datetime('now')),
                done_at    TEXT,
                FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id)"
        )
        await db.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL,
                title        TEXT NOT NULL,
                due_at       TEXT NOT NULL,
                recurrence   TEXT CHECK(recurrence IN ('daily','weekly','monthly')),
                status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','dismissed')),
                created_at   TEXT DEFAULT (datetime('now')),
                delivered_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status, due_at)"
        )
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                kind       TEXT NOT NULL,
                title      TEXT NOT NULL,
                body       TEXT,
                read       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read)"
        )

        for alter_stmt in [
            "ALTER TABLE users ADD COLUMN briefing_hour       INTEGER",
            "ALTER TABLE users ADD COLUMN last_briefing_date  TEXT",
            "ALTER TABLE users ADD COLUMN default_model       TEXT",
        ]:
            try:
                await db.execute(alter_stmt)
            except Exception:
                pass  # column already exists on subsequent startups

        await db.execute("""
            CREATE TABLE IF NOT EXISTS google_credentials (
                user_id       INTEGER PRIMARY KEY,
                refresh_token TEXT NOT NULL,
                scopes        TEXT,
                created_at    TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS attachments (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL,
                message_id    INTEGER,
                path          TEXT NOT NULL,
                mime          TEXT NOT NULL,
                original_name TEXT,
                created_at    TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # Which tools/skills produced each assistant message. The agent loops keep
        # their tool_call/tool-result messages in an in-memory list that dies with
        # the turn, so without this row the model has no way to answer "did you use
        # the skill?" on a later turn — and used to confabulate a denial. Unlike
        # `attachments` this cascades from `messages`, so it needs no prune sweep.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS message_tools (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                tool_name  TEXT NOT NULL,
                detail     TEXT,
                ordinal    INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_message_tools_message "
            "ON message_tools(message_id)"
        )

        # Seed the legacy default user (id=1); authenticated users will have real emails.
        await db.execute(
            "INSERT OR IGNORE INTO users (id, username) VALUES (1, 'default')"
        )
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Neither of these may block startup: a malformed skill file or a broken MCP
    # server must leave the app fully usable (the failure shows in the admin panel).
    try:
        skills.load_skills()
    except Exception:
        log.exception("failed to load skills")
    try:
        await mcp_client.connect_all()
    except Exception:
        log.exception("failed to connect MCP servers")

    scheduler_task = asyncio.create_task(scheduler_loop())
    yield
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    try:
        await mcp_client.shutdown()
    except Exception:
        log.exception("error shutting down MCP servers")


app = FastAPI(lifespan=lifespan)
app.include_router(lists_router)
app.include_router(reminders_router)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "https://localhost:5173")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 'unsafe-inline' is required for script-src/style-src: index.html has an
# inline <script> polyfill (Brave/Vite compatibility workaround) and every
# React component styles itself via inline style={} attributes rather than
# CSS classes — a stricter policy would break both.
_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://accounts.google.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self' https://accounts.google.com; "
    "frame-src https://accounts.google.com; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


class ChatRequest(BaseModel):
    model: str = "gemma4"
    prompt: str = Field(min_length=1, max_length=8000)
    session_id: int
    attachment_ids: list[int] = Field(default_factory=list, max_length=4)


class GoogleLoginRequest(BaseModel):
    id_token: str


class AllowedEmailCreate(BaseModel):
    email: EmailStr

class SetAdminRequest(BaseModel):
    is_admin: bool


class FeedbackRequest(BaseModel):
    rating: str  # "up" or "down"
    text: str | None = Field(default=None, max_length=2000)


class SkillWrite(BaseModel):
    # Caps mirror backend/skills.py; skills._validate_fields re-checks them after
    # trimming, so the two can't drift into disagreement.
    name: str = Field(min_length=1, max_length=skills.MAX_NAME_LEN)
    description: str = Field(min_length=1, max_length=skills.MAX_DESCRIPTION_LEN)
    body: str = Field(min_length=1, max_length=skills.MAX_SKILL_CHARS)
    enabled: bool = True


class SkillEnabledRequest(BaseModel):
    enabled: bool


ALLOWED_THEME_MODES = {"light", "dark"}
ALLOWED_THEME_ACCENTS = {"blue", "mauve", "green", "pink", "peach"}


class ProfileUpdateRequest(BaseModel):
    custom_name: str | None = None
    theme_mode: str | None = None
    theme_accent: str | None = None
    briefing_hour: int | None = None
    default_model: str | None = None


# Explicit whitelist of columns update_my_profile is allowed to write, so a
# future field added to ProfileUpdateRequest can't be interpolated into SQL
# as a column name without an intentional decision to add it here too.
PROFILE_COLUMN_WHITELIST = {"custom_name", "theme_mode", "theme_accent", "briefing_hour", "default_model"}


# ── Ollama streaming ──────────────────────────────────────────────────────────

def _render_sources_markdown(items: list[dict]) -> str:
    if not items:
        return ""
    lines = "\n".join(f"- [{s['title']}]({s['url']})" for s in items)
    return f"\n\n---\n**Sources:**\n{lines}\n"


async def _tools_for_session(db, session_id: int) -> dict[int, list[dict]]:
    """{message_id: [{"name", "detail"}, …]} for one session, in call order."""
    async with db.execute(
        "SELECT mt.message_id, mt.tool_name, mt.detail "
        "FROM message_tools mt JOIN messages m ON m.id = mt.message_id "
        "WHERE m.session_id = ? ORDER BY mt.message_id, mt.ordinal",
        (session_id,),
    ) as cur:
        rows = await cur.fetchall()
    out: dict[int, list[dict]] = {}
    for message_id, name, detail in rows:
        out.setdefault(message_id, []).append({"name": name, "detail": detail})
    return out


def _format_tools_used(tools: list[dict]) -> str:
    """Render a tool record as the compact annotation the model reads back."""
    parts = [f"{t['name']}({t['detail']})" if t.get("detail") else t["name"] for t in tools]
    return f"[tools used: {', '.join(parts)}]"


def _dedupe_tools(tools_used: list[dict]) -> list[dict]:
    """Collapse repeat calls, preserving first-call order.

    A turn may call web_search three times; the useful record is *that* it
    searched, not how often.
    """
    seen: set[tuple] = set()
    out: list[dict] = []
    for t in tools_used or []:
        key = (t.get("name"), t.get("detail"))
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": t.get("name"), "detail": t.get("detail")})
    return out


async def _save_assistant_message(
    session_id: int, content: str, tools_used: list[dict] | None = None
) -> int:
    async with db_connect() as db:
        cursor = await db.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)",
            (session_id, content),
        )
        message_id = cursor.lastrowid
        tools = _dedupe_tools(tools_used or [])
        if tools:
            # Same transaction as the message itself, so a reply can never be
            # saved with its tool record missing.
            await db.executemany(
                "INSERT INTO message_tools (message_id, tool_name, detail, ordinal) "
                "VALUES (?, ?, ?, ?)",
                [(message_id, t["name"], t["detail"], i) for i, t in enumerate(tools)],
            )
        await db.execute(
            "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
            (session_id,),
        )
        await db.commit()
        return message_id


async def stream_agent_and_save(
    model: str,
    history: list[dict],
    user_prompt: str,
    session_id: int,
    ctx: ToolContext,
    images: list[dict] | None = None,
    notice: str | None = None,
):
    """Runs the agent and streams NDJSON events to the HTTP client.

    Answer tokens (plus a rendered sources block) are persisted as the assistant
    message; status/error events are ephemeral. The save runs in a finally block
    so a client disconnect or mid-stream error still persists whatever was
    generated. On disconnect the enclosing task is being cancelled, which makes
    every await in this frame re-raise CancelledError — so the save runs as a
    shielded task that completes on the loop even if awaiting it is aborted.
    On normal completion a final {"type": "done", "message_id": id} event
    carries the new row's id so the frontend doesn't need to refetch the session.
    """
    tokens: list[str] = []
    sources_md = ""
    message_id = None
    completed = False
    try:
        # A vision auto-switch note (if any) is emitted as reply text so it's
        # both visible in the bubble and persisted with the saved message —
        # unlike a "status" event, which the frontend clears on the first token.
        if notice:
            tokens.append(notice)
            yield json.dumps({"type": "token", "text": notice}) + "\n"
        async for event in stream_agent(model, history, user_prompt, ctx, images=images):
            if event["type"] == "token":
                tokens.append(event["text"])
            elif event["type"] == "sources":
                sources_md = _render_sources_markdown(event["items"])
            yield json.dumps(event) + "\n"
        completed = True
    finally:
        full_response = "".join(tokens) + sources_md
        tools_used = _dedupe_tools(ctx.tools_used)
        if full_response.strip():
            save_task = asyncio.create_task(
                _save_assistant_message(session_id, full_response, ctx.tools_used)
            )
            try:
                message_id = await asyncio.shield(save_task)
            except asyncio.CancelledError:
                # We're being torn down; the shielded task still runs to
                # completion in the background, so the reply is not lost.
                pass
    if completed and message_id is not None:
        # Carry the tool record on `done` so the just-streamed bubble can show it
        # without refetching the session, exactly as message_id already does.
        yield json.dumps(
            {"type": "done", "message_id": message_id, "tools_used": tools_used}
        ) + "\n"


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/auth/google")
@limiter.limit("10/minute")
async def google_login(req: GoogleLoginRequest, request: Request):
    try:
        ginfo = verify_google_token(req.id_token)
    except google_exceptions.TransportError:
        raise HTTPException(status_code=503, detail="Could not reach Google to verify the token")
    except (ValueError, google_exceptions.GoogleAuthError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Google token: {exc}")

    email = ginfo["email"]
    admin_emails = {
        e.strip()
        for e in os.getenv("ADMIN_EMAILS", "").split(",")
        if e.strip()
    }
    env_is_admin = email in admin_emails
    ip = get_client_ip(request)

    async with db_connect() as db:
        if not env_is_admin:
            async with db.execute(
                "SELECT id FROM allowed_emails WHERE email = ?", (email,)
            ) as cur:
                if not await cur.fetchone():
                    await db.execute(
                        "INSERT INTO activity_log (email, display_name, event, ip_address) "
                        "VALUES (?, ?, 'login_denied', ?)",
                        (email, ginfo["display_name"], ip),
                    )
                    await db.commit()
                    raise HTTPException(status_code=403, detail="Email not authorized")

        async with db.execute(
            "SELECT id, is_admin FROM users WHERE google_sub = ?", (ginfo["google_sub"],)
        ) as cur:
            row = await cur.fetchone()

        is_new_admin = False
        if row is None:
            try:
                cursor = await db.execute(
                    "INSERT INTO users (email, google_sub, display_name, given_name, avatar_url, is_admin, username) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (email, ginfo["google_sub"], ginfo["display_name"], ginfo["given_name"],
                     ginfo["avatar_url"], int(env_is_admin), email),
                )
                user_id = cursor.lastrowid
                is_admin = env_is_admin
                is_new_admin = is_admin
            except aiosqlite.IntegrityError:
                # Lost a concurrent first-login race for the same account —
                # the row exists now; fall through to the update path.
                async with db.execute(
                    "SELECT id, is_admin FROM users WHERE google_sub = ?",
                    (ginfo["google_sub"],),
                ) as cur:
                    row = await cur.fetchone()
        if row is not None:
            user_id, existing_is_admin = row[0], bool(row[1])
            # ADMIN_EMAILS can grant admin on login but must never revoke DB-granted
            # admin status from someone the admin panel promoted but who isn't (or
            # is no longer) listed in the env var — only PATCH /admin/users/{id}/admin
            # or the admin panel can revoke that. (An env-listed admin, conversely,
            # can only be revoked by editing ADMIN_EMAILS and restarting.)
            is_admin = env_is_admin or existing_is_admin
            await db.execute(
                "UPDATE users SET display_name=?, given_name=?, avatar_url=?, is_admin=? WHERE id=?",
                (ginfo["display_name"], ginfo["given_name"], ginfo["avatar_url"], int(is_admin), user_id),
            )

        # Transfer legacy sessions (user_id=1) to the first new admin user
        if is_new_admin:
            await db.execute(
                "UPDATE sessions SET user_id = ? WHERE user_id = 1",
                (user_id,),
            )

        await db.execute(
            "INSERT INTO activity_log (user_id, email, display_name, event, ip_address) "
            "VALUES (?, ?, ?, 'login', ?)",
            (user_id, email, ginfo["display_name"], ip),
        )
        await db.commit()

        async with db.execute(
            "SELECT custom_name, theme_mode, theme_accent FROM users WHERE id = ?",
            (user_id,),
        ) as cur:
            custom_name, theme_mode, theme_accent = await cur.fetchone()

    token = create_app_jwt(
        user_id=user_id,
        email=email,
        display_name=ginfo["display_name"],
        given_name=ginfo["given_name"],
        avatar_url=ginfo["avatar_url"],
        is_admin=is_admin,
    )
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "display_name": ginfo["display_name"],
            "given_name": ginfo["given_name"],
            "avatar_url": ginfo["avatar_url"],
            "is_admin": is_admin,
            "custom_name": custom_name,
            "theme_mode": theme_mode,
            "theme_accent": theme_accent,
        },
    }


# ── Google services connect (opt-in, read-only scopes) ───────────────────────

class GoogleConnectRequest(BaseModel):
    code: str


@app.post("/auth/google/connect")
async def google_connect(req: GoogleConnectRequest, current_user: dict = Depends(get_current_user)):
    if not os.getenv("GOOGLE_CLIENT_SECRET"):
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_CLIENT_SECRET is not configured in backend/.env",
        )
    try:
        tokens = await google_tools.exchange_auth_code(req.code)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=400, detail=f"Google code exchange failed: {exc.response.text[:200]}")
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Could not reach Google")

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        # Google only returns a refresh token on the first consent; a re-consent
        # without prompt=consent omits it. The frontend requests offline access,
        # so this mainly means "already connected elsewhere".
        raise HTTPException(
            status_code=400,
            detail="Google did not return a refresh token — disconnect and try again",
        )

    user_id = int(current_user["sub"])
    async with db_connect() as db:
        await db.execute(
            "INSERT INTO google_credentials (user_id, refresh_token, scopes) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, "
            "scopes = excluded.scopes, created_at = datetime('now')",
            (user_id, google_tools.encrypt_refresh_token(refresh_token), tokens.get("scope", "")),
        )
        await db.commit()
    google_tools.invalidate_token_cache(user_id)
    return {"connected": True}


@app.get("/auth/google/status")
async def google_status(current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        async with db.execute(
            "SELECT scopes, created_at FROM google_credentials WHERE user_id = ?",
            (int(current_user["sub"]),),
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return {"connected": False}
    return {"connected": True, "scopes": row[0], "connected_at": row[1]}


@app.delete("/auth/google/connect", status_code=204)
async def google_disconnect(current_user: dict = Depends(get_current_user)):
    user_id = int(current_user["sub"])
    async with db_connect() as db:
        async with db.execute(
            "SELECT refresh_token FROM google_credentials WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            await google_tools.revoke_refresh_token(
                google_tools.decrypt_refresh_token(row[0])
            )
            await db.execute("DELETE FROM google_credentials WHERE user_id = ?", (user_id,))
            await db.commit()
    google_tools.invalidate_token_cache(user_id)


# ── Admin endpoints ───────────────────────────────────────────────────────────

@app.get("/admin/allowed-emails")
async def list_allowed_emails(_: dict = Depends(require_admin)):
    env_admins = {e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
    async with db_connect() as db:
        async with db.execute(
            """
            SELECT ae.id, ae.email, ae.created_at, u.id, u.display_name, u.is_admin
            FROM allowed_emails ae
            LEFT JOIN users u ON u.email = ae.email
            ORDER BY ae.created_at DESC
            """
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "id": r[0],
            "email": r[1],
            "created_at": r[2],
            "user_id": r[3],
            "display_name": r[4],
            "is_admin": bool(r[5]) if r[5] is not None else False,
            "is_env_admin": r[1] in env_admins,
        }
        for r in rows
    ]


@app.patch("/admin/users/{user_id}/admin")
async def set_user_admin(user_id: int, req: SetAdminRequest, current_admin: dict = Depends(require_admin)):
    if user_id == int(current_admin["sub"]):
        raise HTTPException(status_code=400, detail="Cannot change your own admin status")
    async with db_connect() as db:
        await db.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(req.is_admin), user_id))
        await db.commit()
    return {"user_id": user_id, "is_admin": req.is_admin}


@app.post("/admin/allowed-emails", status_code=201)
async def add_allowed_email(req: AllowedEmailCreate, _: dict = Depends(require_admin)):
    async with db_connect() as db:
        try:
            await db.execute(
                "INSERT INTO allowed_emails (email) VALUES (?)", (req.email,)
            )
            await db.commit()
        except aiosqlite.IntegrityError:
            raise HTTPException(status_code=409, detail="Email already whitelisted")
    return {"email": req.email}


@app.get("/admin/activity")
async def list_activity(_: dict = Depends(require_admin)):
    async with db_connect() as db:
        async with db.execute(
            "SELECT user_id, email, display_name, event, session_id, model, ip_address, created_at, "
            "message_id, feedback_text "
            "FROM activity_log ORDER BY created_at DESC LIMIT 500"
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "user_id": r[0], "email": r[1], "display_name": r[2], "event": r[3],
            "session_id": r[4], "model": r[5], "ip_address": r[6], "created_at": r[7],
            "message_id": r[8], "feedback_text": r[9],
        }
        for r in rows
    ]


@app.delete("/admin/allowed-emails/{email}", status_code=204)
async def remove_allowed_email(email: EmailStr, _: dict = Depends(require_admin)):
    async with db_connect() as db:
        await db.execute("DELETE FROM allowed_emails WHERE email = ?", (email,))
        await db.commit()


# ── Skills & MCP servers (admin) ──────────────────────────────────────────────
#
# Both are configured on disk (backend/skills/*.md, backend/mcp_servers.json),
# not in the DB. Skills are editable from the admin UI because a SKILL.md is
# inert markdown; MCP servers stay read-only + reload, because a web form must
# never get to author a subprocess command line.
#
# Every skill mutation ends with load_skills() and returns the same payload the
# reload endpoint does, so the client stays in sync in one round-trip.

def _skills_payload() -> dict:
    return {
        "skills": [
            {
                "name": s.name,
                "description": s.description,
                "path": s.path,
                "slug": s.slug,
                "chars": len(s.body),
                "truncated": s.truncated,
                "enabled": s.enabled,
            }
            for s in skills.SKILL_INDEX.values()
        ],
        "load_errors": list(skills.LOAD_ERRORS),
    }


def _skills_reloaded() -> dict:
    skills.load_skills()
    return _skills_payload()


async def _log_skill_event(admin: dict, event: str, slug: str) -> None:
    # The slug rides in `feedback_text` — it's the table's only free-text column,
    # and the admin UI already renders it as the row's Detail. Cheaper than a
    # migration for a column that would hold the same thing.
    async with db_connect() as db:
        await db.execute(
            "INSERT INTO activity_log (user_id, email, display_name, event, feedback_text) "
            "VALUES (?, ?, ?, ?, ?)",
            (int(admin["sub"]), admin.get("email"), admin.get("display_name"), event, slug),
        )
        await db.commit()


def _skill_write_error(exc: Exception) -> HTTPException:
    """Map the skills module's exceptions onto status codes."""
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail="No such skill")
    if isinstance(exc, skills.SkillExists):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    log.exception("skill write failed")
    return HTTPException(status_code=500, detail="Could not write the skill file")


@app.get("/admin/skills")
async def list_skills(_: dict = Depends(require_admin)):
    return _skills_payload()


@app.post("/admin/skills/reload")
async def reload_skills(_: dict = Depends(require_admin)):
    return _skills_reloaded()


@app.get("/admin/skills/{slug}")
async def get_skill(slug: str, _: dict = Depends(require_admin)):
    """One skill's editable content, read from disk rather than from SKILL_INDEX.

    A file that currently fails to load comes back too, with `error` set — that's
    the repair path for a broken SKILL.md.
    """
    try:
        skill = skills.read_skill_file(slug)
    except ValueError as exc:
        raise _skill_write_error(exc) from None
    if skill is None:
        raise HTTPException(status_code=404, detail="No such skill")
    return skill


@app.post("/admin/skills", status_code=201)
async def create_skill(req: SkillWrite, current_admin: dict = Depends(require_admin)):
    try:
        slug = skills.create_skill(req.name, req.description, req.body, req.enabled)
    except Exception as exc:
        raise _skill_write_error(exc) from None
    await _log_skill_event(current_admin, "skill_created", slug)
    return _skills_reloaded()


@app.put("/admin/skills/{slug}")
async def update_skill(slug: str, req: SkillWrite, current_admin: dict = Depends(require_admin)):
    try:
        new_slug = skills.update_skill(slug, req.name, req.description, req.body, req.enabled)
    except Exception as exc:
        raise _skill_write_error(exc) from None
    await _log_skill_event(current_admin, "skill_updated", new_slug)
    return _skills_reloaded()


@app.patch("/admin/skills/{slug}/enabled")
async def set_skill_enabled(slug: str, req: SkillEnabledRequest, current_admin: dict = Depends(require_admin)):
    try:
        skills.set_skill_enabled(slug, req.enabled)
    except Exception as exc:
        raise _skill_write_error(exc) from None
    await _log_skill_event(current_admin, "skill_updated", slug)
    return _skills_reloaded()


@app.delete("/admin/skills/{slug}")
async def delete_skill(slug: str, current_admin: dict = Depends(require_admin)):
    try:
        skills.delete_skill(slug)
    except Exception as exc:
        raise _skill_write_error(exc) from None
    await _log_skill_event(current_admin, "skill_deleted", slug)
    return _skills_reloaded()


@app.get("/admin/mcp-servers")
async def list_mcp_servers(_: dict = Depends(require_admin)):
    return {"servers": mcp_client.server_states()}


@app.post("/admin/mcp-servers/reload")
async def reload_mcp_servers(_: dict = Depends(require_admin)):
    await mcp_client.reconnect_all()
    return {"servers": mcp_client.server_states()}


# ── User profile endpoints ────────────────────────────────────────────────────

async def _fetch_profile(db: aiosqlite.Connection, user_id: int) -> dict:
    async with db.execute(
        "SELECT id, email, display_name, given_name, avatar_url, is_admin, custom_name, "
        "theme_mode, theme_accent, briefing_hour, default_model "
        "FROM users WHERE id = ?",
        (user_id,),
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return {
        "id": row[0],
        "email": row[1],
        "display_name": row[2],
        "given_name": row[3],
        "avatar_url": row[4],
        "is_admin": bool(row[5]),
        "custom_name": row[6],
        "theme_mode": row[7],
        "theme_accent": row[8],
        "briefing_hour": row[9],
        "default_model": row[10],
    }


@app.get("/users/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        return await _fetch_profile(db, int(current_user["sub"]))


@app.patch("/users/me")
async def update_my_profile(req: ProfileUpdateRequest, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if k in PROFILE_COLUMN_WHITELIST}

    if "theme_mode" in updates and updates["theme_mode"] not in ALLOWED_THEME_MODES:
        raise HTTPException(status_code=400, detail="Invalid theme_mode")
    if "theme_accent" in updates and updates["theme_accent"] not in ALLOWED_THEME_ACCENTS:
        raise HTTPException(status_code=400, detail="Invalid theme_accent")
    if "custom_name" in updates and updates["custom_name"] is not None:
        updates["custom_name"] = updates["custom_name"].strip()[:60] or None
    if "briefing_hour" in updates and updates["briefing_hour"] is not None:
        if not 0 <= updates["briefing_hour"] <= 23:
            raise HTTPException(status_code=400, detail="briefing_hour must be 0-23")
    if "default_model" in updates and updates["default_model"] is not None:
        updates["default_model"] = updates["default_model"].strip()[:80] or None

    user_id = int(current_user["sub"])
    async with db_connect() as db:
        if updates:
            set_clause = ", ".join(f"{col} = ?" for col in updates)
            await db.execute(
                f"UPDATE users SET {set_clause} WHERE id = ?",
                (*updates.values(), user_id),
            )
            await db.commit()
        return await _fetch_profile(db, user_id)


# ── Memory endpoints (transparency: users can see/erase what tBai stores) ─────

@app.get("/users/me/facts")
async def list_my_facts(current_user: dict = Depends(get_current_user)):
    return await get_user_facts(db_connect, int(current_user["sub"]))


@app.delete("/users/me/facts/{fact_id}", status_code=204)
async def delete_my_fact(fact_id: int, current_user: dict = Depends(get_current_user)):
    deleted = await delete_user_fact(db_connect, int(current_user["sub"]), fact_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Fact not found")


# ── Session endpoints ─────────────────────────────────────────────────────────

@app.post("/sessions")
async def create_session(current_user: dict = Depends(get_current_user)):
    user_id = int(current_user["sub"])
    async with db_connect() as db:
        cursor = await db.execute(
            "INSERT INTO sessions (user_id, title) VALUES (?, 'New Chat')",
            (user_id,),
        )
        session_id = cursor.lastrowid
        await db.execute(
            "INSERT INTO activity_log (user_id, email, display_name, event, session_id) "
            "VALUES (?, ?, ?, 'session_created', ?)",
            (user_id, current_user.get("email"), current_user.get("display_name"), session_id),
        )
        await db.commit()
        async with db.execute(
            "SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?",
            (session_id,),
        ) as cur:
            row = await cur.fetchone()
    return {"id": row[0], "title": row[1], "created_at": row[2], "updated_at": row[3]}


@app.get("/sessions")
async def list_sessions(current_user: dict = Depends(get_current_user)):
    user_id = int(current_user["sub"])
    async with db_connect() as db:
        async with db.execute(
            """
            SELECT s.id, s.title, s.created_at, s.updated_at,
                   COUNT(m.id) AS message_count
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
            WHERE s.user_id = ?
            GROUP BY s.id
            ORDER BY s.updated_at DESC
            """,
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "id": r[0],
            "title": r[1],
            "created_at": r[2],
            "updated_at": r[3],
            "message_count": r[4],
        }
        for r in rows
    ]


@app.get("/sessions/{session_id}")
async def get_session(session_id: int, current_user: dict = Depends(get_current_user)):
    user_id = int(current_user["sub"])
    async with db_connect() as db:
        async with db.execute(
            "SELECT id, title, created_at, updated_at, user_id FROM sessions WHERE id = ?",
            (session_id,),
        ) as cur:
            session = await cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session[4] != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        async with db.execute(
            "SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        ) as cur:
            rows = await cur.fetchall()
        tools_by_message = await _tools_for_session(db, session_id)
    return {
        "id": session[0],
        "title": session[1],
        "created_at": session[2],
        "updated_at": session[3],
        "messages": [
            {"id": r[0], "role": r[1], "text": r[2], "tools_used": tools_by_message.get(r[0], [])}
            for r in rows
        ],
    }


@app.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: int, current_user: dict = Depends(get_current_user)):
    user_id = int(current_user["sub"])
    async with db_connect() as db:
        cursor = await db.execute(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id),
        )
        if cursor.rowcount > 0:
            await db.execute(
                "INSERT INTO activity_log (user_id, email, display_name, event, session_id) "
                "VALUES (?, ?, ?, 'session_deleted', ?)",
                (user_id, current_user.get("email"), current_user.get("display_name"), session_id),
            )
        await db.commit()


# ── Feedback endpoint ─────────────────────────────────────────────────────────

@app.post("/messages/{message_id}/feedback", status_code=201)
async def submit_feedback(message_id: int, req: FeedbackRequest, current_user: dict = Depends(get_current_user)):
    if req.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating must be 'up' or 'down'")

    user_id = int(current_user["sub"])
    async with db_connect() as db:
        async with db.execute(
            """
            SELECT m.role, m.session_id, s.user_id
            FROM messages m JOIN sessions s ON s.id = m.session_id
            WHERE m.id = ?
            """,
            (message_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Message not found")
        if row[2] != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        if row[0] != "assistant":
            raise HTTPException(status_code=400, detail="Feedback is only allowed on assistant messages")

        event = "feedback_positive" if req.rating == "up" else "feedback_negative"
        feedback_text = (req.text or "").strip() or None
        await db.execute(
            "INSERT INTO activity_log (user_id, email, display_name, event, session_id, message_id, feedback_text) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, current_user.get("email"), current_user.get("display_name"),
             event, row[1], message_id, feedback_text),
        )
        await db.commit()
    return {"status": "ok"}


# ── Uploads (chat attachments: images for vision, text files as context) ──────

UPLOADS_DIR = Path(__file__).parent / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
TEXT_MIMES = {"text/plain", "text/markdown", "text/csv"}
ALLOWED_UPLOAD_MIMES = IMAGE_MIMES | TEXT_MIMES
MAX_INLINE_TEXT_CHARS = 20_000


@app.post("/uploads", status_code=201)
@limiter.limit("20/minute", key_func=get_user_or_ip)
async def upload_attachment(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_UPLOAD_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{mime}' — images (png/jpeg/webp/gif) and text files only",
        )
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (10 MB max)")

    UPLOADS_DIR.mkdir(exist_ok=True)
    stored_name = uuid.uuid4().hex
    (UPLOADS_DIR / stored_name).write_bytes(data)

    async with db_connect() as db:
        cursor = await db.execute(
            "INSERT INTO attachments (user_id, path, mime, original_name) VALUES (?, ?, ?, ?)",
            (int(current_user["sub"]), stored_name, mime, (file.filename or "")[:120]),
        )
        await db.commit()
    return {"id": cursor.lastrowid, "mime": mime, "name": file.filename}


@app.get("/uploads/{attachment_id}")
async def get_attachment(attachment_id: int, current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        async with db.execute(
            "SELECT path, mime, user_id FROM attachments WHERE id = ?", (attachment_id,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if row[2] != int(current_user["sub"]):
        raise HTTPException(status_code=403, detail="Forbidden")
    file_path = UPLOADS_DIR / row[0]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(file_path, media_type=row[1])


async def _load_attachments(db, attachment_ids: list[int], user_id: int, user_message_id: int):
    """Validate ownership, link to the message, and return (images, extra_text).

    images: [{"mime", "b64"}] for vision models; extra_text: inlined text files.
    """
    images: list[dict] = []
    text_parts: list[str] = []
    for att_id in attachment_ids:
        async with db.execute(
            "SELECT path, mime, original_name, user_id FROM attachments WHERE id = ?", (att_id,)
        ) as cur:
            row = await cur.fetchone()
        if not row or row[3] != user_id:
            raise HTTPException(status_code=400, detail=f"Invalid attachment {att_id}")
        file_path = UPLOADS_DIR / row[0]
        if not file_path.exists():
            raise HTTPException(status_code=400, detail=f"Attachment {att_id} missing on disk")
        data = file_path.read_bytes()
        if row[1] in IMAGE_MIMES:
            images.append({"mime": row[1], "b64": base64.standard_b64encode(data).decode()})
        else:
            text = data.decode("utf-8", errors="replace")[:MAX_INLINE_TEXT_CHARS]
            text_parts.append(f"\n\n--- Attached file: {row[2]} ---\n{text}")
        await db.execute(
            "UPDATE attachments SET message_id = ? WHERE id = ?", (user_message_id, att_id)
        )
    return images, "".join(text_parts)


# ── Models endpoint ───────────────────────────────────────────────────────────

async def _is_db_admin(user_id: int) -> bool:
    async with db_connect() as db:
        async with db.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
    return bool(row and row[0])


# Cloud (Claude) models have a very large window; the frontend only uses this to
# decide when a chat is getting long, so an exact figure isn't important.
_CLOUD_CONTEXT_LENGTH = 200_000

# Same idea for Databricks-hosted models — only feeds the frontend's
# "this chat is getting long" hint, so a representative figure is enough.
_DATABRICKS_CONTEXT_LENGTH = 128_000

# /api/show is comparatively slow and a model's context length never changes, so
# cache it for the process lifetime keyed by the full Ollama model name.
_model_context_cache: dict[str, int | None] = {}


async def _ollama_context_length(client: httpx.AsyncClient, name: str) -> int | None:
    """Fetch a local model's context length (tokens) via Ollama /api/show, cached.

    Returns None if Ollama is down or the field is absent — callers treat that as
    "unknown" and fall back to the app's own history window.
    """
    if name in _model_context_cache:
        return _model_context_cache[name]
    ctx: int | None = None
    try:
        resp = await client.post("http://localhost:11434/api/show", json={"name": name})
        resp.raise_for_status()
        info = resp.json().get("model_info") or {}
        # The key is architecture-namespaced, e.g. "gemma.context_length",
        # "llama.context_length" — find it by suffix rather than a fixed name.
        for key, value in info.items():
            if key.endswith(".context_length") and isinstance(value, int):
                ctx = value
                break
    except (httpx.HTTPError, ValueError):
        ctx = None
    _model_context_cache[name] = ctx
    return ctx


# A model's capability set (vision/tools/…) is fixed, so cache it per model name
# for the process lifetime — same lifecycle as _model_context_cache above.
_model_caps_cache: dict[str, list[str]] = {}


async def _ollama_capabilities(client: httpx.AsyncClient, name: str) -> list[str]:
    """Fetch a local model's capabilities via /api/show, cached.

    NB: /api/show reports the full set (e.g. 'vision'), whereas /api/tags
    under-reports it — so vision detection MUST go through here, not /api/tags.
    """
    if name in _model_caps_cache:
        return _model_caps_cache[name]
    caps: list[str] = []
    try:
        resp = await client.post("http://localhost:11434/api/show", json={"name": name})
        resp.raise_for_status()
        caps = resp.json().get("capabilities") or []
    except (httpx.HTTPError, ValueError):
        caps = []  # unknown — caller decides how to treat it
    _model_caps_cache[name] = caps
    return caps


async def _first_local_vision_model(client: httpx.AsyncClient) -> str | None:
    """Return the id of any locally-installed vision-capable model, or None."""
    try:
        resp = await client.get("http://localhost:11434/api/tags")
        resp.raise_for_status()
        tags = resp.json().get("models", [])
    except (httpx.HTTPError, ValueError):
        return None
    for m in tags:
        name = m.get("name", "")
        if name and "vision" in await _ollama_capabilities(client, name):
            return name.removesuffix(":latest")
    return None


async def _resolve_vision_model(selected: str) -> tuple[str, str | None]:
    """For an image turn, ensure the model can actually see the image.

    If the selected local model lacks the 'vision' capability, transparently
    route to a locally-installed vision model instead. Returns
    (effective_model, notice) where notice is a short user-facing markdown line
    prepended to the reply when a switch happened, else None. Cloud models all
    accept images, so they pass through untouched.
    """
    if providers.is_cloud_model(selected):
        return selected, None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # A Databricks endpoint isn't an Ollama model, so /api/show would
            # only 404 on it. Skip the probe and look for a local stand-in; if
            # none exists the request still goes out with the image attached
            # (databricks_provider sends OpenAI vision blocks) and the endpoint
            # decides whether it can see it.
            if not databricks_provider.is_databricks_model(selected):
                if "vision" in await _ollama_capabilities(client, selected):
                    return selected, None
            alt = await _first_local_vision_model(client)
    except httpx.HTTPError:
        return selected, None  # Ollama unreachable — let the stream surface it
    if not alt or alt == selected:
        return selected, None
    notice = (
        f"*Note: “{selected}” can't read images, so this reply uses the "
        f"vision-capable “{alt}” instead.*\n\n"
    )
    return alt, notice


@app.get("/models")
async def list_models(current_user: dict = Depends(get_current_user)):
    """Local Ollama and Databricks-hosted models for everyone; cloud (Claude)
    models for admins only."""
    models: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            resp.raise_for_status()
            for m in resp.json().get("models", []):
                name = m.get("name", "")
                if name:
                    ctx = await _ollama_context_length(client, name)
                    models.append(
                        {"id": name.removesuffix(":latest"), "kind": "local", "context_length": ctx}
                    )
    except httpx.HTTPError:
        pass  # Ollama down — picker still shows remote models if permitted

    # Databricks endpoints are billed to the household workspace but are not
    # admin-gated: every whitelisted user gets them, like the local models.
    if databricks_provider.databricks_available():
        for dm in databricks_provider.databricks_models():
            models.append(
                {"id": dm, "kind": "databricks", "context_length": _DATABRICKS_CONTEXT_LENGTH}
            )

    if providers.anthropic_available() and await _is_db_admin(int(current_user["sub"])):
        for cm in providers.cloud_models():
            models.append({"id": cm, "kind": "cloud", "context_length": _CLOUD_CONTEXT_LENGTH})
    return models


# ── Chat endpoint ─────────────────────────────────────────────────────────────

@app.post("/chat")
@limiter.limit("15/minute", key_func=get_user_or_ip)
async def chat(request: Request, payload: ChatRequest, current_user: dict = Depends(get_current_user)):
    user_id = int(current_user["sub"])

    # Cloud models cost real money — gate server-side on DB admin status, not
    # just the picker UI or the (potentially stale) JWT claim.
    if providers.is_cloud_model(payload.model):
        if not providers.anthropic_available():
            raise HTTPException(status_code=400, detail="Cloud models are not configured")
        if not await _is_db_admin(user_id):
            raise HTTPException(status_code=403, detail="Cloud models are admin-only")
    async with db_connect() as db:
        async with db.execute(
            "SELECT id, title, user_id FROM sessions WHERE id = ?", (payload.session_id,)
        ) as cur:
            session = await cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session[2] != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        cursor = await db.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)",
            (payload.session_id, payload.prompt),
        )
        user_message_id = cursor.lastrowid

        images: list[dict] = []
        extra_text = ""
        if payload.attachment_ids:
            images, extra_text = await _load_attachments(
                db, payload.attachment_ids, user_id, user_message_id
            )

        # An image is useless to a text-only model. If the user attached one but
        # their selected model can't see it, transparently run this turn on a
        # vision-capable local model (and tell them, via a note in the reply).
        effective_model = payload.model
        vision_notice: str | None = None
        if images:
            effective_model, vision_notice = await _resolve_vision_model(payload.model)

        if session[1] == "New Chat":
            await db.execute(
                "UPDATE sessions SET title = ? WHERE id = ?",
                (payload.prompt[:60], payload.session_id),
            )
        await db.execute(
            "INSERT INTO activity_log (user_id, email, display_name, event, session_id, model) "
            "VALUES (?, ?, ?, 'chat', ?, ?)",
            (user_id, current_user.get("email"), current_user.get("display_name"),
             payload.session_id, effective_model),
        )
        await db.commit()

        # History is everything before the just-inserted user message, keyed by
        # id rather than second-resolution created_at (which ties arbitrarily).
        async with db.execute(
            "SELECT id, role, content FROM messages WHERE session_id = ? AND id < ? ORDER BY id",
            (payload.session_id, user_message_id),
        ) as cur:
            rows = await cur.fetchall()
        history_tools = await _tools_for_session(db, payload.session_id)

        async with db.execute(
            "SELECT custom_name, given_name FROM users WHERE id = ?", (user_id,)
        ) as cur:
            name_row = await cur.fetchone()

    # Append each assistant turn's tool record to its own text. The loops'
    # tool_call messages are gone by now (they never leave the turn), so this
    # annotation is the only thing letting the model answer "did you use the
    # skill?" truthfully instead of guessing. _system_prompt explains the marker
    # and forbids the model from writing one itself.
    history = [
        {
            "role": role,
            "content": (
                f"{content}\n\n{_format_tools_used(history_tools[mid])}"
                if role == "assistant" and history_tools.get(mid)
                else content
            ),
        }
        for mid, role, content in rows
    ]
    user_name = (
        (name_row and (name_row[0] or name_row[1]))
        or current_user.get("given_name")
        or (current_user.get("email") or "").split("@")[0]
        or "the user"
    )
    ctx = ToolContext(user_id=user_id, user_name=user_name, db_connect=db_connect)

    return StreamingResponse(
        stream_agent_and_save(
            effective_model, history, payload.prompt + extra_text,
            payload.session_id, ctx, images, notice=vision_notice,
        ),
        media_type="application/x-ndjson",
    )
