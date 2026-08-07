"""Wikipedia lookups as a tool: `wikipedia_lookup`.

`web_search` (tools.py) returns ~500-char Brave snippets, which is fine for "what
happened this week" but never carries the facts an encyclopedia article keeps in
its infobox — a film's runtime, budget, and box office essentially never appear
in a search snippet. This tool goes to the source instead.

Deliberately *not* a general `web_fetch`. The host is hardcoded, so the SSRF
warning standing at tools.py:58 doesn't apply: there is no LLM-supplied URL to
validate, no private-range or DNS-rebinding surface. It also means the response
is clean plain text with no HTML parser (and no new dependency), and that one
tool call covers search *and* fetch — which matters, because a skill-driven turn
already spends one of MAX_TOOL_ROUNDS on `load_skill`.

Three MediaWiki calls per lookup: resolve the title (`list=search`), pull the
article as plain text (`prop=extracts`), and pull section 0's wikitext
(`action=parse`) for the infobox.
"""

import html
import re
import urllib.parse

import httpx

from tools import UNTRUSTED_DATA_NOTICE, ToolContext, register_tool

API_URL = "https://en.wikipedia.org/w/api.php"
ARTICLE_BASE = "https://en.wikipedia.org/wiki/"

# MediaWiki's API etiquette policy requires a descriptive User-Agent and serves
# 403 to generic ones.
USER_AGENT = "tBai/1.0 (self-hosted family assistant; https://tbai.tenbosch.org)"

TIMEOUT = httpx.Timeout(connect=10.0, read=15.0, write=10.0, pool=10.0)

# A tool result rides along in messages[] for the rest of the turn, so bound it
# the way tools._MAX_FIELD_LEN bounds a search result. A full article is ~30k
# chars — far more than a local model should have to carry.
MAX_INFOBOX_CHARS = 2000
MAX_EXTRACT_CHARS = 4000
MAX_CANDIDATES = 5

# Trailing apparatus sections carry no facts worth the context budget.
SKIP_SECTIONS = {
    "references", "external links", "notes", "further reading",
    "see also", "bibliography", "sources", "citations", "footnotes",
}

_RE_COMMENT = re.compile(r"<!--.*?-->", re.S)
_RE_REF = re.compile(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", re.S | re.I)
# [[Dune (novel)|Dune]] -> Dune, and [[David Lynch]] -> David Lynch
_RE_LINK = re.compile(r"\[\[(?:[^\[\]|]*\|)?([^\[\]|]+)\]\]")
_RE_TAG = re.compile(r"<[^>]+>")
_RE_BLANKS = re.compile(r"\n{3,}")
_RE_SECTION = re.compile(r"^(=+)\s*(.+?)\s*=+\s*$", re.M)


def _clean_wikitext(text: str) -> str:
    """Strip the markup that makes raw wikitext hard for a small model to read.

    Templates are left intact: `{{Film date|1984|12|3|...}}` still reads as a
    date, and unwrapping them generically garbles more than it fixes.
    """
    text = _RE_COMMENT.sub("", text)
    text = _RE_REF.sub("", text)
    text = _RE_LINK.sub(r"\1", text)
    text = _RE_TAG.sub("", text)
    text = text.replace("'''", "").replace("''", "")
    # Infobox numbers are littered with entities — "$40&ndash;42&nbsp;million".
    text = html.unescape(text).replace("\xa0", " ")
    return _RE_BLANKS.sub("\n\n", text).strip()


def _extract_infobox(wikitext: str) -> str:
    """Pull the `{{Infobox ...}}` block out of section-0 wikitext.

    Brace-depth scanned rather than regexed: infoboxes nest templates
    (`{{plainlist|...}}` inside `| starring =`), so a non-greedy `\\{\\{.*?\\}\\}`
    would stop at the first inner `}}` and truncate the box.
    """
    match = re.search(r"\{\{\s*Infobox", wikitext, re.I)
    if not match:
        return ""
    start = match.start()
    depth = 0
    i = start
    while i < len(wikitext) - 1:
        pair = wikitext[i:i + 2]
        if pair == "{{":
            depth += 1
            i += 2
        elif pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return wikitext[start:i]
        else:
            i += 1
    return wikitext[start:]  # unbalanced markup — take what's there


def _select_extract(extract: str) -> str:
    """The lead paragraphs plus as many body sections as the budget allows.

    Blind truncation would spend the whole budget on the lead and whatever
    section happened to follow. Walking the `== Heading ==` markers instead keeps
    the lead intact and then adds real content sections (Plot, Cast, …) in order,
    skipping the trailing apparatus.
    """
    headings = list(_RE_SECTION.finditer(extract))
    if not headings:
        return extract[:MAX_EXTRACT_CHARS].strip()

    lead = extract[: headings[0].start()].strip()
    parts = [lead]
    used = len(lead)

    for idx, heading in enumerate(headings):
        title = heading.group(2).strip()
        if title.lower() in SKIP_SECTIONS:
            continue
        end = headings[idx + 1].start() if idx + 1 < len(headings) else len(extract)
        body = extract[heading.end():end].strip()
        if not body:
            continue
        remaining = MAX_EXTRACT_CHARS - used
        if remaining <= 200:  # too little left to be worth a heading
            break
        block = f"== {title} ==\n{body}"
        if len(block) > remaining:
            block = block[:remaining].rstrip() + "…"
        parts.append(block)
        used += len(block)

    return "\n\n".join(p for p in parts if p).strip()


async def _api_get(client: httpx.AsyncClient, params: dict) -> dict:
    resp = await client.get(API_URL, params={**params, "format": "json"})
    resp.raise_for_status()
    return resp.json()


async def _search(client: httpx.AsyncClient, query: str) -> list[str]:
    data = await _api_get(
        client, {"action": "query", "list": "search", "srsearch": query, "srlimit": MAX_CANDIDATES}
    )
    return [r["title"] for r in data.get("query", {}).get("search", [])]


async def _fetch_extract(client: httpx.AsyncClient, title: str) -> tuple[str, str] | None:
    """Return (resolved_title, plain_text_extract), or None if the page is missing."""
    data = await _api_get(
        client,
        {
            "action": "query",
            "prop": "extracts",
            "explaintext": 1,
            "redirects": 1,   # follow "Matrix (film)" -> "The Matrix"
            "titles": title,
        },
    )
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        if "missing" in page:  # the API signals absence with a bare "missing" key
            return None
        return page.get("title", title), page.get("extract", "") or ""
    return None


async def _fetch_infobox(client: httpx.AsyncClient, title: str) -> str:
    """Section-0 wikitext's infobox, or "" — never fatal, the extract still stands."""
    try:
        data = await _api_get(
            client, {"action": "parse", "page": title, "prop": "wikitext", "section": 0}
        )
    except httpx.HTTPError:
        return ""
    if "error" in data:  # e.g. missingtitle
        return ""
    wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "") or ""
    return _clean_wikitext(_extract_infobox(wikitext))[:MAX_INFOBOX_CHARS]


