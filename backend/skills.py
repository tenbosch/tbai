"""Markdown-authored skills: procedural knowledge with no Python.

A skill is a folder under `backend/skills/` containing a `SKILL.md` with YAML
frontmatter (`name`, `description`, optional `enabled`) and a markdown body of
instructions.

Loading is *progressive*: only each skill's one-line description goes into the
system prompt (see `skills_prompt_block`), and the model pulls the full body in
on demand via the `load_skill` tool. Local models have small context windows —
pasting every skill body into every request would crowd out the conversation.

The index is built at startup and rebuilt by POST /admin/skills/reload, so
editing a markdown file never requires a backend restart. The admin panel can
also author these files (see the read/write helpers at the bottom of this
module); markdown is inert, so a web form writing one is safe in a way that a
web form writing an MCP subprocess command line would not be.
"""

import logging
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import yaml

from tools import TOOL_REGISTRY, ToolContext, register_tool

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).parent / "skills"

# One skill body is injected as a tool result, which then rides along in the
# message list for the rest of the turn. Bound it so a runaway markdown file
# can't eat a small local model's whole context window.
MAX_SKILL_CHARS = 8000

# Guard the system-prompt listing too: it's paid on every single request.
MAX_DESCRIPTION_LEN = 200

MAX_NAME_LEN = 64

# A slug is the on-disk identity of a skill: the directory name for the
# `<slug>/SKILL.md` layout, or the file stem for a flat `<slug>.md`. It is what
# the admin endpoints address, because a file that fails to parse has no usable
# frontmatter `name` but still needs to be editable/deletable from the browser.
MAX_SLUG_LEN = 48
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,%d}$" % (MAX_SLUG_LEN - 1))
RESERVED_SLUGS = {"readme"}  # `readme.md` is the authoring guide, not a skill

# The fixed part of load_skill's tool description. _refresh_load_skill_schema()
# appends the live skill names to it, rebuilding from this constant every time so
# repeated reloads can't accumulate names that have since been deleted.
_LOAD_SKILL_BASE_DESCRIPTION = (
    "Load the full instructions for one of the skills listed in your system prompt. "
    "Call this before attempting a task that a skill covers."
)


@dataclass
class Skill:
    name: str
    description: str
    path: str        # relative to backend/, for display — never an absolute path
    slug: str        # on-disk identity; what the admin endpoints address
    body: str
    truncated: bool
    enabled: bool


SKILL_INDEX: dict[str, Skill] = {}
LOAD_ERRORS: list[dict] = []  # [{"path", "slug", "error"}] — surfaced in the admin UI


