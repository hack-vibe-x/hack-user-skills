---
name: session-playbook
description: Lists recent work sessions, analyses the ones the person picks, specifies what work they were, pulls out underlying working know-how and candidates worth turning into skills, and saves it as a Markdown file with a prompt ready to paste. Use for requests such as "pull know-how out of my sessions", "turn my recent work into a prompt", "which of these tasks would make a good skill", "session playbook", "세션에서 노하우 뽑아줘", "최근 작업 정리해서 프롬프트로 만들어줘", "이 작업들 스킬로 만들 만한 거 추천해줘". For a daily look back with feedback, use hack-user-skills-session-coach:session-diary.
license: Apache-2.0
---

# session-playbook: know-how and prompts from sessions

Reads past work sessions and turns them into a prompt and skill candidates for the next time the same kind of work is handed over. It reads Claude Code sessions (not Codex records yet).

Below, `<skill>` is the absolute path of this skill folder. Result files are saved in `~/.hus-session-coach/session-playbook/`. They hold conversation text, so they do not go into public repositories.

Script output is in English. Show it to the person in the language they use with you, and write the result file in that language too.

## Steps
1. **Show the list.**
   ```bash
   python3 <skill>/scripts/sessions.py list
   ```
   Show the list as it is (translate only the labels) and ask which numbers to analyse (several allowed). For older sessions add `--days 30 --limit 30`. The script leaves out this conversation, runs launched by a program, and runs in temporary folders.

2. **Read the picked sessions.**
   ```bash
   python3 <skill>/scripts/sessions.py show 2 4 7
   ```
   Each session comes with its title, the tools used, the files changed, and the shortened conversation. Long sessions are shortened in the middle as `...(N turns cut)...`. If the conclusion seems to be in that cut, extract again with `--budget 30000`.

3. **Analyse and write.** Follow the structure and rules in `references/format.md`. Three things matter most.
   - Task spec: what each session was, and the common kind of task.
   - Know-how: judgement and tricks only someone who has done it knows. Write conditional judgements with the criterion behind the choice. Take them from the person correcting the AI, decisions reversed, and requests repeated; do not write know-how without an evidence quote. For each, say where it goes in a skill (trigger phrases, steps, rule, done check, ask the person).
   - Skill candidates: only work that has a procedure, a clear instruction, and repeated. Fill in trigger phrases, the done criterion, and judgement left to the person from the sessions. Then the prompt to paste.

4. **Save and report.** Save to `~/.hus-session-coach/session-playbook/<today's date>-<topic>.md`. If that name exists, do not overwrite; add `-2`. Briefly tell the file location, the number of know-how items, and the skill candidate names, and say in one line where to use the prompt block.

## Do not
- Read or analyse sessions the person did not pick.
- Write unfounded generalities as know-how. Keep what the sessions confirm apart from guesses.
- Move the result into skill files, memory files or repositories. Do it only when the person asks.
- Copy keys and secrets from the conversation into the file. The script masks only known patterns, so look once more before writing.