def _article_url(title: str) -> str:
    return ARTICLE_BASE + urllib.parse.quote(title.replace(" ", "_"))


@register_tool(
    "wikipedia_lookup",
    description=(
        "Look up an English Wikipedia article and return its infobox facts plus the "
        "article text. Use this for encyclopedic subjects — movies, TV shows, books, "
        "people, places, history, science. It returns far more detail than web_search, "
        "including infobox fields like director, cast, runtime, budget and box office. "
        "For a film, put the word 'film' in the title (e.g. 'Dune film')."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": (
                    "Subject to look up, e.g. 'The Matrix film' or 'Marie Curie'. "
                    "Add 'film' when looking up a movie so a film article ranks first."
                ),
            },
            "year": {
                "type": "string",
                "description": (
                    "Optional year, to disambiguate works sharing a title "
                    "(e.g. '1984' for the Dune film)."
                ),
            },
        },
        "required": ["title"],
    },
    status="Looking up Wikipedia…",
)
async def wikipedia_lookup(args: dict, ctx: ToolContext):
    """Search Wikipedia, then return the best article's infobox and text.

    Never raises: a transport failure comes back as an error string the model can
    react to in its answer, the same contract as tools.brave_search.
    """
    title = (args.get("title") or "").strip()
    if not title:
        return "Error: no title provided."
    year = str(args.get("year") or "").strip()
    query = f"{title} {year}".strip()

    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}
        ) as client:
            candidates = await _search(client, query)
            if not candidates:
                return f"No Wikipedia article found for '{query}'."

            found = await _fetch_extract(client, candidates[0])
            if found is None:
                return f"No Wikipedia article found for '{query}'."
            resolved, extract = found
            infobox = await _fetch_infobox(client, resolved)
    except httpx.HTTPError as exc:
        return f"Wikipedia lookup failed: {exc}"

    sections = [f"Article: {resolved}\nURL: {_article_url(resolved)}"]
    if len(candidates) > 1:
        # The skill's disambiguation step needs the alternatives, not just the
        # winner — "Dune" alone ranks the franchise above either film.
        others = ", ".join(candidates[1:])
        sections.append(f"Other Wikipedia articles matching this search: {others}")
    if infobox:
        sections.append(f"Infobox (raw fields):\n{infobox}")
    if extract:
        sections.append(f"Article text:\n{_select_extract(extract)}")

    return {
        "result": UNTRUSTED_DATA_NOTICE + "\n\n".join(sections),
        "sources": [{"title": resolved, "url": _article_url(resolved)}],
    }
