# Codex session records

Checked on one machine (Codex Desktop, 2026-10). Other versions may differ.

## Where
- `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` — one session
- `~/.codex/archived_sessions/rollout-*.jsonl` — archived sessions
- `~/.codex/external_agent_session_imports.json` — sessions **imported** from other tools (Claude Code and others). `records[].imported_thread_id` is the id of the imported session. On the machine checked, 41 of 45 sessions were such copies. Reading the originals too would count the same conversation twice, so when both tools are read the copies are left out. Machines without this file were not checked.

## Line format
One JSON object per line, split into `type` and `payload`.
- `session_meta` — session info: `payload.id`, `payload.cwd`, `payload.source`. When `source` is `{"subagent": ...}` it is a subagent session and is left out.
- Messages the person typed come in two forms.
  - `event_msg` / `payload.type = "user_message"` -> `payload.message`
  - `event_msg` / `payload.type = "item_completed"` with `payload.item.type = "UserMessage"` -> `payload.item.content[].text`
  - A session usually has only one of the two. The older format with neither (`history_mode: legacy`) falls back to `response_item` with `role: "user"`, filtering out text put in by the tool such as `<environment_context>` and `# AGENTS.md instructions`.
- AI replies are `response_item` / `payload.role = "assistant"` / `content[].type = "output_text"`.
- `response_item` with `role: "user"` holds, besides what the person typed, context the tool fed the model (permission review requests, summary requests, automatic notices), so it is not used as is.
- `reasoning`, `custom_tool_call`, `token_count`, `turn_context` and the like are not used.

## Keeping only sessions where a person worked
- When `session_meta` has `source` `exec` or `originator` `codex_exec`, a program ran it and it is left out. On the machine checked, 406 of 407 sessions from 2026-10-24 to 29 were like this.
- The conversation writing the diary right now is left out by `CODEX_THREAD_ID`. The name of this environment variable was not checked. If it does not match, pass `--exclude-session <id>`.
