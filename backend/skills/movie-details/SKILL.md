---
name: movie-details
description: Use when the user asks about a movie or film by name — plot, cast, director, release date, runtime, genre, budget, box office, "tell me about <movie>", "who directed <movie>".
---

## Instructions

Follow these steps in order.

### 1. Look it up

Call `wikipedia_lookup` with:

- `title`: the movie name **with the word `film` appended** — e.g. `"Dune film"`, `"The Matrix film"`. Without it, a bare title often lands on the novel or the franchise instead of the movie.
- `year`: the year, if the user gave one (e.g. `"1984"`).

Do not use `web_search` for this. `wikipedia_lookup` returns the infobox, which is
the only place runtime, budget and box office actually appear.

### 2. Disambiguate if needed

The result starts with the article it found, then `Other Wikipedia articles matching
this search`. If that list shows another film of the same name (a remake, a sequel,
a different year) and the user gave no year:

- If one is clearly the obvious match, use it and say which one you picked.
- If it is genuinely ambiguous, list 2-3 candidates (title + year) and ask which one
  they mean. Stop and wait for their answer.

To switch to a different candidate, call `wikipedia_lookup` again with that exact
article title.

### 3. Read the fields

Take the facts from the `Infobox (raw fields)` block and the article text. The infobox
is raw wiki markup — `| director = David Lynch` means the director is David Lynch.
Ignore markup like `{{plainlist|`, `}}` and `*`.

Pull these when present. Skip any field that genuinely isn't there rather than writing
"N/A" everywhere:

- Title (and year)
- Director(s)
- Writer(s), if notably different from the director
- Starring / main cast (top 3-5 names)
- Genre
- Release date
- Runtime
- Country / language (if not obviously US/English)
- Budget
- Box office (the infobox calls this `gross`)
- One or two notable facts if something stands out (awards, notable trivia) — keep brief

### 4. Write the plot summary in your own words

3-5 sentences, no more. See the copyright note below.

### 5. Answer

Use this shape:

```
## [Title] ([Year])

**Director:** ...
**Starring:** ...
**Genre:** ...
**Release date:** ...
**Runtime:** ...
**Box office:** ... (if available)

**Plot:** [3-5 sentence original summary]

[Optional: 1-2 notable facts]
```

Keep it scannable — this is a facts lookup, not an essay. Don't add unrequested
commentary like your opinion of the film.

## Copyright note

Wikipedia text is copyrighted (CC BY-SA), so:

- Never quote more than ~15 words verbatim, and never more than one such short quote.
- Write the plot synopsis and any other prose entirely in your own words — don't mirror
  the article's sentence structure or phrasing.
- Facts (names, dates, numbers) are not copyrightable and can be listed freely.

## Edge cases

- **`wikipedia_lookup` says no article was found:** try once more without the word
  `film` in the title. If that also fails, fall back to `web_search`. If nothing turns
  up, say so plainly rather than guessing at details.
- **TV movie, documentary, or short film:** same workflow — just note the type if it
  isn't a standard theatrical feature.
- **User asks a narrower question** (e.g. "who directed Inception?"): still do the
  lookup, but answer just that question directly. Don't dump every field for a
  one-fact ask.
