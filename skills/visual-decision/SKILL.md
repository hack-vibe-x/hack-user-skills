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

Write the questions in the language the user is using. Set `"lang"` at the top of the question file to match (`"en"`, `"ko"`); the page and the record document then use that language. If `lang` is missing, `.decisions/config.json` `lang` is used, then English. To add a language, copy `locales/en.json` to `locales/<code>.json` and translate it.

## Procedure

1. **Collect what to ask.** Include decisions you will need soon, not only the one that blocks you now, in one batch. Do not ask what you can check yourself in the code or docs, or what has a clear convention.
2. **Write the question file** at `<working dir>/.decisions/pending/<batch-name>.json`. Read [references/schema.md](references/schema.md) and follow it. The batch name is a short descriptive slug (e.g. `lead-list-layout`); it becomes the record file name.
   - Mark one option `rec: true` if you recommend it. The reason should show in `when` or in the difference rows.
   - 2–4 options. If there are more, cut them first.
   - Need a design? Attach it as `html` (a small HTML snippet) or `image` (a screenshot file in the working dir or the scratchpad).
3. **Open the page.** From the working directory, in the background (the person may take a while):

   ```bash
   node <this skill's folder>/scripts/serve.mjs .decisions/pending/<batch-name>.json
   ```

   The browser opens, and when the person presses Submit the script exits and prints their answers. If the question file has missing values, it does not open and tells you what to fix.
4. **Wait.** Tell the user in one line that the page is open. Work on anything that does not depend on the answers. Do not guess the answers and proceed.
5. **Read the answers and continue.** The output has one line per question id.
   - A chosen value: follow it. If there are additional comments, apply them.
   - `sent back (info)`: find out more, then open only that question again.
   - `sent back (options)`: write new options that fit the stated reason and open only that question again.
   - `sent back (delegate)`: go with the recommended option and tell the user what you chose.
6. **The hook writes the record.** Answers pile up in `.decisions/answers/`. When the turn ends, the Stop hook writes `docs/decisions/<date>-<batch-name>.md` and adds one line to `docs/decisions/README.md`. Without hooks, run it yourself:

   ```bash
   node <plugin folder>/hooks/record-hook.mjs --cwd .
   ```

## Hooks

| Hook | What it does | Turned on by |
|---|---|---|
| PreToolUse (AskUserQuestion) | Blocks the terminal question and redirects it to this skill | `{"askHook": true}` in `.decisions/config.json` |
| Stop | Writes finished decisions as documents | Only acts when an answer file exists |

`recordDir` in `.decisions/config.json` changes the record folder (default `docs/decisions`). If the user asks to receive decisions in the web UI from now on, turn `askHook` on in that file; if they ask to turn it off, turn it off.

## Do not

- Call AskUserQuestion from inside this skill.
- Treat `delegate` as approval for a hard-to-undo action (deploy, delete, sending outside). For those, the person must pick an answer themselves.
- Edit answer files or record documents by hand.
