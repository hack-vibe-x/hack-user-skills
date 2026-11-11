---
name: criteria-init
description: Turns the criteria check hook (before delegating) and the criteria question card (a question about a gap in your thinking, shown above the prompt after a turn) on or off, and shows their status. Both are off by default and run only in the projects, or globally, where this skill turned them on. Use when the user says "criteria init", "turn on the criteria check", "turn the hook on", "turn the hook off", "turn on the question card", "turn off the question card", "criteria check status", "change the check intensity", "기준 점검 켜줘", "훅 켜줘", "훅 꺼줘", "질문 카드 켜줘", "질문 카드 꺼줘", "기준 점검 상태", "점검 강도 바꿔줘". Saving and looking up criteria is the criteria skill; the gap-finding procedure is the criteria-gap skill.
license: Apache-2.0
---

# criteria-init: turning on the criteria check hook and the question card

This plugin (`hack-user-skills-criteria-gap`) has two switches. Both are **off by default**, and this skill only flips them in the settings file. It never touches the user's `settings.json`.

- **The hook** (`hook.enabled`): when the user sends a request that hands over work (filter this, plan that), it looks up the criteria record. If confirmed criteria exist, it tells Claude about them; if not, it has Claude ask before the work.
- **The question card** (`card`): after a turn ends, a judge model looks at the user's message and Claude's answer for one gap in the user's thinking (an omitted premise, a mixed distinction, a principle worth checking, a missing criterion). When it finds one worth asking, it shows one question above the prompt, with options where they fit, a free answer, "don't know" and "skip". The answer is sent back to Claude as a message. `/criteria-check` checks the last turn right away. A question left unanswered goes away after 3 turns. It costs **one Sonnet call on each turn where it may ask** (not during the cooldown, not past the session cap); with the card off it calls no model and shows nothing.

The two are independent: either can be on without the other.

## Before you start
- Both run **only when the plugin is installed in Claude Code**. In Codex, or when the skills were installed by linking a folder, the settings file is written but nothing runs. Say so in that case.
- If the plugin was just installed or updated, a new session is needed before they apply. Changes to the settings file apply from the next request (the hook) or the next turn (the card), with no restart.
- The hook needs `python3`; without it the hook stays silent. The card does not need it.

## Settings file
`<record folder>/config.json`. If the project has one (`.hus-criteria-gap/config.json`), it is used; otherwise the global one (`~/.hus-criteria-gap/config.json`). The project file wins over the global one as a whole: a project file without `"card": true` keeps the card off there even when the global file turns it on.

```json
{ "card": true, "hook": { "enabled": true, "intensity": "light", "max_per_session": 3, "cooldown_turns": 3 } }
```

| Key | Default | Meaning |
|---|---|---|
| `card` | `false` | The question card runs only when `true` |
| `lang` | (none) | Optional. The language of the card's buttons and labels (`en`, `ko`). Without it, Korean when the user writes in Hangul, else English. The questions themselves are written in the user's language either way |
| `hook.enabled` | `false` | The hook runs only when `true` |
| `hook.intensity` | `light` | Hook: `light` only for a delegating request that also has a signal (first delegation in the session, a decision that changes direction, long output); `active` every delegating request. Card: `light` asks only when the next step would clearly go wrong without the answer; `active` asks whenever a gap clearly changes the result |
| `hook.max_per_session` | `3` | Hook: most times per session it says criteria are missing and should be asked (telling Claude about confirmed criteria does not count). Card: most question cards per session; `0` means it never asks on its own |
| `hook.cooldown_turns` | `3` | How many requests (hook) or turns (card) to wait after stepping in before doing it again |

The card reads its limits from the `hook` section too, so changing them changes both.

## Turn on (init)
Ask one thing at a time.
1. **What**: the hook, the question card, or both. If the user named one, do not ask.
2. **Scope**: this project only (default) or every project (global).
3. **Intensity**: `light` (default) or `active`. Explain each in one line. Skip if the file already has one and the user did not ask to change it.
4. Write the settings file. If it exists, read it and change only the keys asked for (`card`, the `hook` keys), keeping everything else. Create the record folder if it is missing.
5. If the project is a git repository, ask whether to add `.hus-criteria-gap/` to `.gitignore`. Personal criteria could end up in the repository. Do not change the file without consent.
6. Report: where and with which settings each is on, what it does (the hook: looks up the record only for delegating requests, at most N interventions per session; the card: at most N questions per session, one Sonnet call on turns where it may ask, `/criteria-check` to check now, a log of each judgement in `~/.hus-criteria-gap/judge-log/`), and how to turn it off.

## Turn off
Set `card` (the card) or `hook.enabled` (the hook) to `false` in the settings file. Do not delete the file. Because the project file overrides the global one, this also works to keep one on globally and off in one project.

## Status
Read the project and global settings files and show, for the hook and the card separately, the values that actually apply here (on or off, intensity, limits, `lang` if set) and which file they came from. How many times either already stepped in this session cannot be known.

## What not to do
- Do not turn either on unless the user asked.
- Do not pick the intensity or scope without asking.
- Do not edit `settings.json` or hook settings directly.
