from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent / "chat_history.db"


@asynccontextmanager
async def connect():
    """Open a connection with the pragmas every request needs.

    journal_mode=WAL is set once at startup (init_db) and persists in the DB
    file; busy_timeout and foreign_keys are per-connection and must be set here.
    """
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute("PRAGMA busy_timeout = 5000")
        await db.execute("PRAGMA foreign_keys = ON")
        yield db
    finally:
        await db.close()
