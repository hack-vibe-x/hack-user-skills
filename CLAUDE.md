# hack-user-skills

One repository, one marketplace (`hack-user-skills`), one folder per plugin under `plugins/<name>/`.
The policy for names, language and license is `hack-user-skills-policy:apply-policy` (source: `~/Projects/hack-user-skills-policy/skills/apply-policy/references/policy.md`). Follow it.

## Rules
- Each plugin folder is self-contained. Installing copies only `plugins/<name>/`, so nothing in it may reference `../`. Shared code is copied into each plugin, not imported from outside.
- Plugin name is `hack-user-skills-<name>` in `plugins/<name>/.claude-plugin/plugin.json` and in the matching `plugins[]` entry of the root `.claude-plugin/marketplace.json` (with `"source": "./plugins/<name>"`). The two must match.
- A plugin that uses another plugin's files carries a copy of them, listed in `bundles.json` (for example work-plan's `skills/work-plan/question-page/` from visual-decision). Do not use `dependencies` in `plugin.json`. Edit only the source; never edit a copy. The PostToolUse hook in `.claude/settings.json` runs `scripts/bundle.mjs` after each edit, which updates the copies and the version table in the root README; outside Claude Code, run `node scripts/bundle.mjs` yourself. `.githooks/pre-commit` stops a commit whose staged copies do not match their source (turn it on once per clone: `git config core.hooksPath .githooks`).
- When a plugin's `skills/` or `hooks/` change, bump that plugin's `version` only. When a copy inside a plugin changes, bump that plugin's version too. Tag releases as `<name>-v<version>` (for example `visual-decision-v0.4.0`).
- Adding a plugin: create the folder with the apply-policy skill (it scaffolds and registers it in the marketplace), then add a row to the root README in both languages.
- Check everything: `node ~/Projects/hack-user-skills-policy/skills/apply-policy/scripts/check.mjs .` (the root checks the marketplace and every plugin), and `node scripts/bundle.mjs --check` (every copy matches its source and the README table is current).
- Write commit messages in English. Commit only when asked.
