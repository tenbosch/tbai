"""Databricks-hosted models: the agent loop for an OpenAI-compatible endpoint.

Models served from a Databricks workspace (e.g. databricks-kimi-k3) are reached
through the workspace AI Gateway, which speaks the OpenAI chat-completions API.
Like providers.py this emits the same NDJSON event dicts (token/status/sources/
error), executes the same TOOL_REGISTRY tools, and shares the same system prompt
as the local Ollama loop — only the transport and message format differ.

Unlike the Anthropic models, these are NOT admin-gated: any whitelisted user can
pick one (see /models and /chat in main.py). That is why routing uses
is_databricks_model() rather than providers.is_cloud_model().

Two shape differences from the Ollama loop in agent_logic.py, and the reason
this can't simply reuse it:
  * tool arguments arrive as a JSON *string*, streamed in fragments that must be
    accumulated per tool-call index — not as a ready-made dict;
  * every tool result message must carry the tool_call_id it answers.

The registry's schemas are already OpenAI-format (tools.register_tool), so
tool_schemas() is passed through verbatim — no translation layer, unlike
providers._anthropic_tools().
"""

import json
import logging
import os

import openai

from tools import TOOL_REGISTRY, ToolContext, tool_schemas

log = logging.getLogger("tbai.databricks")

DATABRICKS_MODELS_ENV = "DATABRICKS_MODELS"
DEFAULT_DATABRICKS_MODELS = ["databricks-kimi-k3"]

MAX_OUTPUT_TOKENS = 8192  # a ceiling, not a target — billing is per actual token

# Generous enough to survive a scale-to-zero endpoint waking up, but bounded so
# a hung gateway can never hold a /chat request open forever.
REQUEST_TIMEOUT = 300.0

# Model ids whose endpoint rejected the `tools` parameter. Populated at most
# once per model per process (see the degradation path in the round loop), so
# only the very first request ever pays for the probe.
_TOOLS_UNSUPPORTED: set[str] = set()


def databricks_available() -> bool:
    return bool(os.getenv("DATABRICKS_TOKEN") and os.getenv("DATABRICKS_BASE_URL"))


def databricks_models() -> list[str]:
    raw = os.getenv(DATABRICKS_MODELS_ENV, "")
    models = [m.strip() for m in raw.split(",") if m.strip()]
    return models or list(DEFAULT_DATABRICKS_MODELS)


def is_databricks_model(model: str) -> bool:
    """Exact membership, not a prefix match, so a local Ollama model whose name
    happens to start with "databricks" can never be routed off-machine."""
    return databricks_available() and model in databricks_models()


def _user_message(user_input: str, images: list[dict] | None) -> dict:
    """Build the user turn, using OpenAI vision blocks when images are attached."""
    if not images:
        return {"role": "user", "content": user_input}
    content = [
        {
            "type": "image_url",
            "image_url": {"url": f"data:{img['mime']};base64,{img['b64']}"},
        }
        for img in images
    ]
    content.append({"type": "text", "text": user_input})
    return {"role": "user", "content": content}


def _collect_tool_call(calls: dict[int, dict], delta_call) -> None:
    """Fold one streamed tool_call delta into the per-index accumulator.

    Only the first chunk of a call carries `id` and `function.name`; every later
    chunk appends another fragment of the `arguments` JSON string.
    """
    call = calls.setdefault(delta_call.index, {"id": "", "name": "", "arguments": ""})
    if delta_call.id:
        call["id"] = delta_call.id
    fn = delta_call.function
    if fn is None:
        return
    if fn.name:
        call["name"] = fn.name
    if fn.arguments:
        call["arguments"] += fn.arguments


def _status_error_event(exc: openai.APIStatusError) -> dict:
    """Map a non-2xx gateway response to a user-facing error event.

    4xx is a problem with THIS request (a bad image, a malformed message, an
    endpoint name that doesn't exist), so surfacing the API's own message makes
    it actionable; 5xx is server-side and stays generic.
    """
    log.error("Databricks API error %s: %s", exc.status_code, exc.message)
    if exc.status_code == 404:
        return {
            "type": "error",
            "text": (
                "That Databricks model endpoint wasn't found. Check DATABRICKS_MODELS "
                "and DATABRICKS_BASE_URL in backend/.env."
            ),
        }
    if 400 <= exc.status_code < 500 and exc.message:
        return {"type": "error", "text": f"The Databricks model rejected the request: {exc.message}"}
    return {
        "type": "error",
        "text": f"Databricks model error ({exc.status_code}). Try the local model.",
    }


