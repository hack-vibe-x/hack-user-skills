# Criteria record format

## Folder
```
.hus-criteria-gap/
  INDEX.md
  <id>.md
  config.json
```

The same layout is used in the project (`.hus-criteria-gap/`) and globally (`~/.hus-criteria-gap/`).
`config.json` holds the settings of the hook and the question card and is not a criterion (see `hack-user-skills-criteria-gap:criteria-init`). Leave it out of lookups.

## Criterion file `<id>.md`
`id` is `area-decision-number` in lowercase ASCII letters, digits, and hyphens. Example: `magazine-source-filter-1`.

```markdown
---
id: magazine-source-filter-1
area: magazine            # what the work is about
decision: source-filter   # which decision this criterion is for
status: confirmed         # confirmed | draft | superseded | retired
source: user              # user | co-created | ai-inferred
confirmed_at: 2026-10-20  # only when confirmed
review_after: 2027-01-20  # optional; without it, 90 days after confirmed_at
supersedes:               # id of the previous version, or empty
evidence: "one quoted line from the session"  # optional; which conversation it came from
---

The criterion, in the user's own words and language.
```

`area`, `decision`, and the body are user content: write them in the user's language. The hook matches `area` and `decision` against the user's prompt, so use the words the user uses for them.

## `INDEX.md`
One criterion per line. Before asking anything, read only this file to look up.

```markdown
- [magazine-source-filter-1](magazine-source-filter-1.md) · magazine/source-filter · confirmed · Primary sources from 2025 on only
```

## Lookup rules
1. Find a `confirmed` criterion with the same `area` and `decision`. Project first, then global.
2. If it is unclear, pick the closest one from the `INDEX.md` summaries; if you are not sure, show the candidates and ask.
3. Do not treat it as confirmed if any of these hold: `draft`, `ai-inferred`, `review_after` has passed (90 days after confirming when it is missing), or the area has changed.
4. `superseded` and `retired` are not looked up.
