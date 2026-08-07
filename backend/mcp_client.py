"""MCP (Model Context Protocol) servers as tBai tools.

Servers are declared in `backend/mcp_servers.json` (stdio transport — each server
is a local subprocess). At startup every enabled server is connected, its tool
list fetched, and each remote tool inserted into `TOOL_REGISTRY` under the key
`mcp__<server>__<tool>`. Both agent loops dispatch generically off that registry,
so neither of them needs to know MCP exists.

Lifetime is the fiddly part. `stdio_client` and `ClientSession` are async context
managers backed by anyio task groups, and a task group's cancel scope must be
exited by the *same task that entered it*. Driving them from a FastAPI lifespan
via an AsyncExitStack is the classic route to
`RuntimeError: Attempted to exit cancel scope in a different task` on shutdown.
So each server gets its own supervisor task that opens the contexts, registers the
tools, and then parks on an `asyncio.Event` — enter and exit both happen inside
that one task, and shutdown is just "set the event and wait".
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from tools import TOOL_REGISTRY, UNTRUSTED_DATA_NOTICE, Tool, ToolContext

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent / "mcp_servers.json"

KEY_PREFIX = "mcp__"

# A single server can expose dozens of tools, and every schema is re-sent to the
# model on every round. Cap what one server may contribute so adding a chatty
# server can't quietly halve a local model's usable context.
MAX_TOOLS_PER_SERVER = 24

CONNECT_TIMEOUT = 30.0   # `npx` cold starts are genuinely slow the first time
CALL_TIMEOUT = 60.0
SHUTDOWN_TIMEOUT = 10.0
MAX_RESULT_CHARS = 8000


@dataclass
class ServerState:
    """Everything the admin UI needs to know about one configured server."""
    name: str
    enabled: bool
    status: str = "disabled"          # disabled | connecting | connected | failed
    error: str | None = None
    tools: list[dict] = field(default_factory=list)   # [{"key", "name", "description"}]
    skipped: list[str] = field(default_factory=list)  # tools dropped by the cap/allow-list


SERVERS: dict[str, ServerState] = {}

_tasks: dict[str, asyncio.Task] = {}
_stop_events: dict[str, asyncio.Event] = {}


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> list[dict]:
    """Read mcp_servers.json. A missing file means "no servers", not an error."""
    if not CONFIG_PATH.is_file():
        return []
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        logger.error("mcp_servers.json is unreadable: %s", exc)
        return []
    servers = data.get("servers") if isinstance(data, dict) else data
    if not isinstance(servers, list):
        logger.error("mcp_servers.json: expected a 'servers' array")
        return []
    return [s for s in servers if isinstance(s, dict) and s.get("name") and s.get("command")]


# ── Registry plumbing ─────────────────────────────────────────────────────────

def _sanitize(text: str) -> str:
    """Tool names reach both Ollama and Anthropic, which only accept [A-Za-z0-9_-]."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", text)


def _flatten_content(content) -> str:
    """Turn an MCP CallToolResult's content blocks into one string for the model."""
    parts: list[str] = []
    for block in content or []:
        kind = getattr(block, "type", None)
        if kind == "text":
            parts.append(getattr(block, "text", "") or "")
        elif kind == "image":
            parts.append("[image returned by the tool — not shown]")
        elif kind == "resource":
            resource = getattr(block, "resource", None)
            text = getattr(resource, "text", None)
            parts.append(text if text else f"[resource: {getattr(resource, 'uri', '?')}]")
        else:
            parts.append(f"[unsupported content block: {kind}]")
    return "\n".join(p for p in parts if p)


def _make_handler(server_name: str, session, remote_name: str):
    async def handler(args: dict, ctx: ToolContext):
        try:
            result = await asyncio.wait_for(
                session.call_tool(remote_name, args or {}), timeout=CALL_TIMEOUT
            )
        except asyncio.TimeoutError:
            return f"Error: {server_name}/{remote_name} timed out after {CALL_TIMEOUT:.0f}s."
        except Exception as exc:
            return f"Error: {server_name}/{remote_name} failed ({exc})."

        text = _flatten_content(getattr(result, "content", None))
        if not text:
            structured = getattr(result, "structuredContent", None)
            text = json.dumps(structured)[:MAX_RESULT_CHARS] if structured else "(no output)"
        if len(text) > MAX_RESULT_CHARS:
            text = text[:MAX_RESULT_CHARS] + "\n…[truncated]"

        if getattr(result, "isError", False):
            # _execute_tool and providers._run_tool both key off this prefix.
            return f"Error: {server_name}/{remote_name}: {text}"
        # Whatever the server returns is third-party content, same as web search.
        return UNTRUSTED_DATA_NOTICE + text

    return handler


