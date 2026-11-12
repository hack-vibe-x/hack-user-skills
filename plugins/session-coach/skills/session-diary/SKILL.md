---
name: session-diary
description: When turned on, writes a diary every midnight from the previous day's AI session records (Claude Code, Codex). It gives feedback with quoted evidence on how the person worked, what they got done and how well they used AI, gives one plan for tomorrow, and compares with earlier diaries to build self-awareness and skill. Days missed while the computer was off are written when it is back; days without conversations are recorded as such. Use for requests such as "turn on the session diary", "turn off the diary", "diary status", "show me yesterday's diary", "rewrite the diary", "세션 일기 켜줘", "일기 꺼줘", "일기 상태", "어제 일기 보여줘", "일기 다시 써줘".
license: Apache-2.0
---

# session-diary: automatic session diary

The person does not call this to write each diary. Once turned on, a script writes it by itself. This skill only turns it on and off, shows the status, and reads written diaries to the person. The rules for writing a diary are in `references/write.md`, what to observe and the sources in `references/observe.md`, and the record formats in `references/claude.md` and `references/codex.md`.

Below, `<skill>` is the absolute path of this skill folder. Diaries are in `~/.hus-session-coach/session-diary/<date>.md`. For now the automatic run can be turned on only on macOS. The text is written with `claude -p` logged in on this computer, so the `claude` command is needed. It works the same whichever tool calls this skill (Claude Code or Codex).

Script output is in English; tell the person what it says in the language they use with you. The diaries themselves are written in the language set with `--lang`, or, without it, in the language of that day's sessions.

## Turning it on
Tell the person these points once and get a yes before turning it on. Never turn it on unasked.
- It wakes on the hour and at login and writes any diary missing up to yesterday. After midnight, the day before is written.
- It reads the conversations of every project on this computer and sends them to the AI (Anthropic, through `claude -p`), Codex conversations included. Every day with conversations uses AI usage.
- It writes from the day it is turned on. Earlier dates are not written.
- Each diary is one `claude -p` call (two when quotes need fixing), each capped at $3, using the `claude` login on this computer; an API key in the shell is not passed to the scheduled run.
- It follows the plugin: after an update it uses the new version by itself, and once the plugin is removed it stops by itself within about two hours (it writes nothing in between). Turning it off first stops it at once.

```bash
python3 <skill>/scripts/diary_auto.py on --lang <code>
```
Set `--lang` to the language the person is speaking to you (`en`, `ko`), unless they ask for another. Pass on the result. If it says it could not turn it on after several tries, it is off: tell the person to try again in a minute, or to log out and back in first if it keeps failing.

If the result says the older diary from hack-users-for-llms is still on, it did not turn on. Show the person the command it prints, and turn it on again only after they have turned the old one off.

After turning it on, ask: "Shall I write today's diary as of now? If I write it now, today's diary ends here." If yes, do "Writing now" below; if no, tell them it will be written for the whole day at midnight.

## Turning it off
```bash
python3 <skill>/scripts/diary_auto.py off
```
Only the automatic run stops. Written diaries are not deleted.

## Status
```bash
python3 <skill>/scripts/diary_auto.py status
```
Pass on whether it is on, missing dates, dates that could not be written, and the recent log. If it says the plugin folder is gone, tell the person the diary is paused and turns itself off unless the plugin comes back.

## Updating the automatic run
The automatic run uses a copy of these scripts. It refreshes the copy by itself at the next hour, and in Claude Code a new session refreshes it right away. When the person asks for it now, or the status shows an old version:
```bash
python3 <skill>/scripts/diary_auto.py sync
```

## Moving from hack-users-for-llms
When the person used the older diary or playbook from hack-users-for-llms, offer to copy them over so new diaries compare with the old ones. First show what would be copied:
```bash
python3 <skill>/scripts/diary_auto.py migrate --dry-run
```
Tell the person the list, that nothing is overwritten or deleted, and that the old judge logs in `~/.hack-mode` are not copied. After a yes, run it without `--dry-run`. If it says the old diary is still on, show the command it prints and run it again only after the person has turned the old one off.

## Reading a diary to the person
Read that date's diary file and briefly tell today-in-one-line, the behaviour to change, and tomorrow's plan, and say where the file is. Do not paste the whole diary into the conversation. Tell them that what they write in the "My notes" section at the end is read and answered by the next diary. In Claude Code, the plan of the latest diary also shows above the prompt at the start of the next session, once.

## Writing now, rewriting
Today's diary is written from the conversations between midnight and now. A day with a diary file is skipped by the midnight run, so writing now ends today's diary here. Tell the person that conversations after this point go into no diary. If today has no conversations yet, nothing is written (exit code 3) and the day is still written at midnight.
```bash
python3 <skill>/scripts/diary_auto.py write
```
If they want to rewrite a day that already has a diary, tell them the earlier diary is thrown away and their "My notes" go with it, get a yes, then run it. Written at 3 pm and rewritten at 10 pm, it covers midnight to 10 pm and the earlier diary is removed. If it cannot be written, the earlier diary stays. For a past date add `--date <date>`. A diary that says it could not be written has no notes to lose: rewrite it with `--date <date> --force` without the warning. Asked for a date that has no diary file, say so and offer to write it; a diary that says "no conversations" is the record of that day, not a missing one.
```bash
python3 <skill>/scripts/diary_auto.py write --force
```

## Do not
- Turn it on or off unasked.
- Move diary content into public repositories, memory files or settings files. Do it only when the person asks.
