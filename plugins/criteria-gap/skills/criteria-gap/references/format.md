# Criteria record format

## Folder
```
.hus-criteria-gap/
  INDEX.md
  <id>.md
  config.json
```

The same layout is used in the project (`.hus-criteria-gap/`) and globally (`~/.hus-criteria-gap/`).
`config.json` is not a criterion: it only turns the hook off (`{"hook": false}`, see the skill's "Off in one project"). Leave it out of lookups. The folder is created when the first criterion is saved.

## Criterion file `<id>.md`
`id` is `area-decision-number` in lowercase ASCII letters, digits, and hyphens. Example: `magazine-source-filter-1`.

```markdown
---
id: magazine-source-filter-1
area: magazine            # what the work is about
decision: source-filter   # which decision this criterion is for
keywords: sources, references  # optional; other words the user uses for this, comma-separated
status: confirmed         # confirmed | superseded | retired (draft: written before 0.6.0, treated as not confirmed)
source: user              # user | co-created | ai-inferred
confirmed_at: 2026-10-20  # only when confirmed
review_after: 2027-01-20  # optional; without it, 90 days after confirmed_at
supersedes:               # id of the previous version, or empty
evidence: "one quoted line from the session"  # optional; which conversation it came from
---

The criterion, in the user's own words and language.
```

`area`, `decision`, and the body are user content: write them in the user's language. The hook matches `area`, `decision` and each of `keywords` against the user's prompt (hyphens and underscores count as spaces), so use the words the user uses for them. When the user calls the same thing by several names, put the others in `keywords`.

## `INDEX.md`
One criterion per line: id and file, area/decision, status, source, the review date (`review_after`, else 90 days after `confirmed_at`; `-` for superseded and retired ones and when there is no date), and the first line of the criterion. Before asking anything, read only this file to look up.

```markdown
- [magazine-source-filter-1](magazine-source-filter-1.md) · magazine/source-filter · confirmed · user · review 2027-01-20 · Primary sources from 2025 on only
```

The criterion files are the source and `INDEX.md` is made from them; do not edit it by hand. After any criterion file changes, rebuild it, then check the folder:

```bash
python3 <skill>/scripts/criteria_index.py rebuild
python3 <skill>/scripts/criteria_index.py check
```

`<skill>` is the folder of the `criteria-gap` skill. Without `--dir`, both work on this project's `.hus-criteria-gap/` and `~/.hus-criteria-gap/`. `check` reports errors (a broken front matter, an id that does not match its file, a missing `confirmed_at`, a `supersedes` that names nothing, two confirmed criteria for one decision, an `INDEX.md` that differs from the files) and exits 1, and warnings (a confirmed criterion that is AI-inferred or past its review date, so it is not treated as confirmed). Fix the errors and take the warnings to the user. Without `python3`, write the lines by hand in the format above.

The hook reads the criterion files itself, not `INDEX.md`, with the lookup rules below.

## Lookup rules
1. Find a `confirmed` criterion with the same `area` and `decision`. Project first, then global.
2. If it is unclear, pick the closest one from the `INDEX.md` summaries; if you are not sure, show the candidates and ask.
3. Do not treat it as confirmed if any of these hold: `draft`, `ai-inferred`, `review_after` has passed (90 days after confirming when it is missing), or the area has changed.
4. `superseded` and `retired` are not looked up.
