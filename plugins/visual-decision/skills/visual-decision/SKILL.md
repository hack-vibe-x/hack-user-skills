---
name: visual-decision
description: Asks the user a question in a local web page instead of terminal text. Every option has a visual and rows that show how the options differ; the person answers and Claude continues with the answers. Use when there is something for the user to choose (screen designs, copy, structure, approvals before hard-to-undo actions, scope, numbers), when the user says "ask me in the web UI", "open a decision page", "웹으로 물어봐", "결정 화면 띄워줘", or when the hook blocks AskUserQuestion and points here. Also when the user wants web questions off (or back on) in this project ("turn off web questions here", "이 프로젝트에서는 웹으로 묻지 마").
license: Apache-2.0
---

# Ask in a web page

Do not ask a choice as terminal text. Open a local web page: the person sees one question at a time, compares options by their pictures, and submits all answers at once.

If no page can be opened on this computer (`claude -p`, a remote or SSH session), or the question only checks what the person meant, ask in plain text instead. If `node` is not found (or is older than 18), Node.js 18 or later is missing: say so, and offer to install it (`brew install node`, only when Homebrew is there; never `sudo`), to send the user the command (or https://nodejs.org), or to go on without the page.

## Rules for the questions

1. **A visual on every option.** Screen design: a mock. Structure or flow: a diagram. Copy: the text where it will appear.
2. **Short.** One-line question, one-sentence context. Longer background goes in `more`.
3. **Differences visible.** Compare options on the same 2–4 rows (`dims`), with `good` / `bad` marks. What is the same for all goes in one `same` line.
4. **2–4 options.** Mark the one you recommend `rec: true`.
5. **One batch.** Put the decisions you will need soon in one file, not only the one that blocks you now.
6. **Do not ask again what was decided.** Earlier answers are kept in `.hus-visual-decision/decisions/` at the project root. Look there first and follow them unless the user wants to change one.

Write in the user's language and set `"lang"` (`"en"`, `"ko"`).

## Steps

1. **Write the question file** in a temp folder, e.g. `/tmp/hus-visual-decision/<short-name>.json`. Follow [references/schema.md](references/schema.md).
   - Approval before a hard-to-undo action (deploy, delete, sending outside, pushing to a shared branch): add `"noDelegate": true` and `"ownAnswer": false` to that decision.
2. **Check it** (foreground, exits at once; 0 = valid, 2 = lists what to fix):

   ```bash
   node <this skill's folder>/scripts/serve.mjs <file> --check
   ```

3. **Open it** in the background (the person may take a while):

   ```bash
   node <this skill's folder>/scripts/serve.mjs <file>
   ```

   Tell the user in one line that the page is open, with the address from the first stderr line (`Decision page: http://127.0.0.1:…`). Work on what does not depend on the answers; do not guess them.
4. **Read the result** when the script exits:

   | Exit | What to do |
   |---|---|
   | 0 | `Decisions are done. Record: …` and one line per question id. Follow each answer (and its `additional comments`) |
   | 3 | The person cancelled. Stop the work that depends on it and say so in one line |
   | 4, 5 | Timed out or page closed. Say so and offer to open the same file again; the browser usually keeps the choices made so far |
   | 2, 1 | Fix the file (2) or report the error (1) |

   Lines after exit 0:
   - `"…"` / `[…]` / `{…}` / a number: the chosen answer.
   - `own answer (none of the options)`: the person typed what they want instead. Follow it.
   - `sent back (info)` / `sent back (options)`: find out more or write new options, then ask only that question again in a new file.
   - `sent back (delegate)`: go with the answer the line names (or choose yourself if it says there is none), and tell the user what you chose.

## Off in one project

If the user wants questions in the terminal again in this project, run `claude plugin disable hack-user-skills-visual-decision@hack-user-skills --scope local` there (`enable` with the same options turns it back on). It writes only this project's `.claude/settings.local.json`; other projects stay on. Tell the user it applies from the next session.

## Do not

- Call AskUserQuestion from inside this skill.
- Treat `delegate`, a cancel, a time-out or a closed page as approval for a hard-to-undo action.
