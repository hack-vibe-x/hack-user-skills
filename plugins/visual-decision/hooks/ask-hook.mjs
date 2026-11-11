#!/usr/bin/env node
// PreToolUse(AskUserQuestion) hook: redirects a decision that was about to be asked in the terminal to the web page.
// Off by default. It only acts when <working dir>/.hus-visual-decision/config.json contains {"askHook": true}.
import { config } from "../skills/visual-decision/scripts/record.mjs";

let input = {};
try {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  input = JSON.parse(text);
} catch {}
const cwd = input.cwd || process.cwd();
if (config(cwd).askHook !== true) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "This project collects decisions in a web page. Instead of AskUserQuestion, use the hack-user-skills-visual-decision:visual-decision skill: write the same question as a question file and open it. Give every option a visual and difference rows, and continue with the answers once they come back.",
    },
  }),
);
process.exit(0);
