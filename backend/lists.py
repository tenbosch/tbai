"""Shared family lists (shopping / todo / meal plans).

Single-household model: every whitelisted user sees every list. The chat tools
and the REST endpoints call the same helpers, so "add milk" in chat and a tap
in ListsPage do exactly the same thing.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import connect as db_connect
from tools import ToolContext, register_tool

router = APIRouter(prefix="/lists", tags=["lists"])

LIST_KINDS = {"shopping", "todo", "meal"}


def _guess_kind(name: str) -> str:
    lowered = name.lower()
    if any(w in lowered for w in ("shop", "grocer", "store", "buy")):
        return "shopping"
    if any(w in lowered for w in ("meal", "dinner", "menu", "recipe")):
        return "meal"
    return "todo"


# ── Shared helpers (used by REST endpoints and chat tools) ────────────────────

async def _find_list(db, name: str):
    async with db.execute(
        "SELECT id, name, kind FROM lists WHERE name = ? COLLATE NOCASE", (name.strip(),)
    ) as cur:
        return await cur.fetchone()


async def _get_or_create_list(db, name: str, kind: str | None, user_id: int) -> tuple[int, str]:
    row = await _find_list(db, name)
    if row:
        return row[0], row[1]
    kind = kind if kind in LIST_KINDS else _guess_kind(name)
    cursor = await db.execute(
        "INSERT INTO lists (name, kind, created_by) VALUES (?, ?, ?)",
        (name.strip(), kind, user_id),
    )
    return cursor.lastrowid, name.strip()


async def _add_items(db, list_id: int, texts: list[str], user_id: int) -> int:
    added = 0
    for text in texts:
        text = text.strip()
        if not text:
            continue
        # skip exact-duplicate open items so "add milk" twice doesn't double up
        async with db.execute(
            "SELECT 1 FROM list_items WHERE list_id = ? AND done = 0 AND text = ? COLLATE NOCASE",
            (list_id, text),
        ) as cur:
            if await cur.fetchone():
                continue
        await db.execute(
            "INSERT INTO list_items (list_id, text, added_by) VALUES (?, ?, ?)",
            (list_id, text[:200], user_id),
        )
        added += 1
    return added


async def _render_list(db, list_id: int, name: str) -> str:
    async with db.execute(
        "SELECT text, done FROM list_items WHERE list_id = ? ORDER BY done, id",
        (list_id,),
    ) as cur:
        items = await cur.fetchall()
    if not items:
        return f"'{name}' is empty."
    lines = [f"{'[x]' if done else '[ ]'} {text}" for text, done in items]
    return f"{name}:\n" + "\n".join(lines)


# ── REST endpoints ────────────────────────────────────────────────────────────

class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: str | None = None


class ItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200)


class ItemUpdate(BaseModel):
    done: bool


@router.get("")
async def get_lists(_: dict = Depends(get_current_user)):
    async with db_connect() as db:
        async with db.execute(
            """
            SELECT l.id, l.name, l.kind, l.created_at,
                   COUNT(i.id) AS item_count,
                   SUM(CASE WHEN i.done = 0 THEN 1 ELSE 0 END) AS open_count
            FROM lists l LEFT JOIN list_items i ON i.list_id = l.id
            GROUP BY l.id ORDER BY l.id
            """
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "id": r[0], "name": r[1], "kind": r[2], "created_at": r[3],
            "item_count": r[4], "open_count": r[5] or 0,
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def create_list(req: ListCreate, current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        existing = await _find_list(db, req.name)
        if existing:
            raise HTTPException(status_code=409, detail="A list with that name already exists")
        list_id, name = await _get_or_create_list(
            db, req.name, req.kind, int(current_user["sub"])
        )
        await db.commit()
    return {"id": list_id, "name": name}


@router.get("/{list_id}")
async def get_list(list_id: int, _: dict = Depends(get_current_user)):
    async with db_connect() as db:
        async with db.execute(
            "SELECT id, name, kind, created_at FROM lists WHERE id = ?", (list_id,)
        ) as cur:
            lst = await cur.fetchone()
        if not lst:
            raise HTTPException(status_code=404, detail="List not found")
        async with db.execute(
            """
            SELECT i.id, i.text, i.done, i.created_at,
                   COALESCE(u.custom_name, u.given_name, u.email) AS added_by_name
            FROM list_items i LEFT JOIN users u ON u.id = i.added_by
            WHERE i.list_id = ? ORDER BY i.done, i.id
            """,
            (list_id,),
        ) as cur:
            items = await cur.fetchall()
    return {
        "id": lst[0], "name": lst[1], "kind": lst[2], "created_at": lst[3],
        "items": [
            {"id": i[0], "text": i[1], "done": bool(i[2]), "created_at": i[3], "added_by": i[4]}
            for i in items
        ],
    }


@router.delete("/{list_id}", status_code=204)
async def delete_list(list_id: int, _: dict = Depends(get_current_user)):
    async with db_connect() as db:
        await db.execute("DELETE FROM list_items WHERE list_id = ?", (list_id,))
        await db.execute("DELETE FROM lists WHERE id = ?", (list_id,))
        await db.commit()


@router.post("/{list_id}/items", status_code=201)
async def add_item(list_id: int, req: ItemCreate, current_user: dict = Depends(get_current_user)):
    async with db_connect() as db:
        async with db.execute("SELECT 1 FROM lists WHERE id = ?", (list_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="List not found")
        await _add_items(db, list_id, [req.text], int(current_user["sub"]))
        await db.commit()
    return {"status": "ok"}


@router.patch("/{list_id}/items/{item_id}")
async def update_item(list_id: int, item_id: int, req: ItemUpdate, _: dict = Depends(get_current_user)):
    async with db_connect() as db:
        cursor = await db.execute(
            "UPDATE list_items SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END "
            "WHERE id = ? AND list_id = ?",
            (int(req.done), int(req.done), item_id, list_id),
        )
        await db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"status": "ok"}


@router.delete("/{list_id}/items/{item_id}", status_code=204)
async def delete_item(list_id: int, item_id: int, _: dict = Depends(get_current_user)):
    async with db_connect() as db:
        await db.execute(
            "DELETE FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id)
        )
        await db.commit()


# ── Chat tools ────────────────────────────────────────────────────────────────

@register_tool(
    "add_to_list",
    description=(
        "Add one or more items to a shared family list (shopping list, todo "
        "list, meal plan). Creates the list if it doesn't exist yet."
    ),
    parameters={
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {"type": "string"},
                "description": "The items to add",
            },
            "list_name": {
                "type": "string",
                "description": "Which list to add to (default: Shopping)",
            },
        },
        "required": ["items"],
    },
    status="Updating the list…",
)
async def add_to_list(args: dict, ctx: ToolContext):
    items = args.get("items") or []
    if isinstance(items, str):
        items = [items]
    items = [str(i) for i in items if str(i).strip()]
    if not items:
        return "Error: no items provided."
    list_name = (args.get("list_name") or "Shopping").strip() or "Shopping"
    async with ctx.db_connect() as db:
        list_id, name = await _get_or_create_list(db, list_name, None, ctx.user_id)
        added = await _add_items(db, list_id, items, ctx.user_id)
        await db.commit()
        rendered = await _render_list(db, list_id, name)
    return f"Added {added} item(s) to '{name}'.\n\n{rendered}"


@register_tool(
    "show_list",
    description="Show the items on a shared family list. Without a name, lists all lists.",
    parameters={
        "type": "object",
        "properties": {
            "list_name": {"type": "string", "description": "Which list to show (optional)"},
        },
    },
)
async def show_list(args: dict, ctx: ToolContext):
    list_name = (args.get("list_name") or "").strip()
    async with ctx.db_connect() as db:
        if list_name:
            row = await _find_list(db, list_name)
            if not row:
                return f"No list named '{list_name}' exists."
            return await _render_list(db, row[0], row[1])
        async with db.execute("SELECT id, name FROM lists ORDER BY id") as cur:
            lists = await cur.fetchall()
        if not lists:
            return "There are no family lists yet."
        rendered = [await _render_list(db, lid, name) for lid, name in lists]
    return "\n\n".join(rendered)


@register_tool(
    "check_off_item",
    description="Mark an item on a shared family list as done/bought, or remove it.",
    parameters={
        "type": "object",
        "properties": {
            "item": {"type": "string", "description": "The item text (or part of it)"},
            "list_name": {"type": "string", "description": "Which list (optional)"},
        },
        "required": ["item"],
    },
    status="Updating the list…",
)
async def check_off_item(args: dict, ctx: ToolContext):
    item_hint = (args.get("item") or "").strip()
    if not item_hint:
        return "Error: no item provided."
    list_name = (args.get("list_name") or "").strip()
    async with ctx.db_connect() as db:
        query = (
            "SELECT i.id, i.text, l.name FROM list_items i JOIN lists l ON l.id = i.list_id "
            "WHERE i.done = 0 AND i.text LIKE ?"
        )
        params: list = [f"%{item_hint}%"]
        if list_name:
            query += " AND l.name = ? COLLATE NOCASE"
            params.append(list_name)
        async with db.execute(query, params) as cur:
            rows = await cur.fetchall()
        if not rows:
            return f"No open item matching '{item_hint}' found."
        if len(rows) > 1:
            return (
                "Multiple items match — be more specific: "
                + "; ".join(f"'{r[1]}' on {r[2]}" for r in rows[:5])
            )
        await db.execute(
            "UPDATE list_items SET done = 1, done_at = datetime('now') WHERE id = ?",
            (rows[0][0],),
        )
        await db.commit()
    return f"Checked off '{rows[0][1]}' on {rows[0][2]}."
