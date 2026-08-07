# Skills

A **skill** is procedural knowledge for tBai written in plain markdown — no Python,
no restart. Drop a file in here, hit **Reload** in the admin panel, and the assistant
can use it.

You can also write one without touching the filesystem: the Skills card in the admin
panel creates, edits, enables/disables and deletes these same files. Note that
`backend/skills/` is tracked in git, so anything authored there shows up in
`git status` like any other edit.

## Layout

```
backend/skills/
  meal-planning/
    SKILL.md          ← the usual layout: one folder per skill
  quick-note.md       ← also fine for a one-off skill
```

`README.md` (this file) is ignored.

## Format

Each file is YAML frontmatter followed by a markdown body:

```markdown
---
name: meal-planning
description: Plan a week of family dinners and turn them into a shopping list.
---

## Instructions

1. Do this first.
2. Then this.
```

| Key | Required | Notes |
|-----|----------|-------|
| `name` | yes | Exactly what the model passes to `load_skill`. Keep it short and kebab-case. Must be unique. |
| `description` | yes | One line. This is the **only** part loaded on every request, so it has to be enough for the model to decide "is this the skill for this request?" — capped at 200 chars. |
| `enabled` | no | Defaults to `true`. Set `enabled: false` to keep the file around while hiding the skill from the model entirely — it stays listed in the admin panel, but never reaches the system prompt and `load_skill` refuses it. This is what the panel's Disable button writes. |

The body is capped at 8000 characters (`MAX_SKILL_CHARS` in `backend/skills.py`); anything
past that is cut off, and the admin panel flags the skill as truncated.

A skill's **slug** — its folder name, or its filename without `.md` — is separate from the
frontmatter `name`. The slug is how the admin panel addresses the file (so it can still
reach one whose frontmatter doesn't parse); the `name` is what the model calls. Renaming a
skill in the panel renames its folder to match.

## How it's loaded

Only the `name: description` line of each skill goes into the system prompt. When a
request matches, the model calls the `load_skill` tool and the full body comes back as
a tool result. This keeps a dozen skills affordable on a local model with a small
context window.

That also means the description does all the routing work. Write it as *when to use
this*, not *what this is*:

- ✅ `Plan a week of family dinners and turn them into a shopping list.`
- ❌ `Meal planning skill.`

## Writing the body

The body is read by a **local** model (gemma4 and friends), not a frontier one. So:

- Number the steps. Short imperative sentences.
- Name the tools to use explicitly — e.g. "call `add_to_list` with `list_name: Groceries`" —
  rather than describing the goal and hoping it picks the right tool.
- Say what to ask the user and when to stop and wait for an answer.
- Skip preamble, motivation, and background theory. It all costs context.

## Troubleshooting

Bad files don't crash anything — they show up under **load errors** in the admin panel
with the reason. The usual causes are a missing closing `---`, a missing `name`/`description`,
or a tab character in the YAML (YAML forbids tabs for indentation).

A broken file is repairable from the panel: its row gets a **Fix** button, which opens the
editor with the whole raw file in the body field so you can rewrite the frontmatter.
