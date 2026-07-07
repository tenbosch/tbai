"""Per-user reminders and in-app notifications.

Reminders are rows with a local-time `due_at` ("YYYY-MM-DD HH:MM"); the
scheduler (scheduler.py) polls every 30s and turns due reminders into
`notifications` rows, which the frontend bell surfaces. Times are the server's
local time — this runs on the family's home computer, so local == household.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import connect as db_connect
from tools import ToolContext, register_tool

router = APIRouter(tags=["reminders"])

RECURRENCES = {"daily", "weekly", "monthly"}
DUE_FORMAT = "%Y-%m-%d %H:%M"


def _parse_due(due_at: str) -> str | None:
    """Normalize a 'YYYY-MM-DD HH:MM' local timestamp; None if unparseable."""
    for fmt in (DUE_FORMAT, "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(due_at.strip(), fmt).strftime(DUE_FORMAT)
        except ValueError:
            continue
    return None


# ── REST endpoints ────────────────────────────────────────────────────────────

class ReminderCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_at: str
    recurrence: str | None = None


@router.get("/reminders")
async def get_reminders(current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        async with db.execute(
            "SELECT id, title, due_at, recurrence, status, created_at FROM reminders "
            "WHERE user_id = ? AND status = 'pending' ORDER BY due_at",
            (int(current_user["sub"]),),
        ) as cur:
            rows = await cur.fetchall()
    return [
        {"id": r[0], "title": r[1], "due_at": r[2], "recurrence": r[3], "status": r[4], "created_at": r[5]}
        for r in rows
    ]


@router.post("/reminders", status_code=201)
async def create_reminder(req: ReminderCreate, current_user: dict = Depends(get_current_user)):
    due = _parse_due(req.due_at)
    if due is None:
        raise HTTPException(status_code=400, detail="due_at must be 'YYYY-MM-DD HH:MM'")
    if req.recurrence is not None and req.recurrence not in RECURRENCES:
        raise HTTPException(status_code=400, detail=f"recurrence must be one of {sorted(RECURRENCES)}")
    async with db_connect() as db:
        cursor = await db.execute(
            "INSERT INTO reminders (user_id, title, due_at, recurrence, status) "
            "VALUES (?, ?, ?, ?, 'pending')",
            (int(current_user["sub"]), req.title.strip(), due, req.recurrence),
        )
        await db.commit()
    return {"id": cursor.lastrowid, "title": req.title.strip(), "due_at": due}


@router.delete("/reminders/{reminder_id}", status_code=204)
async def cancel_reminder_endpoint(reminder_id: int, current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        cursor = await db.execute(
            "UPDATE reminders SET status = 'dismissed' WHERE id = ? AND user_id = ? AND status = 'pending'",
            (reminder_id, int(current_user["sub"])),
        )
        await db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Reminder not found")


@router.get("/notifications")
async def get_notifications(unread: int = 0, current_user: dict = Depends(get_current_user)):
    query = (
        "SELECT id, kind, title, body, read, created_at FROM notifications "
        "WHERE user_id = ?" + (" AND read = 0" if unread else "") +
        " ORDER BY id DESC LIMIT 50"
    )
    async with db_connect() as db:
        async with db.execute(query, (int(current_user["sub"]),)) as cur:
            rows = await cur.fetchall()
    return [
        {"id": r[0], "kind": r[1], "title": r[2], "body": r[3], "read": bool(r[4]), "created_at": r[5]}
        for r in rows
    ]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: int, current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        await db.execute(
            "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?",
            (notification_id, int(current_user["sub"])),
        )
        await db.commit()
    return {"status": "ok"}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        await db.execute(
            "UPDATE notifications SET read = 1 WHERE user_id = ?", (int(current_user["sub"]),)
        )
        await db.commit()
    return {"status": "ok"}


# ── Chat tools ────────────────────────────────────────────────────────────────

@register_tool(
    "set_reminder",
    description=(
        "Set a reminder for the user. due_at must be local time in the format "
        "'YYYY-MM-DD HH:MM' (24-hour). Compute it from the current date/time in "
        "the system prompt when the user says things like 'tomorrow at 4pm' or "
        "'in two hours'. Optionally recurring."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "What to remind about"},
            "due_at": {"type": "string", "description": "Local time 'YYYY-MM-DD HH:MM' (24-hour)"},
            "recurrence": {
                "type": "string",
                "enum": ["daily", "weekly", "monthly"],
                "description": "Repeat schedule (omit for one-time)",
            },
        },
        "required": ["title", "due_at"],
    },
    status="Setting a reminder…",
)
async def set_reminder(args: dict, ctx: ToolContext):
    title = (args.get("title") or "").strip()[:200]
    due = _parse_due(args.get("due_at") or "")
    recurrence = (args.get("recurrence") or "").strip().lower() or None
    if not title:
        return "Error: no reminder title provided."
    if due is None:
        return "Error: due_at must be in 'YYYY-MM-DD HH:MM' 24-hour local format."
    if recurrence is not None and recurrence not in RECURRENCES:
        return f"Error: recurrence must be one of {sorted(RECURRENCES)}."
    async with ctx.db_connect() as db:
        await db.execute(
            "INSERT INTO reminders (user_id, title, due_at, recurrence, status) "
            "VALUES (?, ?, ?, ?, 'pending')",
            (ctx.user_id, title, due, recurrence),
        )
        await db.commit()
    rec = f", repeating {recurrence}" if recurrence else ""
    return f"Reminder set: '{title}' at {due}{rec}. It will appear in the notification bell."


@register_tool(
    "list_reminders",
    description="List the user's pending reminders.",
    parameters={"type": "object", "properties": {}},
)
async def list_reminders(args: dict, ctx: ToolContext):
    async with ctx.db_connect() as db:
        async with db.execute(
            "SELECT title, due_at, recurrence FROM reminders "
            "WHERE user_id = ? AND status = 'pending' ORDER BY due_at",
            (ctx.user_id,),
        ) as cur:
            rows = await cur.fetchall()
    if not rows:
        return "No pending reminders."
    lines = [
        f"- {title} at {due}" + (f" (repeats {rec})" if rec else "")
        for title, due, rec in rows
    ]
    return "Pending reminders:\n" + "\n".join(lines)


@register_tool(
    "cancel_reminder",
    description="Cancel a pending reminder by (part of) its title.",
    parameters={
        "type": "object",
        "properties": {
            "title_hint": {"type": "string", "description": "Phrase matching the reminder to cancel"},
        },
        "required": ["title_hint"],
    },
    status="Updating reminders…",
)
async def cancel_reminder(args: dict, ctx: ToolContext):
    hint = (args.get("title_hint") or "").strip()
    if not hint:
        return "Error: no hint provided."
    async with ctx.db_connect() as db:
        async with db.execute(
            "SELECT id, title, due_at FROM reminders "
            "WHERE user_id = ? AND status = 'pending' AND title LIKE ?",
            (ctx.user_id, f"%{hint}%"),
        ) as cur:
            rows = await cur.fetchall()
        if not rows:
            return f"No pending reminder matches '{hint}'."
        if len(rows) > 1:
            return (
                "Multiple reminders match — be more specific: "
                + "; ".join(f"'{r[1]}' at {r[2]}" for r in rows[:5])
            )
        await db.execute(
            "UPDATE reminders SET status = 'dismissed' WHERE id = ?", (rows[0][0],)
        )
        await db.commit()
    return f"Cancelled reminder '{rows[0][1]}'."
