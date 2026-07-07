"""Per-user memory: durable facts the assistant remembers between sessions.

Facts are plain rows in `user_facts`, scoped by user_id, injected verbatim
into the system prompt (no vector store — a family member accumulates tens of
facts, not thousands). Users can see and delete everything stored about them
via GET/DELETE /users/me/facts (transparency matters in a family app).
"""

from tools import ToolContext, register_tool

# Injected into the system prompt each turn; kept small so it can't crowd out
# the conversation. remember_fact refuses beyond MAX_FACTS_PER_USER.
MAX_FACTS_INJECTED = 50
MAX_FACTS_PER_USER = 200
MAX_FACT_LEN = 300


async def get_user_facts(db_connect, user_id: int) -> list[dict]:
    async with db_connect() as db:
        async with db.execute(
            "SELECT id, fact, category, created_at FROM user_facts "
            "WHERE user_id = ? ORDER BY id",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [
        {"id": r[0], "fact": r[1], "category": r[2], "created_at": r[3]}
        for r in rows
    ]


async def delete_user_fact(db_connect, user_id: int, fact_id: int) -> bool:
    async with db_connect() as db:
        cursor = await db.execute(
            "DELETE FROM user_facts WHERE id = ? AND user_id = ?",
            (fact_id, user_id),
        )
        await db.commit()
        return cursor.rowcount > 0


@register_tool(
    "remember_fact",
    description=(
        "Store a durable fact about the user for future conversations — "
        "preferences, allergies, important dates, family details, ongoing "
        "projects. Only store things worth remembering long-term, never "
        "transient conversation details."
    ),
    parameters={
        "type": "object",
        "properties": {
            "fact": {
                "type": "string",
                "description": "The fact to remember, phrased as a short standalone sentence",
            },
            "category": {
                "type": "string",
                "description": "One-word category, e.g. preference, health, family, date, project",
            },
        },
        "required": ["fact"],
    },
    status="Updating memory…",
)
async def remember_fact(args: dict, ctx: ToolContext):
    fact = (args.get("fact") or "").strip()[:MAX_FACT_LEN]
    category = (args.get("category") or "general").strip()[:40] or "general"
    if not fact:
        return "Error: no fact provided."
    async with ctx.db_connect() as db:
        async with db.execute(
            "SELECT COUNT(*) FROM user_facts WHERE user_id = ?", (ctx.user_id,)
        ) as cur:
            count = (await cur.fetchone())[0]
        if count >= MAX_FACTS_PER_USER:
            return "Error: memory is full — ask the user to remove old facts in Settings first."
        async with db.execute(
            "SELECT 1 FROM user_facts WHERE user_id = ? AND fact = ?",
            (ctx.user_id, fact),
        ) as cur:
            if await cur.fetchone():
                return "Already remembered."
        await db.execute(
            "INSERT INTO user_facts (user_id, fact, category) VALUES (?, ?, ?)",
            (ctx.user_id, fact, category),
        )
        await db.commit()
    return f"Remembered: {fact}"


@register_tool(
    "forget_fact",
    description=(
        "Delete a previously remembered fact about the user. Use when the "
        "user asks you to forget something or a stored fact is no longer true."
    ),
    parameters={
        "type": "object",
        "properties": {
            "fact_hint": {
                "type": "string",
                "description": "A phrase matching the fact to forget (case-insensitive substring)",
            },
        },
        "required": ["fact_hint"],
    },
    status="Updating memory…",
)
async def forget_fact(args: dict, ctx: ToolContext):
    hint = (args.get("fact_hint") or "").strip()
    if not hint:
        return "Error: no hint provided."
    async with ctx.db_connect() as db:
        async with db.execute(
            "SELECT id, fact FROM user_facts WHERE user_id = ? AND fact LIKE ?",
            (ctx.user_id, f"%{hint}%"),
        ) as cur:
            rows = await cur.fetchall()
        if not rows:
            return f"No stored fact matches '{hint}'."
        if len(rows) > 3:
            return (
                f"{len(rows)} facts match '{hint}' — be more specific. Matches: "
                + "; ".join(r[1] for r in rows[:5])
            )
        await db.execute(
            f"DELETE FROM user_facts WHERE id IN ({','.join('?' * len(rows))})",
            [r[0] for r in rows],
        )
        await db.commit()
    return "Forgot: " + "; ".join(r[1] for r in rows)
