---
name: criteria
description: A record of the judgement criteria the user agreed on when handing work to an AI (how to pick sources, what good content is, and so on). Records, looks up, and changes them. Use when the user says "show my criteria", "list criteria", "change this criterion", "save this criterion", "criteria", "saved criteria", "기준 보여줘", "기준 목록", "기준 바꿔줘", "이 기준 저장해", "저장된 기준", or when another skill needs to look up or save criteria.
license: Apache-2.0
---

# criteria: the criteria record

Keep the criteria the user confirmed in files, so the same question is not asked twice and answers follow them.
The storage format is in `references/format.md`. Read it first.

Criteria are the user's content. Write them in the language the user speaks, in their own words. Do not translate them.

## What it does
- **List**: read `INDEX.md` and show the criteria by area, with their status (confirmed, draft, superseded, retired). Mark the confirmed ones that are AI-inferred or past their review date as needing a recheck.
- **Check**: when the user asks to check the record, or `INDEX.md` looks out of date, run `scripts/criteria_index.py check` and report what it found.
- **Show**: show one criterion file. If it replaced older versions, link those too.
- **Add**: write down the criterion as the user said it. Source is `user`.
- **Change**: never overwrite a file. Make a new version file, link it with `supersedes`, and set the old file to `superseded`.
- **Confirm**: when the user approves a draft, set `confirmed` and `confirmed_at`.
- **Retire**: set the status to `retired`. Do not delete the file.

## Rules
- **Only criteria the user confirmed become `confirmed`.** If the AI added anything, ask "Is this your criterion?" before saving (check 2 below). Use `draft` only when the user says "save it, but don't confirm it yet".
- Keep the user's wording as much as possible. Do not change the meaning by summarising.
- Every time a file changes, rebuild `INDEX.md` and check the folder with `scripts/criteria_index.py` (see `references/format.md`). Do not edit `INDEX.md` by hand. If `check` finds an error, fix it before reporting; if it warns that a confirmed criterion is AI-inferred or past its review date, tell the user and offer to recheck it.
- If a `confirmed` criterion already exists for the same area and decision and the user asks to add a new one, ask whether to treat it as a change.

## Checks before saving (every save, always)
Right before writing a criterion to a file, whichever path led there (add, change, confirm), go through these in order. If any fails, do not save: fix it or take it back to the user.

1. **Does it answer the question?** Does the wording actually answer the question just asked (area, decision)? If it answers a different decision, save only that part and say plainly what is still empty. Example: the role of sources is decided, but "which writing counts as fact" is still empty.
2. **Whose words are these?** Split each part of the wording into what the user said and what the AI added. If the AI added any part, or proposed it after the user said "I don't know", **do not save; ask the user first.** Point at the exact part the AI added. Example: "'Reviews are secondary sources' is something I added. Is that your criterion, or how should I change it?" Do not ask "May I save this?". If the user says that part is theirs, or rewrites it, treat the answer as the user's words and save it as `co-created`. If the user answers about something else, they have not answered yet.
3. **Is every condition the user gave in it?** Check the conversation again for exclusions, limits, and numbers the user said directly (e.g. "no ads"), and make sure none were dropped.
4. **Can it be judged later?** Can someone tell whether a result met this criterion? Make words like "balanced" or "enough" concrete with numbers, conditions, or examples, or ask the user.
5. **Is it one decision?** If different decisions are mixed in one wording, split them and save them separately.
6. **Is confirming asked separately?** To make it `confirmed`, ask on its own (not in the same message as the question in check 2): "Once confirmed, I will follow this criterion without asking next time. Confirm it?" Get an explicit yes. Do not bundle it with permission to save.

After saving, report in one line: what was saved, its status (confirmed or draft), and what is still empty.

## Where it is stored
- Project: `.hus-criteria-gap/` in the working folder (default)
- Global: `~/.hus-criteria-gap/` (personal preferences shared by many projects)
- When the same area and decision is in both, the project wins.
- If the user did not say where, save in the default and say in one line where it went.