def _split_frontmatter(text: str) -> tuple[dict, str]:
    """Split a `---` fenced YAML frontmatter block off the front of a markdown file.

    Returns (metadata, body). Raises ValueError if the file has no frontmatter or
    the YAML doesn't parse to a mapping.
    """
    stripped = text.lstrip("﻿")  # tolerate a BOM (Notepad on Windows adds one)
    if not stripped.startswith("---"):
        raise ValueError("missing '---' YAML frontmatter block at the top of the file")
    # Split on the *closing* fence: everything up to the next line that is just '---'.
    lines = stripped.splitlines()
    try:
        end = next(i for i, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    except StopIteration:
        raise ValueError("frontmatter block is never closed with '---'") from None
    meta = yaml.safe_load("\n".join(lines[1:end])) or {}
    if not isinstance(meta, dict):
        raise ValueError("frontmatter must be a YAML mapping (key: value)")
    return meta, "\n".join(lines[end + 1 :]).strip()


def _skill_files() -> list[Path]:
    """Every candidate skill file, preferring the `<name>/SKILL.md` layout."""
    if not SKILLS_DIR.is_dir():
        return []
    files = sorted(SKILLS_DIR.glob("*/SKILL.md"))
    # Also accept a flat `skills/foo.md` for one-off skills not worth a folder.
    files += sorted(p for p in SKILLS_DIR.glob("*.md") if p.name.lower() != "readme.md")
    return files


def _slug_for(path: Path) -> str:
    """The on-disk identity of a skill file: its folder name, or its stem if flat."""
    return path.parent.name if path.name.lower() == "skill.md" else path.stem


def load_skills() -> list[Skill]:
    """Rebuild SKILL_INDEX from disk. Never raises — bad files land in LOAD_ERRORS."""
    root = SKILLS_DIR.resolve()
    index: dict[str, Skill] = {}
    errors: list[dict] = []

    for path in _skill_files():
        rel = path.name
        slug = _slug_for(path)
        try:
            resolved = path.resolve()
            # A symlink inside skills/ must not be able to read arbitrary files.
            if not resolved.is_relative_to(root):
                raise ValueError("resolves outside the skills directory")
            rel = resolved.relative_to(root.parent).as_posix()

            meta, body = _split_frontmatter(resolved.read_text(encoding="utf-8"))
            name = str(meta.get("name") or "").strip()
            description = str(meta.get("description") or "").strip()
            if not name or not description:
                raise ValueError("frontmatter needs both 'name' and 'description'")
            if not body:
                raise ValueError("skill has no body below the frontmatter")
            if name in index:
                raise ValueError(f"duplicate skill name '{name}' (already defined in {index[name].path})")

            truncated = len(body) > MAX_SKILL_CHARS
            index[name] = Skill(
                name=name,
                description=description[:MAX_DESCRIPTION_LEN],
                path=rel,
                slug=slug,
                body=body[:MAX_SKILL_CHARS],
                truncated=truncated,
                # An absent `enabled` key means enabled — the flag only ever
                # appears in files the admin UI has switched off.
                enabled=bool(meta.get("enabled", True)),
            )
        except Exception as exc:  # a malformed skill must never break startup
            logger.warning("skill %s failed to load: %s", rel, exc)
            errors.append({"path": rel, "slug": slug, "error": str(exc)})

    SKILL_INDEX.clear()
    SKILL_INDEX.update(index)
    LOAD_ERRORS.clear()
    LOAD_ERRORS.extend(errors)
    # Every path that changes the index comes through here — startup, the admin
    # reload endpoint, and each authoring mutation — so this is the one place the
    # advertised skill names need refreshing.
    _refresh_load_skill_schema()
    logger.info("loaded %d skill(s), %d error(s)", len(index), len(errors))
    return list(index.values())


def enabled_skills() -> list[Skill]:
    """Skills the model is allowed to see. Disabled ones stay indexed for the admin UI."""
    return [s for s in SKILL_INDEX.values() if s.enabled]


def _refresh_load_skill_schema() -> None:
    """Advertise the live skill names on load_skill's own tool schema.

    The system prompt already lists the skills, but tool schemas are re-sent on
    every round and a small local model weights them more heavily than a system
    prompt it saw once — so a movie question would reach for `web_search`, which
    is right there in the tool list, over a skill mentioned only in the preamble.
    Naming the skills here (and pinning `name` to an enum) puts them in the same
    place the competing tool lives.
    """
    tool = TOOL_REGISTRY.get("load_skill")
    if tool is None:  # the decorator runs at import, so this is defensive only
        return
    names = [s.name for s in enabled_skills()]
    fn = tool.schema["function"]
    fn["description"] = _LOAD_SKILL_BASE_DESCRIPTION + (
        f" Available skills: {', '.join(names)}." if names else ""
    )
    name_schema = fn["parameters"]["properties"]["name"]
    if names:
        name_schema["enum"] = names
    else:
        name_schema.pop("enum", None)  # an empty enum matches nothing at all


def skills_prompt_block() -> str | None:
    """The system-prompt fragment listing available skills, or None if there are none."""
    active = enabled_skills()
    if not active:
        return None
    lines = "\n".join(f"- {s.name}: {s.description}" for s in active)
    return (
        "Before answering anything, check whether one of these skills covers the "
        "request. Each one is a set of instructions for a specific kind of task. If a "
        "skill matches, call load_skill with its exact name FIRST — before any other "
        "tool — and then follow the instructions it returns, including which tools it "
        "tells you to use. Do not guess at a skill's contents from its description "
        "alone, and do not answer from memory when a skill applies.\n"
        f"{lines}"
    )


@register_tool(
    "load_skill",
    # _refresh_load_skill_schema() rewrites this from the same constant on every
    # load_skills(), appending the names that actually exist.
    description=_LOAD_SKILL_BASE_DESCRIPTION,
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Exact name of the skill to load, as listed in the system prompt",
            },
        },
        "required": ["name"],
    },
    status="Loading skill…",
)
async def load_skill(args: dict, ctx: ToolContext):
    """Return a skill's markdown body.

    The model supplies a *name*, never a path, and the name must already be in
    SKILL_INDEX — so path traversal isn't possible by construction.
    """
    name = (args.get("name") or "").strip()
    skill = SKILL_INDEX.get(name)
    if skill is None or not skill.enabled:  # a disabled skill doesn't exist, as far as the model knows
        available = ", ".join(s.name for s in enabled_skills()) or "(none)"
        return f"Error: no skill named '{name}'. Available skills: {available}"
    note = "\n\n[Note: this skill was truncated — it exceeds the size limit.]" if skill.truncated else ""
    return f"# Skill: {skill.name}\n\n{skill.body}{note}"


