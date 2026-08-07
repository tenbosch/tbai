# ten Bosch Family Design System

A personal brand + component kit for apps built **for the ten Bosch family** — a
calendar, a chore tracker, a family hub, whatever comes next. There is no
company behind this; the "brand" is the family itself, and its visual language
comes straight from the family home.

**Source material:** a photo of the family home (kept locally, not published in
this repo). The palette is drawn from it: warm brick, off-white millwork,
forest-green accents, and dark wood, with an arch motif taken from the
entryway. No existing logo, codebase, or Figma file was provided; everything
here is built from scratch to match that photo and the family's direction
(name style: "ten Bosch Family"; vibe: modern layout with warm materials/colors).

This is a from-scratch design system — there is no external codebase or Figma
file to reconcile against. If one ever exists (a family app repo, a shared
Figma), point future runs at it and this file should be reconciled against it.

---

## Index

- `styles.css` — root stylesheet, import this one file.
- `tokens/colors.css` — off-white / brown / green ramps + semantic aliases
- `tokens/typography.css` — Lora + Public Sans + IBM Plex Mono, type scale
- `tokens/spacing.css` — spacing scale, radii (incl. the arch motif), shadows, motion
- `guidelines/` — 14 foundation specimen cards (Design System tab → Colors, Type, Spacing, Brand groups)
- `components/` — 13 primitives, each `<Name>.jsx` + `<Name>.d.ts` + `<Name>.prompt.md`
  - `forms/` — Button, Input, Select, Checkbox, Radio, Switch
  - `feedback/` — Badge, Tag, Toast, Tooltip
  - `containers/` — Card, Dialog, Tabs
- `ui_kits/family-hub/` — Family Hub app: Today / Calendar / Chores / Announcements, interactive
- `SKILL.md` — portable skill file for use in Claude Code (skill name `ten-bosch-family-design`)

---

## Content fundamentals

**Voice:** warm, plain, unhurried — the way you'd leave a note on the kitchen
counter, not a corporate product. Short sentences. Contractions always
("you're up", not "you are scheduled").

**Person:** direct address, "you"/"your" for the reader; "we" for the whole
family acting together ("we're out of milk", "Family dinner, we're all home").
Never "the user."

**Casing:** sentence case everywhere — headings, buttons, nav labels. No
ALL CAPS except tiny eyebrow labels (e.g. section tags at `--text-2xs` with
`--tracking-wider`), and even those are used sparingly.

**Tone examples:**
- Button: "Add to calendar" — not "Submit" or "Create New Event"
- Empty state: "Nothing on the calendar today. Enjoy it." — not "No events found"
- Chore reminder: "Trash goes out tonight — that's you, Sam" — not "Task due: Trash (Assigned: Sam)"
- Error: "Couldn't save that — try again?" — not "An error has occurred"

**Emoji:** not used in UI chrome or labels. Personality comes from warmth in
the writing itself, not decoration. A family photo or a hand-picked icon does
the job an emoji would.

**Vibe:** unfussy and a little old-fashioned in the best way — a house you
grew up visiting, not a startup dashboard. Confident, calm, never urgent or
gamified (no streaks, no confetti, no red badge anxiety-bait).

---

## Visual foundations

**Color:** pulled directly from the house — warm off-white trim (`--paper-*`)
as the dominant background field, brick brown (`--brown-*`) as the grounding
neutral-warm tone for text, wood, and secondary accents, and forest/shutter
green (`--green-*`) as the one true brand color, used for primary actions and
emphasis. Utility hues (rust for danger, amber for warning, muted slate for
info) stay firmly warm-tinted — never a cold saturated red or blue. See the
Colors group in the Design System tab for full ramps + semantic pairings.

**Type:** `Lora` (serif) for display/headlines — it has the same warm,
slightly traditional character as the house's arched millwork — paired with
`Public Sans` for all UI and body copy, which stays out of the way and reads
cleanly at small sizes. `IBM Plex Mono` appears only for dates/timestamps/
numeric labels where tabular alignment matters. No font files were supplied,
so all three are loaded from Google Fonts in `tokens/typography.css`; swap in
real files there if the family ever commissions custom type.

**Spacing:** 4px base scale (`--space-1` … `--space-9`, 4px→96px). Generous
padding inside cards and touch targets (min 44px) — this system is used by
kids and grandparents alike, so nothing is cramped or fussy-small.