async def stream_agent_databricks(
    model: str,
    history: list[dict],
    user_input: str,
    ctx: ToolContext,
    images: list[dict] | None = None,
):
    """Iterative tool-calling loop against an OpenAI-compatible endpoint (streaming).

    Yields the same event dicts as agent_logic.stream_agent so the transport
    layer and frontend stay provider-agnostic.
    """
    # Deferred imports: agent_logic imports nothing from here, so this direction
    # is cycle-free (same arrangement as providers.py).
    from agent_logic import MAX_TOOL_ROUNDS, _execute_tool, _system_prompt, _window_history
    from memory import get_user_facts

    facts = await get_user_facts(ctx.db_connect, ctx.user_id)

    # DB history is plain user/assistant text — already valid OpenAI messages.
    messages: list[dict] = [{"role": "system", "content": _system_prompt(ctx, facts)}]
    messages.extend(
        {"role": m["role"], "content": m["content"]}
        for m in _window_history(history)
        if m.get("content")
    )
    messages.append(_user_message(user_input, images))

    client = openai.AsyncOpenAI(
        api_key=os.getenv("DATABRICKS_TOKEN"),
        base_url=os.getenv("DATABRICKS_BASE_URL"),
        timeout=REQUEST_TIMEOUT,
    )
    all_sources: list[dict] = []

    try:
        for round_no in range(MAX_TOOL_ROUNDS):
            # The final round drops the schemas to force an answer rather than
            # yet another tool call.
            last_round = round_no == MAX_TOOL_ROUNDS - 1
            use_tools = not last_round and model not in _TOOLS_UNSUPPORTED

            content_parts: list[str] = []
            calls: dict[int, dict] = {}

            # Loops at most twice, and only to retry without `tools` when the
            # endpoint turns out not to support function calling.
            while True:
                kwargs: dict = {
                    "model": model,
                    "messages": messages,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "stream": True,
                }
                if use_tools:
                    kwargs["tools"] = tool_schemas()

                try:
                    stream = await client.chat.completions.create(**kwargs)
                    async for chunk in stream:
                        if not chunk.choices:
                            continue  # usage-only / keep-alive chunk
                        delta = chunk.choices[0].delta
                        if delta is None:
                            continue
                        if delta.content:
                            content_parts.append(delta.content)
                            yield {"type": "token", "text": delta.content}
                        for delta_call in delta.tool_calls or []:
                            _collect_tool_call(calls, delta_call)
                except (openai.BadRequestError, openai.UnprocessableEntityError) as exc:
                    # Not every hosted model accepts `tools`. Rule it out once,
                    # remember it for the process, and answer as a plain chat
                    # model instead of failing the turn. Only safe before any
                    # token has streamed, which a schema rejection always is.
                    if use_tools and not content_parts:
                        log.warning(
                            "Databricks model %s rejected tool schemas (%s) — "
                            "falling back to plain chat for this process: %s",
                            model, exc.status_code, exc.message,
                        )
                        _TOOLS_UNSUPPORTED.add(model)
                        use_tools = False
                        calls.clear()
                        continue
                    yield _status_error_event(exc)
                    return
                break

            if not calls:
                break  # normal answer — turn complete

            # The model called tools: record its turn verbatim, run each tool,
            # feed the results back, and loop for the next round.
            tool_calls = [calls[i] for i in sorted(calls)]
            messages.append(
                {
                    "role": "assistant",
                    "content": "".join(content_parts) or None,
                    "tool_calls": [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                        }
                        for c in tool_calls
                    ],
                }
            )
            for c in tool_calls:
                tool = TOOL_REGISTRY.get(c["name"])
                if tool is not None and tool.status:
                    yield {"type": "status", "text": tool.status}
                try:
                    args = json.loads(c["arguments"] or "{}")
                except json.JSONDecodeError:
                    # Every tool_call must get a matching result or the next
                    # request is malformed — an unparseable one gets an error.
                    result_text, sources = f"Error: could not parse arguments for '{c['name']}'", []
                else:
                    result_text, sources = await _execute_tool(c["name"], args, ctx)
                all_sources.extend(sources)
                messages.append(
                    {"role": "tool", "tool_call_id": c["id"], "content": result_text}
                )
    except openai.AuthenticationError:
        yield {
            "type": "error",
            "text": (
                "Databricks rejected the access token. Check DATABRICKS_TOKEN in "
                "backend/.env — personal access tokens expire."
            ),
        }
        return
    except openai.RateLimitError:
        yield {
            "type": "error",
            "text": (
                "The Databricks model is rate-limited right now — try again shortly, "
                "or switch to the local model."
            ),
        }
        return
    except openai.APIConnectionError:
        yield {
            "type": "error",
            "text": "Could not reach the Databricks model. Please try again.",
        }
        return
    except openai.APIStatusError as exc:
        yield _status_error_event(exc)
        return

    if all_sources:
        seen = set()
        unique_sources = []
        for s in all_sources:
            if s["url"] not in seen:
                seen.add(s["url"])
                unique_sources.append(s)
        yield {"type": "sources", "items": unique_sources}
