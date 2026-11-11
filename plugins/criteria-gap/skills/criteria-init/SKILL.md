---
name: criteria-init
description: Turns the criteria check hook (before delegating) on or off and shows its status. The hook is off by default and runs only in the projects, or globally, where this skill turned it on. Use when the user says "criteria init", "turn on the criteria check", "turn the hook on", "turn the hook off", "criteria check status", "change the check intensity", "기준 점검 켜줘", "훅 켜줘", "훅 꺼줘", "기준 점검 상태", "점검 강도 바꿔줘". Saving and looking up criteria is the criteria skill; the gap-finding procedure is the criteria-gap skill.
license: Apache-2.0
---

# criteria-init: turning on the criteria check hook

When the user sends a request that hands over work (filter this, plan that), the hook looks up the criteria record. If confirmed criteria exist, it tells Claude about them; if not, it has Claude ask before the work.
**The hook ships in this plugin (`hack-user-skills-criteria-gap`) and is off by default.** This skill only flips the switch (the settings file). It never touches the user's `settings.json`.

## Before you start
- The hook runs **only when the plugin is installed in Claude Code**. In Codex, or when the skills were installed by linking a folder, the settings file is written but the hook does not run. Say so in that case.
- If the plugin was just installed or updated, a new session is needed before the hook applies. Changes to the settings file apply from the next request, with no restart.
- The hook needs `python3`. Without it the hook stays silent.

## Settings file
`<record folder>/config.json`. If the project has one (`.hus-criteria-gap/config.json`), it is used; otherwise the global one (`~/.hus-criteria-gap/config.json`). The project setting wins over the global one.

```json
{ "hook": { "enabled": true, "intensity": "light", "max_per_session": 3, "cooldown_turns": 3 } }
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Runs only when `true` |
| `intensity` | `light` | `light`: only for a delegating request that also has a signal (first delegation in the session, a decision that changes direction, long output). `active`: every delegating request |
| `max_per_session` | `3` | Most times per session the hook says criteria are missing and should be asked. Telling Claude about confirmed criteria does not count |
| `cooldown_turns` | `3` | How many requests to wait after that before saying it again |

## Turn on (init)
Ask one thing at a time.
1. **Scope**: this project only (default) or every project (global).
2. **Intensity**: `light` (default) or `active`. Explain each in one line.
3. Write the settings file. If it exists, read it and change only the `hook` key, keeping everything else. Create the record folder if it is missing.
4. If the project is a git repository, ask whether to add `.hus-criteria-gap/` to `.gitignore`. Personal criteria could end up in the repository. Do not change the file without consent.
5. Report: where and with which settings it is on, what the hook does (looks up the record only for delegating requests, at most N interventions per session), and how to turn it off.

## Turn off
Set `enabled` to `false` in the settings file. Do not delete the file. Because the project setting overrides the global one, this also works to keep it on globally and off in one project.

## Status
Read the project and global settings files and show the values that actually apply here (on or off, intensity, limits) and which file each came from. How many times it already stepped in this session cannot be known.

## What not to do
- Do not turn it on unless the user asked.
- Do not pick the intensity or scope without asking.
- Do not edit `settings.json` or hook settings directly.
