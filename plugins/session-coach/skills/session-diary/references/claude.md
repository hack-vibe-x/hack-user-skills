# Claude Code session records

Checked on one machine (VS Code extension, 2026-10). Other versions may differ. Variants not checked are marked "not checked" below.

## Where
- `~/.claude/projects/<project path with / turned into ->/<session id>.jsonl` — one session
- `~/.claude/projects/<project>/<session id>/subagents/agent-*.jsonl` — subagent records. Not a conversation with the person, so not read.
- Sessions opened in a worktree get `--claude-worktrees-...` in the project name. The script groups them under the original repository by `cwd`.

## Line format
One JSON object per line. Only lines whose `type` is `user` or `assistant` are conversation. The rest (`system`, `attachment`, `queue-operation`, `ai-title` and so on) are metadata.

Signals that pick out **what the person actually typed** in user lines:
- `isMeta: true`, `isCompactSummary: true` — left out
- `origin.kind` other than `human` (`task-notification`, `peer`) — left out. A line without `origin` may be the older format, so the text decides.
- `isSidechain: true` — left out
- `message.content` with only `tool_result` blocks is a tool result, so it is left out
- Text that starts with `<task-notification>`, `<command-name>`, `<local-command-stdout>`, `<system-reminder>` and the like was put in by a tool
- `<ide_selection>` and `<ide_opened_file>` blocks come mixed into the person's message, so only the blocks are removed
- `<pasted_content id="x">…</pasted_content id="x">` is content the person pasted. The closing tag carries the id too, and sometimes there is no closing tag.

AI lines use only the `type: "text"` blocks of `message.content`. `thinking` and `tool_use` are not used.

## Keeping only sessions where a person worked
`scripts/day_sessions.py` leaves out the following. The counts go into the material's Facts section.
- Sessions whose `entrypoint` starts with `sdk`: runs launched by a program
- Sessions whose `cwd` is a temporary folder (`/tmp`, `/var/folders`): automated runs such as tests
- Groups of three or more sessions in a day that open with the same instruction and have two or fewer messages from the person: a rule of thumb, because automated runs that inherit the parent process's `entrypoint` (`claude-vscode`) cannot be told apart by any other signal. If a person opens a session three times with the same words, they may be left out by mistake.
- The session equal to `CLAUDE_CODE_SESSION_ID`, when `day_sessions.py` is run by hand: the conversation reading the records right now. The automatic run and `diary_auto.py write` keep it on purpose, because its messages that day are part of the day
