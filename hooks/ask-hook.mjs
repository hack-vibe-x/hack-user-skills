#!/usr/bin/env node
// PreToolUse(AskUserQuestion) hook: redirects a decision that was about to be asked in the terminal to the web page.
// Off by default. It only acts when <working dir>/.decisions/config.json contains {"askHook": true}.
import { readFileSync } from "node:fs";
import { join } from "node:path";

let input = {};
try {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  input = JSON.parse(text);
} catch {}
const cwd = input.cwd || process.cwd();
let on = false;
try {
  on = JSON.parse(readFileSync(join(cwd, ".decisions", "config.json"), "utf8")).askHook === true;
} catch {}
if (!on) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "This project collects decisions in a web page. Instead of AskUserQuestion, use the visual-decision skill: write the same question as a question file and open it. Give every option a visual and difference rows, and continue with the answers once they come back.",
    },
  }),
);
process.exit(0);