# ── Authoring: the read/write helpers behind the admin endpoints ──────────────
#
# Every path decision lives here, next to the loader, so the containment rules
# can't drift apart. main.py's handlers stay thin and just map the exceptions
# below onto status codes.


class SkillExists(ValueError):
    """A slug or frontmatter name is already taken. main.py maps this to 409."""


def slugify(name: str) -> str:
    """Turn a skill name into its on-disk slug ('Meal Planning' → 'meal-planning')."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug[:MAX_SLUG_LEN].strip("-")


def _validate_slug(slug: str) -> str:
    slug = (slug or "").strip().lower()
    if not SLUG_RE.match(slug):
        raise ValueError(
            "skill id must be lowercase letters, digits and dashes, "
            f"{MAX_SLUG_LEN} characters or fewer"
        )
    if slug in RESERVED_SLUGS:
        raise ValueError(f"'{slug}' is a reserved name")
    return slug


def _contained(path: Path) -> Path:
    """Resolve a path and refuse anything that lands outside skills/."""
    root = SKILLS_DIR.resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("resolves outside the skills directory")
    return resolved


def _relative_path(path: Path) -> str:
    """The display path, relative to backend/ — same form load_skills() records."""
    return path.resolve().relative_to(SKILLS_DIR.resolve().parent).as_posix()


def skill_file_for(slug: str) -> Path | None:
    """The existing file for `slug`, or None. Raises ValueError on a malformed slug."""
    slug = _validate_slug(slug)
    for candidate in (SKILLS_DIR / slug / "SKILL.md", SKILLS_DIR / f"{slug}.md"):
        resolved = _contained(candidate)
        if resolved.is_file():
            return resolved
    return None


def read_skill_file(slug: str) -> dict | None:
    """One skill's content, read straight from disk. None if the slug has no file.

    Never source the body from SKILL_INDEX for editing: it is already capped at
    MAX_SKILL_CHARS, so a round-trip through the index would silently drop the
    tail of an oversized file.

    A file whose frontmatter doesn't parse still comes back — the whole raw text
    lands in `body` with `error` set, so the admin can repair it in the editor
    rather than over a remote shell.
    """
    path = skill_file_for(slug)
    if path is None:
        return None
    raw = path.read_text(encoding="utf-8")
    common = {"slug": _validate_slug(slug), "path": _relative_path(path)}
    try:
        meta, body = _split_frontmatter(raw)
    except ValueError as exc:
        return {**common, "name": "", "description": "", "enabled": True, "body": raw, "error": str(exc)}
    return {
        **common,
        "name": str(meta.get("name") or "").strip(),
        "description": str(meta.get("description") or "").strip(),
        "enabled": bool(meta.get("enabled", True)),
        "body": body,
        "error": None,
    }


def _validate_fields(name: str, description: str, body: str) -> tuple[str, str, str]:
    name = (name or "").strip()
    description = " ".join((description or "").split())  # frontmatter descriptions are one line
    body = (body or "").strip()
    if not name:
        raise ValueError("name is required")
    if len(name) > MAX_NAME_LEN:
        raise ValueError(f"name must be {MAX_NAME_LEN} characters or fewer")
    if not description:
        raise ValueError("description is required")
    if len(description) > MAX_DESCRIPTION_LEN:
        raise ValueError(f"description must be {MAX_DESCRIPTION_LEN} characters or fewer")
    if not body:
        raise ValueError("body is required")
    if len(body) > MAX_SKILL_CHARS:
        raise ValueError(f"body must be {MAX_SKILL_CHARS} characters or fewer")
    return name, description, body


def _compose(name: str, description: str, body: str, enabled: bool) -> str:
    """Render a SKILL.md. safe_dump handles a description containing ':' or quotes."""
    meta = {"name": name, "description": description}
    # Only write the flag when it's off: an absent key already means enabled, and
    # hand-authored files shouldn't grow noise.
    if not enabled:
        meta["enabled"] = False
    front = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=10**6)
    return f"---\n{front}---\n\n{body}\n"


def create_skill(name: str, description: str, body: str, enabled: bool = True) -> str:
    """Write a new `skills/<slug>/SKILL.md`. Returns the slug."""
    name, description, body = _validate_fields(name, description, body)
    slug = slugify(name)
    if not slug:
        raise ValueError("name must contain at least one letter or digit")
    slug = _validate_slug(slug)
    if skill_file_for(slug) is not None:
        raise SkillExists(f"a skill file already exists at '{slug}'")
    if name in SKILL_INDEX:
        raise SkillExists(f"a skill named '{name}' already exists")
    path = _contained(SKILLS_DIR / slug / "SKILL.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_compose(name, description, body, enabled), encoding="utf-8")
    logger.info("skill created: %s", slug)
    return slug


def update_skill(slug: str, name: str, description: str, body: str, enabled: bool = True) -> str:
    """Rewrite a skill file. Returns the (possibly renamed) slug."""
    path = skill_file_for(slug)
    if path is None:
        raise FileNotFoundError(slug)
    slug = _validate_slug(slug)
    name, description, body = _validate_fields(name, description, body)

    # The frontmatter name is what the model calls; it must not collide with a
    # *different* file's name.
    clash = SKILL_INDEX.get(name)
    if clash is not None and clash.slug != slug:
        raise SkillExists(f"a skill named '{name}' already exists ({clash.path})")

    new_slug = slugify(name)
    if not new_slug:
        raise ValueError("name must contain at least one letter or digit")
    if new_slug != slug and path.name.lower() == "skill.md":
        # Keep the folder aligned with the name. A flat `<slug>.md` is left where
        # it is — the loader keys off frontmatter, not the filename.
        target = _contained(SKILLS_DIR / new_slug)
        if target.exists():
            raise SkillExists(f"a skill file already exists at '{new_slug}'")
        path.parent.rename(target)
        path, slug = target / "SKILL.md", new_slug

    path.write_text(_compose(name, description, body, enabled), encoding="utf-8")
    logger.info("skill updated: %s", slug)
    return slug


def set_skill_enabled(slug: str, enabled: bool) -> str:
    """Flip the frontmatter flag, leaving the body untouched (and the folder alone)."""
    current = read_skill_file(slug)
    if current is None:
        raise FileNotFoundError(slug)
    if current["error"]:
        raise ValueError(f"this skill's frontmatter doesn't parse: {current['error']}")
    path = skill_file_for(slug)
    path.write_text(
        _compose(current["name"], current["description"], current["body"], enabled),
        encoding="utf-8",
    )
    logger.info("skill %s: enabled=%s", slug, enabled)
    return _validate_slug(slug)


def delete_skill(slug: str) -> str:
    """Remove a skill's file — the whole folder for the `<slug>/SKILL.md` layout."""
    path = skill_file_for(slug)
    if path is None:
        raise FileNotFoundError(slug)
    slug = _validate_slug(slug)
    if path.name.lower() == "skill.md":
        folder = _contained(path.parent)
        if folder == SKILLS_DIR.resolve():  # belt and braces: never rmtree skills/ itself
            raise ValueError("refusing to delete the skills directory")
        shutil.rmtree(folder)  # the folder may hold reference assets alongside SKILL.md
    else:
        path.unlink()
    logger.info("skill deleted: %s", slug)
    return slug
