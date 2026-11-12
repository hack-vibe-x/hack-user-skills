#!/usr/bin/env node
// PreToolUse(AskUserQuestion) hook: a question that was about to be asked in the terminal is asked in the web page instead.
// On whenever the plugin is installed; disable the plugin to ask in the terminal again.
// The input is read and not used, so the caller is never left writing into a closed pipe.
try {
  for await (const _ of process.stdin);
} catch {}
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Ask this in the web page instead: use the hack-user-skills-visual-decision:visual-decision skill with the same question, then continue with the answers. If no page can be opened here (claude -p, a remote or SSH session), ask in plain text.",
    },
  }),
);
