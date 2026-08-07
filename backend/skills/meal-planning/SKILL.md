---
name: meal-planning
description: Plan a week of family dinners and turn the plan into a shopping list.
---

## Instructions

Follow these steps in order. Do not skip ahead.

### 1. Check what's already known

Call `show_list` with `list_name: "Meal Plan"` to see whether a plan already exists.
If one does, ask whether to replace it or fill in the gaps before continuing.

Use anything you already remember about the family's food preferences, allergies, and
dislikes. Do not ask about a preference you already know.

### 2. Ask before planning

Ask in **one** message, then wait for the answer:

- How many dinners are needed, and for which nights?
- Anything to avoid this week, or anything they specifically want?
- Any night that needs to be quick (under 30 minutes)?

If they've already told you all of this, skip the question and say what you're assuming.

### 3. Propose the plan

Write one line per night: the night, the dish, and a rough prep time.

- Vary the protein and the cuisine — do not put chicken on four nights.
- Repeat a recipe only if they asked for leftovers.
- Respect every allergy without exception. If you are unsure whether a dish is safe,
  pick a different dish rather than adding a caveat.

Show the plan and ask for a yes/no before saving anything.

### 4. Save the plan

Once they approve, call `add_to_list`:

- `list_name: "Meal Plan"`, `items`: one entry per night, formatted `"Monday: Dish name"`.

### 5. Build the shopping list

Call `add_to_list` with `list_name: "Shopping"` and the ingredients for the whole week.

- Combine the same ingredient across recipes into one entry with a total quantity —
  `"Onions x4"`, not four separate lines.
- Leave out staples most kitchens already have (salt, pepper, oil, common dried spices),
  unless a recipe needs an unusual amount.
- Group nothing and sort nothing; the list UI handles that.

### 6. Wrap up

Confirm in one short paragraph: the number of dinners planned and the number of items
added to the shopping list. Do not re-print either list in full — the user can open them.

If they ask for a change afterwards, use `check_off_item` to remove the outdated entry
before adding the replacement.