def _register_tools(cfg: dict, session, remote_tools: list) -> ServerState:
    name = cfg["name"]
    state = SERVERS[name]
    allow = cfg.get("tools")
    allow = set(allow) if isinstance(allow, list) and allow else None

    registered: list[dict] = []
    skipped: list[str] = []
    for rt in remote_tools:
        if allow is not None and rt.name not in allow:
            skipped.append(rt.name)
            continue
        if len(registered) >= MAX_TOOLS_PER_SERVER:
            skipped.append(rt.name)
            continue
        key = f"{KEY_PREFIX}{_sanitize(name)}__{_sanitize(rt.name)}"
        if key in TOOL_REGISTRY:
            logger.warning("mcp: %s/%s collides with an existing tool, skipping", name, rt.name)
            skipped.append(rt.name)
            continue
        schema = rt.inputSchema or {"type": "object", "properties": {}}
        TOOL_REGISTRY[key] = Tool(
            schema={
                "type": "function",
                "function": {
                    "name": key,
                    "description": (rt.description or rt.name)[:1000],
                    "parameters": schema,
                },
            },
            func=_make_handler(name, session, rt.name),
            status=f"Using {name}…",
        )
        registered.append(
            {"key": key, "name": rt.name, "description": (rt.description or "")[:200]}
        )

    state.tools = registered
    state.skipped = skipped
    if skipped:
        logger.info("mcp: %s contributed %d tool(s), skipped %d", name, len(registered), len(skipped))
    return state


def _unregister_tools(server_name: str) -> None:
    prefix = f"{KEY_PREFIX}{_sanitize(server_name)}__"
    for key in [k for k in list(TOOL_REGISTRY) if k.startswith(prefix)]:
        TOOL_REGISTRY.pop(key, None)


# ── Supervisor ────────────────────────────────────────────────────────────────

async def _supervise(cfg: dict, ready: asyncio.Event, stop: asyncio.Event) -> None:
    """Own one server's connection for its whole lifetime, in a single task."""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import get_default_environment, stdio_client

    name = cfg["name"]
    state = SERVERS[name]
    try:
        kwargs = {
            "command": cfg["command"],
            "args": [str(a) for a in cfg.get("args") or []],
            # stdio_client starts from a deliberately minimal env; merge, don't replace.
            "env": {**get_default_environment(), **(cfg.get("env") or {})},
        }
        if cfg.get("cwd"):
            kwargs["cwd"] = cfg["cwd"]
        params = StdioServerParameters(**kwargs)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                _register_tools(cfg, session, listed.tools)
                state.status = "connected"
                state.error = None
                logger.info("mcp: connected to %s (%d tools)", name, len(state.tools))
                ready.set()
                await stop.wait()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        state.status = "failed"
        state.error = f"{exc.__class__.__name__}: {exc}"
        logger.error("mcp: %s failed — %s", name, state.error)
    finally:
        _unregister_tools(name)
        if state.status == "connected":
            # Reached either by a deliberate stop or by the subprocess dying under
            # us; either way the tools are gone, so don't keep advertising them.
            state.status = "stopped"
            state.tools = []
        ready.set()  # never leave connect_all() waiting on a dead supervisor


async def connect_all() -> None:
    """Connect every enabled server. Never raises — failures are recorded in SERVERS."""
    SERVERS.clear()
    configs = load_config()
    pending: list[tuple[str, asyncio.Event]] = []

    for cfg in configs:
        name = cfg["name"]
        enabled = cfg.get("enabled", True)
        SERVERS[name] = ServerState(name=name, enabled=enabled)
        if not enabled:
            continue
        SERVERS[name].status = "connecting"
        ready, stop = asyncio.Event(), asyncio.Event()
        _stop_events[name] = stop
        _tasks[name] = asyncio.create_task(_supervise(cfg, ready, stop), name=f"mcp:{name}")
        pending.append((name, ready))

    for name, ready in pending:
        try:
            await asyncio.wait_for(ready.wait(), timeout=CONNECT_TIMEOUT)
        except asyncio.TimeoutError:
            # Don't let one slow/hung server hold up the whole app boot.
            SERVERS[name].status = "failed"
            SERVERS[name].error = f"timed out after {CONNECT_TIMEOUT:.0f}s"
            logger.error("mcp: %s timed out while connecting", name)
            await _stop_one(name)


async def _stop_one(name: str) -> None:
    stop = _stop_events.pop(name, None)
    task = _tasks.pop(name, None)
    if stop is not None:
        stop.set()
    if task is None:
        return
    try:
        # shield so a timeout cancels the wait, not the supervisor — we want to
        # cancel it explicitly below, after giving it a chance to exit cleanly.
        await asyncio.wait_for(asyncio.shield(task), timeout=SHUTDOWN_TIMEOUT)
    except asyncio.TimeoutError:
        logger.warning("mcp: %s did not stop in time, cancelling", name)
        task.cancel()
        try:
            await task
        except BaseException:  # shutdown is best-effort — never propagate
            pass
    except BaseException:
        pass
    finally:
        _unregister_tools(name)


async def shutdown() -> None:
    """Stop every server subprocess. Safe to call when nothing is connected."""
    for name in list(_tasks):
        await _stop_one(name)


async def reconnect_all() -> list[ServerState]:
    """Admin reload: tear every server down and bring it back from the config file."""
    await shutdown()
    await connect_all()
    return list(SERVERS.values())


def server_states() -> list[dict]:
    return [
        {
            "name": s.name,
            "enabled": s.enabled,
            "status": s.status,
            "error": s.error,
            "tools": s.tools,
            "skipped": s.skipped,
        }
        for s in SERVERS.values()
    ]
