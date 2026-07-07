"""Background scheduler: delivers due reminders and daily briefings.

A single asyncio task (started in main.py's lifespan) polls SQLite every 30s.
Reminders are durable rows, so pending ones survive restarts; delivery just
inserts a `notifications` row that the frontend bell picks up.
All times are server-local (the family's home computer).
"""

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path

from db import connect as db_connect

log = logging.getLogger("tbai.scheduler")

TICK_SECONDS = 30
DUE_FORMAT = "%Y-%m-%d %H:%M"

# How long chats and audit logs are kept before automatic deletion. Keep this in
# sync with the "deleted after N days" note shown on the frontend Chats screen.
RETENTION_DAYS = 90
_last_prune_date: str | None = None  # module state: maintenance runs once per day

# Where chat attachment files live (mirrors UPLOADS_DIR in main.py; defined here
# to avoid a circular import). Attachment rows FK on user_id only and keep a file
# on disk, so pruning must remove those files explicitly — cascades won't.
UPLOADS_DIR = Path(__file__).parent / "uploads"


def _next_occurrence(due_at: str, recurrence: str, now: datetime) -> str:
    """Advance a recurring reminder past `now` (handles missed ticks/downtime)."""
    due = datetime.strptime(due_at, DUE_FORMAT)
    while due <= now:
        if recurrence == "daily":
            due += timedelta(days=1)
        elif recurrence == "weekly":
            due += timedelta(weeks=1)
        elif recurrence == "monthly":
            month = due.month % 12 + 1
            year = due.year + (1 if month == 1 else 0)
            try:
                due = due.replace(year=year, month=month)
            except ValueError:  # e.g. Jan 31 -> Feb: clamp to the 28th
                due = due.replace(year=year, month=month, day=28)
        else:
            break
    return due.strftime(DUE_FORMAT)


async def _deliver_due_reminders(db, now: datetime):
    now_str = now.strftime(DUE_FORMAT)
    async with db.execute(
        "SELECT id, user_id, title, due_at, recurrence FROM reminders "
        "WHERE status = 'pending' AND due_at <= ?",
        (now_str,),
    ) as cur:
        due_rows = await cur.fetchall()

    for rid, user_id, title, due_at, recurrence in due_rows:
        await db.execute(
            "INSERT INTO notifications (user_id, kind, title, body) VALUES (?, 'reminder', ?, ?)",
            (user_id, "Reminder", title),
        )
        if recurrence:
            await db.execute(
                "UPDATE reminders SET due_at = ? WHERE id = ?",
                (_next_occurrence(due_at, recurrence, now), rid),
            )
        else:
            await db.execute(
                "UPDATE reminders SET status = 'delivered', delivered_at = datetime('now') WHERE id = ?",
                (rid,),
            )
        log.info("delivered reminder %s to user %s", rid, user_id)


async def _build_briefing(db, user_id: int, today: str) -> str:
    parts: list[str] = []

    # Calendar events for connected users (best-effort — briefing must never fail)
    try:
        from google_tools import fetch_calendar_events

        events = await fetch_calendar_events(user_id, today, today)
        if events:
            parts.append(
                "Today's calendar: "
                + "; ".join(
                    f"{e['summary']}" + (f" at {e['start'][11:16]}" if "T" in e["start"] else "")
                    for e in events[:6]
                )
            )
    except Exception:
        log.exception("briefing calendar fetch failed for user %s", user_id)

    async with db.execute(
        "SELECT title, due_at FROM reminders "
        "WHERE user_id = ? AND status = 'pending' AND due_at LIKE ? ORDER BY due_at",
        (user_id, f"{today}%"),
    ) as cur:
        todays = await cur.fetchall()
    if todays:
        parts.append(
            "Today's reminders: " + "; ".join(f"{t} at {d[11:]}" for t, d in todays)
        )

    async with db.execute(
        """
        SELECT l.name, COUNT(i.id) FROM lists l
        JOIN list_items i ON i.list_id = l.id AND i.done = 0
        GROUP BY l.id ORDER BY l.id
        """
    ) as cur:
        open_lists = await cur.fetchall()
    if open_lists:
        parts.append(
            "Open list items: " + "; ".join(f"{name} ({n})" for name, n in open_lists)
        )

    return " · ".join(parts) if parts else "Nothing scheduled today — enjoy your day!"


