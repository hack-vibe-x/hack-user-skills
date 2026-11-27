---
name: visual-decision
description: Asks the user a question in a local web page instead of terminal text. Every option has a visual and rows that show how the options differ; the person answers and Claude continues with the answers. Use when there is something for the user to choose (screen designs, copy, structure, approvals before hard-to-undo actions, scope, numbers), when the user says "ask me in the web UI", "open a decision page", "웹으로 물어봐", "결정 화면 띄워줘", or when the hook blocks AskUserQuestion and points here. Also when the user wants web questions off (or back on) in this project ("turn off web questions here", "이 프로젝트에서는 웹으로 묻지 마").
license: Apache-2.0
---

# Ask in a web page

Do not ask a choice as terminal text. Open a local web page: the person sees one question at a time, compares options by their pictures, and submits all answers at once.

If no page can be opened on this computer (`claude -p`, a remote or SSH session), or the question only checks what the person meant, ask in plain text instead. If `node` is not found (or is older than 18), Node.js 18 or later is missing: say so, and offer to install it (`brew install node`, only when Homebrew is there; never `sudo`), to send the user the command (or https://nodejs.org), or to go on without the page.

## Rules for the questions

1. **Three layers, plain first.** `plain`: two or three sentences a 14-year-old understands, on what this decision is. Each option's `gist`: its bottom line in one plain line. Then what is needed to choose (pictures, rows, `give`, `when`). Everything else goes in the folded layer (`more`, `flaw`, `after`, `example`, `detail`).
2. **Say what each answer will do.** Every option (and value stop) gets `means`: one or two plain sentences on what will happen. The page shows it under the person's choice; on decisions that are costly or impossible to undo it asks "Is this what you mean?" before they can move on.
3. **A visual on every option**, chosen by what differs: a screen (`screen`, `image`, `html` with `notes`), a change to something that exists (`diff`), when things happen (`timeline`), what else is touched (`impact`), what a person goes through (`story`), a chance (`odds`). See the table in the schema. Multi items can have one too.
4. **Rows are the person's questions.** 2–4 `dims`, written as questions they would ask ("Can I undo it?"), phrased the same way round for every option. Put numbers in `n` (and `lo`/`hi` for a range). Mark a guess `conf: "low"` with a one-line `why`.
5. **No human-time estimates.** Never write effort as days or weeks; Claude does the work. Write what changes and what the person has to check.
6. **Show the cost of every option, the recommended one too.** `give` on each; `flaw` on the recommended one. Add a "do nothing" option with `baseline: true` when it is real. No straw options: each needs a real `when`.
7. **2–4 options, a conditional recommendation.** Mark one `rec: true` and add `recNote` (`if`, `conf`, `why`) instead of a long argument.
8. **Say how hard it is to undo.** `undo` on the decision (and on options that differ). Approval before a hard-to-undo action (deploy, delete, sending outside, pushing to a shared branch): `"undo": "none"` (or `"noDelegate": true`) and `"ownAnswer": false`.
9. **One batch.** Put the decisions you will need soon in one file. With three or more, give each `short`, `stake`, and `depends` where one hangs on another; the page opens on an overview of them.
10. **Do not ask again what was decided.** Earlier answers are kept in `.hus-visual-decision/decisions/` at the project root. Look there first and follow them unless the user wants to change one.

Write in the user's language and set `"lang"` (`"en"`, `"ko"`).

## Words: everything on the page, for someone who has not seen this project

These rules cover every string the person reads: labels, row names, captions, notes, and the text inside `html` pictures. `plain` is only the part where they matter most.

1. **Write for a stranger.** The reader has not seen this conversation, your notes or this project. Use words they would say out loud.
2. **Never put a label from your own notes on the page.** Names you gave things while working (categories, statuses, ids, file and function names, "the X check") mean nothing to the reader. Say what the thing is.
   - Bad: "The person recognized the arrival." (an invented label turned into a sentence)
   - Good: "The user noticed the problem was solved."
   - If the page must show a project's own category names, first say in plain words what each one means, in `plain` or in the picture itself.
3. **Do not coin words or stretch ordinary ones.** Software does not "recognize an arrival" or "converge". Say who does what: "the AI kept going until both sides agreed".
4. **One sentence, one idea.** At most 90 characters in Korean, 170 in English. No stacks of nouns, and no arrows, slashes or chains of brackets standing in for grammar.
5. **Say what is counted.** "12 leads on one screen", not "12".
6. **A word you cannot replace** (a product name, or a technical word the person will meet again) goes in `terms` with a meaning: the page puts a **?** after it that shows the meaning. Try to replace it first. At most five a question; a word used in several questions goes in the top-level `terms`. A term must appear on its question.

`--check` stops what a program can find: a question without `plain`, an abbreviation or a name from code (`DM`, `API`, `session_relay`, `notes.md`) with no line in `terms`, a sentence over the limit, a term that is unused or only repeats itself. It cannot find a made-up phrase that reads like normal language. That is what the next step is for.

## Steps

1. **Write the question file** in a temp folder, e.g. `/tmp/hus-visual-decision/<short-name>.json`. Follow [references/schema.md](references/schema.md).
2. **Check it** (foreground, exits at once; 0 = valid, 2 = lists what to fix; it checks the words too):

   ```bash
   node <this skill's folder>/scripts/serve.mjs <file> --check
   ```

3. **Read it cold.** You wrote the page with the project in your head, so you cannot see which words only you understand. Print what the person will see, numbered, and nothing else:

   ```bash
   node <this skill's folder>/scripts/serve.mjs <file> --text
   ```

   Give only that output to a fresh agent that has not seen this conversation (Agent tool, a new agent, a small model is enough), with this prompt:

   > You are a person who has never seen this project and is not an engineer. Below is the exact text of a decision page, numbered, one piece per line. List every phrase you cannot follow or would have to guess at: words made up for this project, labels, abbreviations, odd verbs, sentences with no clear subject, and anything that contradicts another line. For each, give the line number, the phrase, what you think it might mean, and a plain rewrite. If everything is clear, say so. Do not praise or summarize.

   Rewrite what it lists (or add it to `terms` when it cannot be replaced), run step 2 again, and open the page only when nothing is left. To find where a line number sits in the file, run the same command with `--text-map` (do not give that to the reader: field names such as `ctx` only confuse them). Do not paste your own notes or the conversation into the prompt; the point is that the reader knows nothing. Tried on a real page, this reader found "arrival", "convergence", "gap" and "lack-of-understanding evidence" used as if everyone knew them, and a pair of lines that contradicted each other.

4. **Open it** in the background (the person may take a while):

   ```bash
   node <this skill's folder>/scripts/serve.mjs <file>
   ```

   Tell the user in one line that the page is open, with the address from the first stderr line (`Decision page: http://127.0.0.1:…`). Work on what does not depend on the answers; do not guess them.
5. **Read the result** when the script exits:

   | Exit | What to do |
   |---|---|
   | 0 | `Decisions are done. Record: …` and one line per question id. Follow each answer (and its `additional comments`) |
   | 3 | The person cancelled. Stop the work that depends on it and say so in one line |
   | 4, 5 | Timed out or page closed. Say so and offer to open the same file again; the browser usually keeps the choices made so far |
   | 2, 1 | Fix the file (2) or report the error (1) |

   Lines after exit 0:
   - `"…"` / `[…]` / `{…}` / a number: the chosen answer. `decided by: …` names the rows the person said mattered; weigh them in later decisions.
   - `own answer (none of the options)`: the person typed what they want instead. Follow it.
   - `sent back (info)` / `sent back (options)`: find out more or write new options, then ask only that question again in a new file.
   - `sent back (delegate)`: go with the answer the line names (or choose yourself if it says there is none), and tell the user what you chose.

## Off in one project

If the user wants questions in the terminal again in this project, run `claude plugin disable hack-user-skills-visual-decision --scope local` there (`enable` with the same options turns it back on). It writes only this project's `.claude/settings.local.json`; other projects stay on. Tell the user it applies from the next session. If the command says the name matches more than one installed plugin, run `claude plugin list` and use the full `name@marketplace` it shows.

## Do not

- Call AskUserQuestion from inside this skill.
- Treat `delegate`, a cancel, a time-out or a closed page as approval for a hard-to-undo action.
