---
name: visual-decision
description: When you need the user to make a decision, ask it in a local web page where every option has a visual and rows that show how the options differ, then continue with their answers. Finished decisions are saved as documents. Use when there is something to choose (screen designs, copy, structure, approvals before hard-to-undo actions, scope, numbers), when the user says "ask me in the web UI", "open a decision page", "웹으로 물어봐", "결정 화면 띄워줘", or when a hook tells you to use this skill instead of AskUserQuestion.
license: Apache-2.0
---

# Ask decisions in a web page

Do not ask a decision as terminal text. Open a local web page instead. The person sees one question at a time, compares options by their pictures, and submits everything once.

## Three rules

1. **Put a visual on every option.** Screen design: a mock. Structure or flow: a diagram. Copy: the text placed where it will appear. An option with text only is the last resort.
2. **Keep it short.** One-line question, one-sentence context. Fold long explanations into `more`. Spell out internal jargon and file names the person may not know.
3. **Make the differences visible.** Compare every option on the same rows (`dims`). Use 2–4 rows, short phrases, `good` where an option is better and `bad` where it is worse. Things that are the same across options are not rows; put them in one `same` line.

## Language

Write the questions in the language the user is using. Set `"lang"` at the top of the question file to match (`"en"`, `"ko"`); the page and the record document then use that language. If `lang` is missing, `.hus-visual-decision/config.json` `lang` is used, then English. To add a language, copy `locales/en.json` to `locales/<code>.json` and translate it.

## Procedure

1. **Collect what to ask.** Include decisions you will need soon, not only the one that blocks you now, in one batch. Do not ask what you can check yourself in the code or docs, or what has a clear convention.
2. **Write the question file** at `<working dir>/.hus-visual-decision/pending/<batch-name>.json`. Read [references/schema.md](references/schema.md) and follow it. The batch name is a short descriptive slug (e.g. `lead-list-layout`); it becomes the record file name.
   - Mark one option `rec: true` if you recommend it. The reason should show in `when` or in the difference rows.
   - Approval before a hard-to-undo action (deploy, delete, sending outside, pushing to a shared branch): add `"noDelegate": true` to that decision. The page then hides "Decide for me", so the person has to pick or send it back.
   - Asking again what an earlier batch sent back: add `"supersedes": "<earlier batch id>"` at the top. The page drops answers kept for any other version of a file, and the new record links to the old one.
   - 2–4 options. If there are more, cut them first.
   - Need a design? Attach it as `html` (a small HTML snippet) or `image` (a screenshot file in the working dir or the scratchpad).
3. **Check, then open the page.** First check the file in the foreground; it exits at once and lists anything to fix (exit 0 = valid):

   ```bash
   node <this skill's folder>/scripts/serve.mjs .hus-visual-decision/pending/<batch-name>.json --check
   ```

   Then open it from the working directory, in the background (the person may take a while):

   ```bash
   node <this skill's folder>/scripts/serve.mjs .hus-visual-decision/pending/<batch-name>.json
   ```

   The browser opens, and when the person presses Submit the script exits and prints their answers. The top-level `id` becomes part of file names, so use only letters, digits, `.`, `_` and `-`.

   The script does not wait forever. It stops after `--timeout <minutes>` (default 60, `0` = no limit), when the person presses Cancel on the page, or when the page has been closed for `--grace <seconds>` (default 60; a reload inside that time is fine).
4. **Wait.** Tell the user in one line that the page is open. Work on anything that does not depend on the answers. Do not guess the answers and proceed.
5. **Read the result and continue.** The exit code and the first line of stdout say how it ended:

   | Exit | First line | What to do |
   |---|---|---|
   | 0 | `Decisions are done. Answer file: …` | Read the answers below and continue |
   | 3 | `Decisions cancelled. …` | The person chose not to answer. Stop the work that depends on these decisions, say so in one line, and do not open the page again unless they ask |
   | 4 | `Decisions timed out. …` | Tell the user in one line and offer to open the same file again. Choices made so far come back in the browser |
   | 5 | `Decisions not submitted. The page was closed …` | Same as 4 |
   | 2 | (stderr) the fixes the file needs | Fix the question file and open it again |
   | 1 | (stderr) a server error | Report it; do not guess the answers |

   After exit 0 the output has one line per question id.
   - A chosen value: follow it. If there are additional comments, apply them.
   - `sent back (info)`: find out more, then open only that question again.
   - `sent back (options)`: write new options that fit the stated reason and open only that question again.
   - `sent back (delegate)`: go with the recommended option and tell the user what you chose.
6. **The hook writes the record.** Answers pile up in `.hus-visual-decision/answers/`. When the turn ends, the Stop hook writes `docs/decisions/<date>-<batch-name>.md` and adds one line to `docs/decisions/README.md`. Without hooks, run it yourself:

   ```bash
   node <this skill's folder>/../../hooks/record-hook.mjs --cwd .
   ```

## Hooks

| Hook | What it does | Turned on by |
|---|---|---|
| PreToolUse (AskUserQuestion) | Blocks the terminal question and redirects it to this skill | `{"askHook": true}` in `.hus-visual-decision/config.json` |
| Stop | Writes finished decisions as documents | Only acts when an answer file exists |

`recordDir` in `.hus-visual-decision/config.json` changes the record folder (default `docs/decisions`). If the user asks to receive decisions in the web UI from now on, turn `askHook` on in that file; if they ask to turn it off, turn it off.

## Do not

- Call AskUserQuestion from inside this skill.
- Treat `delegate` as approval for a hard-to-undo action (deploy, delete, sending outside). Mark those `noDelegate`; the person must pick an answer themselves.
- Treat a cancel, a time-out or a closed page as an answer. Nothing was decided.
- Edit answer files or record documents by hand.
