# tBai

A self-hosted **family AI assistant**. Real-time, token-by-token streaming chat backed by a local LLM (**Ollama**), with an optional admin-only **Claude** cloud path. Multi-user via Google OAuth with an email whitelist. Beyond chat it has per-member memory, shared household lists, reminders with a daily briefing, opt-in read-only Google (Calendar/Gmail/Drive), image & text attachments, and browser voice I/O.

Every layer streams: **Ollama / Anthropic → FastAPI → React**. Sessions are persisted per user in SQLite, and the app is exposed to external users over HTTPS via a Cloudflare Tunnel. An optional **Windows desktop app** wraps the whole thing in an always-on window.

---

## Features

**Chat & models**
- **Streaming chat** — tokens appear as the model generates them (NDJSON stream end-to-end)
- **Local LLM** — any model installed in Ollama (default: `gemma4`)
- **Model picker** — switch models per chat; admins with an Anthropic key also get cloud **Claude** models (`claude-*`) in the picker; choice is remembered per user
- **Iterative tool use** — the model can call tools across multiple rounds within one turn, streaming progress markers ("🔍 Searching the web…") as it goes
- **Attachments** — attach images (for vision-capable local models) and text files to a message (≤10 MB each)
- **Voice** — 🎙️ dictate your message (Web Speech) and 🔊 have replies read aloud (browser speech synthesis)
- **Message feedback** — 👍/👎 on any assistant reply, with an optional comment on 👎

**Assistant tools** (the model calls these itself when useful)
- **Web search** — `web_search` backed by the Brave Search API for current events, prices, news; answers include a deduplicated **Sources** list
- **Memory** — remembers durable facts/preferences per person; injected into the system prompt and viewable/deletable in Settings
- **Family lists** — shared household shopping / to-do / meal lists; add, show, and check off items from chat or the Lists page
- **Reminders** — one-off or recurring (daily/weekly/monthly), delivered as in-app notifications
- **Google (opt-in, read-only)** — search Gmail, list Calendar events, and search Drive once a member connects their account

**Personal & household**
- **Per-user sessions** — private chat history organized into named sessions, with a "Your Chats" picker
- **Daily briefing** — an optional once-a-day summary notification at an hour you choose
- **Notifications** — in-app bell with unread badge for reminders and briefings
- **Personalization** — custom display name, light/dark theme with five accent colors