**Backgrounds:** flat warm off-white (`--color-bg`) as the default field —
no gradients, no repeating patterns, no textures. The one full-bleed image
used across the system is the house photo itself, reserved for hero/header
moments (sign-in screen, app header) — never tiled or used as a pattern.
No hand-drawn illustration style is defined; if illustration is ever needed,
commission it rather than generating it, and add it here.

**Animation:** gentle and utilitarian — a settling motion, like a door
closing quietly, never a bounce or spring. Standard easing
`cubic-bezier(0.4,0,0.2,1)` (`--ease-standard`) for state changes,
`cubic-bezier(0.16,1,0.3,1)` (`--ease-out`) for things entering the screen.
Durations are short: 120ms for micro-interactions, 200ms for standard
transitions, 360ms for larger sheet/dialog motion. No looping/decorative
animation anywhere.

**Hover states:** a one-step darken toward `--color-primary-hover` /
`--color-accent-hover` on filled elements; on ghost/text buttons, a soft
background wash using the `-soft` token of that color. No underlines
appearing on hover for nav — underline is reserved for inline text links.

**Press/active states:** a further one-step darken (`--color-primary-active`)
plus a very subtle scale-down (0.98) on buttons — not a shrink you'd notice,
just enough to feel physical.

**Borders:** thin (1px), always `--color-border` (a warm parchment tone) or
`--color-border-strong` for emphasis — never pure black or grey. Never a
colored left-border-only "accent stripe" card treatment.

**Shadows:** soft and warm-tinted (brown, not black — `--shadow-color: 34,23,18`).
Cards default to `--shadow-sm`; modals/popovers use `--shadow-lg`. No inner
glow or neon-style shadows.

**Corner radius:** restrained — `--radius-md` (10px) is the default for
buttons/inputs/small cards, `--radius-lg` (16px) for larger cards, and a
special `--radius-arch` (64px) reserved for the *top* corners only of hero/
feature cards — a direct nod to the house's arched window. This arch motif
is the system's one distinctive shape; use it sparingly, on one hero element
per screen at most.

**Layout rules:** headers are calm and static — no floating/blurred glass
nav. No blur or translucency is used anywhere in the system; every surface
is a flat opaque tone. Content is centered in a comfortable max-width
column (family apps are read on phones and kitchen tablets, not ultrawide
monitors).

**Imagery color vibe:** warm, daylight, true-to-life — the house photo sets
the tone (natural light, warm brick tones, green foliage). No black-and-white
treatments, no heavy grain/filter, no cool color grading.

**Cards:** white or `--color-surface-warm` fill, 1px `--color-border`,
`--radius-lg`, `--shadow-sm`. No colored left-border accent stripe (an
overused pattern this system deliberately avoids).

---

## Iconography

No icon set was provided with the source material, so this system uses
**[Lucide](https://lucide.dev)** (line icons, 1.5–2px stroke, no fill) loaded
from CDN — chosen for its plain, unbranded line weight that sits quietly next
to the serif/sans type pairing without competing with it. Load via:

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<i data-lucide="calendar"></i>
<script>lucide.createIcons()</script>
```

- No emoji are used as icons anywhere in the system (see Content Fundamentals).
- No unicode symbol substitutions — always a real Lucide glyph.
- Stroke width standardized to 1.75px; icons are sized in 4px steps (16 / 20 /
  24 / 32px) matching the spacing scale.
- Icon color always inherits `currentColor` — never hard-coded.

## Intentional additions

No existing component library or Figma file was supplied, so this system
authors a standard from-scratch component set sized to a small family-app
surface area: **Button, Input, Select, Checkbox, Radio, Switch, Card, Badge,
Tag, Tabs, Dialog, Toast, Tooltip.** None of these are "inventions" beyond
that baseline — every one is a common primitive any of the planned family
apps (calendar, chores, hub) will need.

## Caveats

- No logo/wordmark was provided or created — every place a mark would go
  uses the plain wordmark "ten Bosch Family" set in `--font-display`. If the
  family wants an actual mark (monogram, house silhouette, etc.), that's a
  natural next step.
- Colors were judged by eye from the single house photo (automated pixel
  sampling on this photo returned inconsistent/desaturated readings, likely a
  color-profile quirk in the source file) — worth a real-world check against
  paint chips/siding samples if precision matters.
- Fonts are Google Fonts picks (Lora / Public Sans / IBM Plex Mono), not
  family-supplied files — swap freely if there's a preference.
