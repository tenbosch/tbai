"""Cloud model provider: the agent loop for Anthropic (Claude) models.

Local models go through the Ollama loop in agent_logic.py; models whose id
starts with "claude" come here. Both emit the same NDJSON event dicts
(token/status/sources/error), execute the same TOOL_REGISTRY tools, and share
the same system prompt — only the transport and message format differ.

Cloud access is admin-gated server-side in main.py (/models and /chat).
"""

import logging
import os

import anthropic

from tools import TOOL_REGISTRY, ToolContext

log = logging.getLogger("tbai.providers")

# One household API key, set in backend/.env; cloud models are hidden when absent.
ANTHROPIC_MODELS_ENV = "ANTHROPIC_MODELS"
DEFAULT_ANTHROPIC_MODELS = ["claude-opus-4-8"]

# Shared with the Ollama loop so the two providers can't drift apart; imported
# lazily inside the loop alongside _system_prompt (agent_logic imports tools, and
# a top-level import here would close the cycle).
MAX_OUTPUT_TOKENS = 64_000  # streaming; a ceiling, not a target — billing is per actual token


def anthropic_available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def cloud_models() -> list[str]:
    raw = os.getenv(ANTHROPIC_MODELS_ENV, "")
    models = [m.strip() for m in raw.split(",") if m.strip()]
    return models or list(DEFAULT_ANTHROPIC_MODELS)


def is_cloud_model(model: str) -> bool:
    return model.startswith("claude")


def _anthropic_tools() -> list[dict]:
    """Translate the registry's OpenAI-style schemas to Anthropic tool format."""
    out = []
    # Snapshot: MCP tools are registered/removed at runtime (see mcp_client.py).
    for name, tool in list(TOOL_REGISTRY.items()):
        fn = tool.schema["function"]
        out.append(
            {
                "name": name,
                "description": fn["description"],
                "input_schema": fn["parameters"],
            }
        )
    return out


async def stream_agent_anthropic(
    model: str,
    history: list[dict],
    user_input: str,
    ctx: ToolContext,
    images: list[dict] | None = None,
):
    """Iterative tool-use loop against the Anthropic Messages API (streaming).

    Yields the same event dicts as agent_logic.stream_agent so the transport
    layer and frontend are provider-agnostic.
    """
    # Shared system prompt + memory injection (deferred import: agent_logic
    # imports nothing from here, so this direction is cycle-free).
    from agent_logic import MAX_TOOL_ROUNDS, _system_prompt, _window_history
    from memory import get_user_facts

    facts = await get_user_facts(ctx.db_connect, ctx.user_id)
    system = _system_prompt(ctx, facts)

    # DB history is plain user/assistant text — already valid Anthropic messages.
    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in _window_history(history)
        if m.get("content")
    ]
    if images:
        content = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": img["mime"], "data": img["b64"]},
            }
            for img in images
        ]
        content.append({"type": "text", "text": user_input})
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": user_input})

    client = anthropic.AsyncAnthropic()
    tools = _anthropic_tools()
    all_sources: list[dict] = []

    try:
        for _round in range(MAX_TOOL_ROUNDS):
            async with client.messages.stream(
                model=model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=system,
                messages=messages,
                tools=tools,
                thinking={"type": "adaptive"},
            ) as stream:
                async for event in stream:
                    if (
                        event.type == "content_block_delta"
                        and event.delta.type == "text_delta"
                        and event.delta.text
                    ):
                        yield {"type": "token", "text": event.delta.text}
                response = await stream.get_final_message()

            if response.stop_reason == "refusal":
                yield {
                    "type": "error",
                    "text": "The cloud model declined this request for safety reasons.",
                }
                return

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                break  # normal answer — turn complete

            # Append the assistant turn (verbatim blocks), run the tools, and
            # return ALL results in a single user message.
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for block in tool_uses:
                tool = TOOL_REGISTRY.get(block.name)
                if tool is not None and tool.status:
                    yield {"type": "status", "text": tool.status}
                result_text, sources = await _run_tool(block.name, block.input or {}, ctx)
                all_sources.extend(sources)
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_text,
                        "is_error": result_text.startswith("Error:"),
                    }
                )
            messages.append({"role": "user", "content": results})
    except anthropic.APIConnectionError:
        yield {"type": "error", "text": "Could not reach the cloud model. Please try again."}
        return
    except anthropic.RateLimitError:
        yield {"type": "error", "text": "The cloud model is rate-limited right now — try again shortly, or switch to the local model."}
        return
    except anthropic.APIStatusError as exc:
        log.error("Anthropic API error %s: %s", exc.status_code, exc.message)
        # 4xx is a problem with THIS request (a bad/oversized image, an
        # unsupported media type, a malformed message) — surfacing the API's own
        # message makes it actionable rather than an opaque status code. 5xx is
        # server-side, so keep that one generic.
        if 400 <= exc.status_code < 500 and exc.message:
            text = f"The cloud model rejected the request: {exc.message}"
        else:
            text = f"Cloud model error ({exc.status_code}). Try the local model."
        yield {"type": "error", "text": text}
        return

    if all_sources:
        seen = set()
        unique_sources = []
        for s in all_sources:
            if s["url"] not in seen:
                seen.add(s["url"])
                unique_sources.append(s)
        yield {"type": "sources", "items": unique_sources}


async def _run_tool(name: str, args: dict, ctx: ToolContext):
    """Run a registered tool; returns (result_text, sources). Never raises."""
    tool = TOOL_REGISTRY.get(name)
    if tool is None:
        return f"Error: unknown tool '{name}'", []
    try:
        result = await tool.func(args, ctx)
    except Exception as exc:
        return f"Error: {name} failed ({exc})", []
    if isinstance(result, dict):
        return str(result.get("result", "")), list(result.get("sources") or [])
    return str(result), []