**Access & operations**
- **Google OAuth login** — no passwords; **email whitelist** enforced on every request (removal locks a user out immediately, not at token expiry)
- **Admin panel** — manage the whitelist, assign/revoke admin roles, and view an activity log
- **Data retention** — a daily sweep prunes chats, attachment files, and logs older than 90 days so the DB stays bounded
- **Public access via Cloudflare Tunnel** — HTTPS to external users without port forwarding
- **Start/stop scripts** — one-command launch and shutdown of all four services
- **Desktop app** — an optional always-on Windows client (system tray, global hotkey, feature toolbar) — see [Desktop App](#desktop-app)

---

## Architecture

```
Browser (React / Vite)                     Desktop app (Electron, optional)
  └── fetch() + Bearer JWT (relative URLs)    └── hosts the web app in a native window + toolbar
        │
        ▼
Vite dev server (localhost:5173) — proxies /auth /sessions /chat /admin /messages
        /users /lists /reminders /notifications /models /uploads → localhost:8000
        │
        ▼
FastAPI (backend/main.py)
  ├── auth.py — Google token verification + JWT + per-request whitelist re-check
  ├── SQLite (chat_history.db, WAL) — users, sessions, messages, whitelist, activity log,
  │     user_facts, lists, reminders, notifications, google_credentials, attachments
  ├── scheduler.py — asyncio loop: delivers reminders + daily briefings, daily retention sweep
  └── StreamingResponse → stream_agent_and_save() async generator (NDJSON)
        │
        ▼
agent_logic.py stream_agent() — iterative tool loop (max 5 rounds); each round is one
  streaming model call with the tool schemas attached
  ├── claude-* model? → providers.py (admin-only Anthropic cloud loop, same events)
  ├── tools.py TOOL_REGISTRY — web_search, memory, lists, reminders, Google, …
  └── httpx stream → Ollama REST API (localhost:11434/api/chat)
```

```
External users → Cloudflare edge (HTTPS) → cloudflared (on your PC) → Vite (localhost:5173)
                                                                          └── proxies API → localhost:8000
```

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Python 3.11+ | Backend runtime |
| Node.js 18+ | Frontend dev server (and the optional desktop app) |
| [Ollama](https://ollama.com) | Local LLM runtime |
| Ollama model | e.g. `ollama pull gemma4` (tool-calling support needed for the assistant tools; a vision model for image attachments) |
| [cloudflared](https://github.com/cloudflare/cloudflared/releases) | Cloudflare Tunnel binary (placed in `cloudflare/`) |
| [Brave Search API key](https://brave.com/search/api/) | Powers the `web_search` tool (free tier available) |
| Anthropic API key *(optional)* | Enables admin-only cloud Claude models in the picker |

---

## First-Time Setup

### 1. Python virtual environment

Create the venv at the **repo root** (not inside `backend/`):

```powershell
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
```

### 2. Frontend dependencies

```powershell
cd frontend
npm install
```

### 3. Environment variables

**`backend/.env`**
```
GOOGLE_CLIENT_ID=        # from Google Cloud Console OAuth 2.0 Client
GOOGLE_CLIENT_SECRET=    # same OAuth client — only needed for the opt-in "Connect Google services" feature
JWT_SECRET=              # random hex string, 32+ chars
ADMIN_EMAILS=            # comma-separated Gmail addresses that bypass the whitelist
CORS_ORIGIN=https://localhost:5173
BRAVE_API_KEY=           # from https://brave.com/search/api/ (free tier), powers the web_search tool
ANTHROPIC_API_KEY=       # optional — enables admin-only cloud Claude models in the picker
ANTHROPIC_MODELS=        # optional — comma-separated cloud model ids (default: claude-opus-4-8)
```

**`frontend/.env`**
```
VITE_GOOGLE_CLIENT_ID=   # same Client ID as above
```

### 4. Google Cloud Console

1. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID** (Web application)
2. Add `https://localhost:5173` to **Authorized JavaScript origins**
3. If using Cloudflare Tunnel, also add your public URL (e.g. `https://tbai.yourdomain.com`)
4. For the opt-in Google integration, enable the Gmail, Calendar, and Drive APIs and add an authorized redirect URI for the connect flow

### 5. Cloudflare Tunnel (for external access)

```powershell
# Place cloudflared.exe in the cloudflare\ folder, then:
cloudflare\cloudflared.exe tunnel login
cloudflare\cloudflared.exe tunnel create tbai
cloudflare\cloudflared.exe tunnel route dns tbai tbai.yourdomain.com
```

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <your-tunnel-id>
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
originRequest:
  noTLSVerify: true        # needed because Vite uses a self-signed cert
ingress:
  - hostname: tbai.yourdomain.com
    service: https://localhost:5173
  - service: http_status:404
```

---

## Starting and Stopping

### Start everything

```powershell
.\start.bat
```

Opens four windows: Ollama, the FastAPI backend, the Vite frontend, and the Cloudflare tunnel.

### Stop everything

```powershell
.\stop.bat
```

Kills all four process trees cleanly. PIDs are tracked in `.tbai.pids.json` between start and stop.

> **Note:** If PowerShell blocks execution policy, use `start.bat` / `stop.bat` (the `.bat` wrappers invoke PowerShell with `-ExecutionPolicy Bypass` automatically).

### URLs

| URL | Who uses it |
|-----|-------------|
| `https://localhost:5173` | You, on this PC |
| `https://tbai.yourdomain.com` | External users (via Cloudflare Tunnel) |

---

## Manual Start (without the scripts)

All four must run simultaneously. Run each in a separate terminal:

```powershell
# 1. Ollama
ollama serve

# 2. Backend
cd backend
C:\...\tbai\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# 3. Frontend
cd frontend
npm run dev

# 4. Cloudflare Tunnel
cloudflare\cloudflared.exe tunnel run tbai
```

---

## Auth Flow

1. User clicks **Sign in with Google** → browser returns a Google ID token
2. `POST /auth/google` — backend verifies the token, checks the whitelist (admin emails from `ADMIN_EMAILS` bypass this), upserts the user, and issues a signed app JWT
3. JWT (7-day expiry) is stored in `localStorage` under `tbai_token`
4. All subsequent API calls send `Authorization: Bearer <token>`; the backend **re-checks the whitelist on every request**, so removing someone locks them out immediately

---

## Web Search

The model can call a `web_search` tool for anything past its training cutoff — recent news, live prices, sports results, etc. When it does, the chat shows a "🔍 Searching the web…" marker, the backend queries the Brave Search API (`backend/tools.py`), feeds the results back, and the model streams a grounded answer with a deduplicated **Sources** list appended.

Requires `BRAVE_API_KEY` in `backend/.env` and an Ollama model that supports tool calling. Without a key the tool returns an error string the model surfaces in its reply rather than crashing the chat.

---

## Chat Sessions

After signing in you land on a welcome page. **Start Chatting →** opens **Your Chats** — a picker listing every previous session (title, message count, last updated) with a delete option, plus **+ New Chat**. Pick a session to resume it or start a new one. The header logo always returns to the welcome page.

Each completed assistant reply has 👍/👎 buttons. Thumbs up submits immediately; thumbs down reveals an optional comment box so the rating and comment are recorded together. Attach files with 📎, dictate with 🎙️, and use the model dropdown to switch models.

---

## Memory

The assistant remembers durable facts about each person (preferences, context) via `remember_fact` / `forget_fact` tools. Stored facts are injected into the system prompt so replies stay personalized. Everything it knows about you is listed under **Settings → "What tBai knows about you"**, where you can delete any fact.

---

## Family Lists

Shared household lists (shopping / to-do / meal), visible to every whitelisted member. Manage them on the **Family Lists** page (create/delete lists, add/check/remove items) or straight from chat — the assistant can `add_to_list`, `show_list`, and `check_off_item`.

---

## Reminders, Daily Briefing & Notifications

- **Reminders** — ask the assistant to remind you about something at a time (one-off, or recurring daily/weekly/monthly). A background scheduler delivers due reminders as in-app notifications.
- **Daily briefing** — set a **briefing hour** in Settings to get a once-a-day summary notification; leave it off to disable.
- **Notifications** — the header **bell** shows an unread badge and a dropdown; mark items read individually or all at once.

---

## Google Integration (opt-in, read-only)

From **Settings → Connect Google services**, a member can grant read-only access to their Gmail, Calendar, and Drive. The refresh token is stored **Fernet-encrypted**, and the assistant gains `gmail_search`, `calendar_list_events`, and `drive_search` tools scoped to that member. Disconnect at any time. Requires `GOOGLE_CLIENT_SECRET` to be set.

---

## Profile & Theming

Click your avatar (top-right) → **Settings** to:

- Set a **custom display name** (placeholder is your Google first name, used automatically if unset)
- Choose **light or dark mode** and one of five accent colors (blue, mauve, green, pink, peach)
- Set your **daily briefing hour**, connect Google services, and manage remembered facts

Settings are saved per account and applied on every device you sign into.

---

## Admin Panel

Accessible from the avatar menu for admin users.

### Allowed Users
- Add or remove emails from the access whitelist
- Users who haven't logged in yet show as *never logged in*; logged-in users show their Google name
- Assign or revoke the **Admin** role per user
- Emails in `ADMIN_EMAILS` show as **Admin (env)** and cannot be toggled here

### Activity Log
A paginated table of the last 500 events (newest first), colour-coded by type: logins, login denials, session created/deleted, chat usage (model recorded; message content is not), and feedback (the optional 👎 comment is shown). Message content is never stored here except that optional comment.

---

## Data Retention

A background sweep (`backend/scheduler.py`) runs once per day and deletes anything older than **90 days** (`RETENTION_DAYS`, mirrored in the frontend):

- **Stale chats** — sessions untouched for 90 days (their messages cascade-delete)
- **Attachment files + rows** — attachments don't cascade with sessions and own a file on disk, so the sweep unlinks the files under `backend/uploads/` and deletes the rows
- **Audit logs** — `activity_log` and legacy `login_events` past the cutoff

> The manual `DELETE /sessions/{id}` endpoint deletes the session and its messages but does **not** remove attachment files — only the scheduler sweep reclaims those from disk.

---

## Desktop App

An optional always-on Windows client lives in **`desktop/`**. It's a thin Electron shell that hosts the existing web app in a native window (loading `https://localhost:5173`), so it inherits every feature and the Google login flow unchanged. On top it adds a compact **feature toolbar** (Home, Chats, New Chat, Lists, Admin, model dropdown, Notifications, Settings, Sign out), a **system tray** (close-to-tray), a **global hotkey** (`Ctrl+Shift+Space`), and **launch-on-startup**.

```powershell
cd desktop
npm install
npm start          # dev run — the full stack (start.bat) must already be running
npm run dist       # build dist/tBai Setup <ver>.exe (NSIS installer)
```

The full stack must be running for the window to load; if it isn't up yet the app shows a loading screen and retries. See `desktop/README.md` for details.

---

## Database

`backend/chat_history.db` — SQLite in WAL mode. Key tables:

| Table | Purpose |
|-------|---------|
| `users` | Google-authenticated users: display/given/custom names, `is_admin`, `theme_mode`/`theme_accent`, `briefing_hour`, `default_model` |
| `sessions` | Chat sessions scoped per user; title auto-set from the first message |
| `messages` | Individual messages (`role`: user or assistant); cascade-deleted with the session |
| `allowed_emails` | Email whitelist managed via the admin panel |
| `activity_log` | All tracked events (user, type, session, model, IP; optional 👎 comment) |
| `login_events` | Legacy (superseded by `activity_log`) |
| `user_facts` | Per-user assistant memory, injected into the system prompt |
| `lists` / `list_items` | Household-shared lists and their items |
| `reminders` | Per-user reminders (`due_at` server-local, optional recurrence) |
| `notifications` | In-app bell notifications |
| `google_credentials` | Fernet-encrypted refresh token for the opt-in Google connect |
| `attachments` | Chat uploads (images + text files); files stored under `backend/uploads/` |

Schema migrations are additive `ALTER TABLE` statements in `init_db()`, wrapped in try/except — safe to run on every restart.

---

## API Reference

All session/chat/admin endpoints require `Authorization: Bearer <token>`. Each top-level route also needs a matching entry in `vite.config.js`'s proxy map.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/google` | — | Verify Google ID token, return app JWT |
| `POST`/`GET`/`DELETE` | `/auth/google/connect`, `/auth/google/status` | user | Opt-in Google connect (auth-code exchange), status, disconnect |
| `GET`/`POST` | `/sessions` | user | List own sessions / create a session |
| `GET`/`DELETE` | `/sessions/{id}` | user | Session + messages / delete (ownership enforced) |
| `POST` | `/chat` | user | `{model, prompt, session_id, attachment_ids?}` — streams NDJSON events; cloud model → 403 for non-admins |
| `POST` | `/messages/{id}/feedback` | user | `{rating: "up"\|"down", text?}` |
| `GET`/`PATCH` | `/users/me` | user | Profile / update `custom_name`, theme, `briefing_hour`, `default_model` |
| `GET`/`DELETE` | `/users/me/facts`, `/users/me/facts/{id}` | user | List / delete stored memory facts |
| `GET` | `/models` | user | Local Ollama models for all; cloud models only for admins with an Anthropic key |
| `POST`/`GET` | `/uploads`, `/uploads/{id}` | user | Upload / fetch a chat attachment (image or text, ≤10 MB) |
| — | `/lists`, `/reminders`, `/notifications` | user | Family lists, reminders, and notification routers |
| `GET`/`POST`/`DELETE` | `/admin/allowed-emails` | admin | List / add / remove whitelist emails |
| `PATCH` | `/admin/users/{id}/admin` | admin | Set or clear a user's admin flag |
| `GET` | `/admin/activity` | admin | Last 500 activity log entries |

---

## Windows Notes

- The venv lives at the **repo root** (`tbai/.venv/`), not inside `backend/`
- Always invoke Python as `C:\...\tbai\.venv\Scripts\python.exe`
- PowerShell's `curl` is an alias for `Invoke-WebRequest` — use Git Bash or the Bash tool for `curl`
- If `npm run dev` fails with a missing `@rollup/rollup-win32-x64-msvc` error:
  ```powershell
  npm install @rolldown/binding-win32-x64-msvc
  # or: Remove-Item -Recurse node_modules, package-lock.json; npm install
  ```

## Brave Browser Note

Vite has a bug where `__BUNDLED_DEV__` and `__SERVER_FORWARD_CONSOLE__` placeholders are not replaced in `@vite/client` when using Brave. The workaround is three global polyfills in `frontend/index.html`, defined before the module scripts. HMR and Fast Refresh are disabled in `vite.config.js` (`hmr: false`, `fastRefresh: false`) to avoid a secondary WebSocket failure.
