---
name: criteria-gap
description: Handles the question card of this plugin. The card asks the user one question when they move on from Claude's answer without having read or understood it (a point they skipped, a premise they did not state or took differently, two things under one word, an understanding worth checking). Use when a message starts with "[hus-criteria-gap answer]", or when the user says "turn off the question card", "turn the question card back on", "ask fewer questions", "ask more often", "what do I often miss", "show my question log", "delete my question log", "did I understand that right", "the question card never shows up", "is the question card working", "질문 카드 꺼줘", "질문 카드 다시 켜줘", "질문 줄여줘", "더 자주 물어봐", "내가 자주 놓치는 것 정리해줘", "질문 기록 보여줘", "질문 기록 지워줘", "내가 제대로 이해했는지 봐줘", "질문 카드가 안 떠", "질문 카드 잘 돌아가는지 봐줘".
license: Apache-2.0
---

# Help the user fill the gap they moved on from

People move on from an answer without reading it closely, believe they understood when they did not, and miss a premise or a gap in the reasoning. The feeling of understanding is not a measure of it, and what is missing gives no signal. The question card catches one such gap at the moment the user moves on, and makes them fill it in their own words. Your part is to handle their answer, and the requests below.

Talk in the user's language.

## Card answers
A message that starts with `[hus-criteria-gap answer]` is the user's answer to the card. It holds what the question was about, the question, the options if any, the words it points at (the user's or your answer's), and the answer.
1. **Pin the current work in one line**, then handle the answer, then go back to that work.
2. **Compare it with what you assumed** in the work so far.
   - Different: say in one or two lines where it differs and what it changes, and ask whether to redo the affected part. Do not redo it without a yes.
   - The same: confirm in one line and carry on.
3. **"I don't know":**
   - About a premise or a skipped point: give 2–3 candidates, each with a short example from this work, and let them pick or rewrite one.
   - About understanding or a distinction: explain it in two or three sentences, tied to their own example. Do not lecture or grade.
4. Do not quiz them further in the chat; the card does the asking.

## Requests
Settings live in `.hus-criteria-gap/config.json` in the project (or `~/.hus-criteria-gap/config.json` for every project; the project file wins). Read the file, change only the key asked about, keep the rest. Changes apply from the next turn.
- **Turn off / on here:** `"card": false` / `"card": true`.
- **Ask fewer / more often:** `"pace"` one step down / up (from -2 to 3; 0 when missing). The card starts each block of 30 turns with 3 questions plus `pace`, and moves from there with the user's answers. Say the new level in one line.
- **What do I often miss:** read the log files in `~/.hus-criteria-gap/log/<project>/` (one Markdown file per day; `<project>` is this project's path with `/` and other symbols as `-`). Group the questions by kind, say which kind came up most and how often the answer showed a real gap ("Result" lines), and quote one or two telling entries. End with one concrete habit to try. Without a log, say there is none yet.
- **Show my question log:** list the recent entries as they are.
- **Delete my question log:** delete this project's folder under `~/.hus-criteria-gap/log/` (or every project's, if they say so) and say what was deleted.
- **Did I understand that right:** suggest `/criteria-check`, which checks the last turn now and shows a card if there is a gap.

## The card does not show up
The card is meant to be rare (3 questions per 30 turns), so first tell them that not seeing it is normal. To find out whether something is in the way, do the easy checks yourself, in this order, and say in one line what you found:
1. **Is `/criteria-check` a command here?** If the user types it and gets "unknown command", the plugin's module is not loaded: Claude Code is too old for it, or the plugin is not enabled. Tell them to run `claude update` (or update the VS Code extension / desktop app), check `/plugin` that hack-user-skills-criteria-gap is enabled, and open a new session. This is the one thing you cannot fix from here.
2. **Is the card off?** Read `.hus-criteria-gap/config.json` in the project, then `~/.hus-criteria-gap/config.json` (on Windows, the folder under `%USERPROFILE%`). `"card": false` means off; a file that is not valid JSON also turns it off. Offer to turn it on, or to fix the file keeping the user's other settings.
3. **Is the judge model reachable?** Have them run `/criteria-check`. "Could not run" twice means the session cannot use the Sonnet model (some Bedrock, Vertex or gateway setups): they need to allow Sonnet for this session or account. Do not change their provider settings yourself.
4. **Nothing in the way:** say the card only judges turns where there was a longer answer to read, and suggest `/criteria-check` to see it now.
Never edit anything but the config file, and ask first.

## Do not
- Ask the user whether they understood; ask them to choose or say it in their own words.
- Redo work after an answer without the user's yes.
- Treat "I don't know" or a skip as a failure, or mention it again.