async def _deliver_briefings(db, now: datetime):
    today = now.strftime("%Y-%m-%d")
    async with db.execute(
        "SELECT id FROM users WHERE briefing_hour IS NOT NULL AND briefing_hour <= ? "
        "AND (last_briefing_date IS NULL OR last_briefing_date < ?)",
        (now.hour, today),
    ) as cur:
        user_rows = await cur.fetchall()

    for (user_id,) in user_rows:
        body = await _build_briefing(db, user_id, today)
        await db.execute(
            "INSERT INTO notifications (user_id, kind, title, body) "
            "VALUES (?, 'briefing', 'Daily briefing', ?)",
            (user_id, body),
        )
        await db.execute(
            "UPDATE users SET last_briefing_date = ? WHERE id = ?", (today, user_id)
        )
        log.info("delivered briefing to user %s", user_id)


async def _prune_old_logs(db, cutoff: str) -> int:
    """Delete audit-log rows past the retention cutoff. Returns rows removed."""
    total = 0
    for table in ("activity_log", "login_events"):
        cur = await db.execute(
            f"DELETE FROM {table} WHERE created_at < datetime('now', ?)", (cutoff,)
        )
        total += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return total


async def _prune_old_chats(db, cutoff: str) -> tuple[int, int]:
    """Delete chats untouched past the retention cutoff, plus their attachments.

    A chat's `updated_at` is bumped on every new message, so `updated_at` age is
    "time since last used". Attachment files live on disk and don't cascade with
    sessions/messages, so we collect their paths and unlink them first; deleting
    the sessions then cascades their messages. Old orphan attachments (uploaded
    but never sent) are swept up by their own created_at. Returns
    (sessions_deleted, attachment_files_removed).
    """
    async with db.execute(
        """
        SELECT a.id, a.path FROM attachments a
        JOIN messages m ON m.id = a.message_id
        JOIN sessions s ON s.id = m.session_id
        WHERE s.updated_at < datetime('now', ?)
        UNION
        SELECT id, path FROM attachments
        WHERE message_id IS NULL AND created_at < datetime('now', ?)
        """,
        (cutoff, cutoff),
    ) as cur:
        att_rows = await cur.fetchall()

    files_removed = 0
    for _att_id, path in att_rows:
        try:
            (UPLOADS_DIR / path).unlink(missing_ok=True)
            files_removed += 1
        except OSError:
            log.exception("failed to delete attachment file %s", path)

    if att_rows:
        ids = [r[0] for r in att_rows]
        placeholders = ",".join("?" * len(ids))
        await db.execute(f"DELETE FROM attachments WHERE id IN ({placeholders})", ids)

    cur = await db.execute(
        "DELETE FROM sessions WHERE updated_at < datetime('now', ?)", (cutoff,)
    )
    sessions_deleted = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return sessions_deleted, files_removed


async def _daily_maintenance(db, now: datetime):
    """Age out old chats, attachments, and logs. Runs at most once per calendar day.

    Timestamps are stored via SQLite datetime('now') (UTC), so the cutoff uses the
    same clock. Freed pages are reused by SQLite, keeping the DB file bounded.
    """
    global _last_prune_date
    today = now.strftime("%Y-%m-%d")
    if _last_prune_date == today:
        return

    cutoff = f"-{RETENTION_DAYS} days"
    sessions_deleted, files_removed = await _prune_old_chats(db, cutoff)
    logs_deleted = await _prune_old_logs(db, cutoff)
    _last_prune_date = today

    if sessions_deleted or files_removed or logs_deleted:
        log.info(
            "retention sweep (>%s days): removed %s chats, %s attachment files, %s log rows",
            RETENTION_DAYS, sessions_deleted, files_removed, logs_deleted,
        )


async def _tick():
    now = datetime.now()
    async with db_connect() as db:
        await _deliver_due_reminders(db, now)
        await _deliver_briefings(db, now)
        await _daily_maintenance(db, now)
        await db.commit()


async def scheduler_loop():
    log.info("scheduler started (tick every %ss)", TICK_SECONDS)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("scheduler tick failed")
        await asyncio.sleep(TICK_SECONDS)
