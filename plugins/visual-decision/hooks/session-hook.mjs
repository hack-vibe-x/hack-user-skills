#!/usr/bin/env node
// SessionStart hook: tells Claude that this project keeps earlier decisions in .hus-visual-decision/decisions/, so they are read before related work.
// Says nothing when the project has no decision records. Changes no files.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "../skills/visual-decision/scripts/record.mjs";

let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  cwd = JSON.parse(text).cwd || cwd;
} catch {}

const dir = join(projectDir(cwd), ".hus-visual-decision", "decisions");
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d-.+\.md$/.test(f)).sort().reverse() : [];
if (files.length) {
  const recent = files.slice(0, 5).join(", ") + (files.length > 5 ? `, and ${files.length - 5} older` : "");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `This project keeps decisions the user made in the web page in .hus-visual-decision/decisions/ (${recent}). Before working on something one of them covers, read that file and follow it; do not ask again what is decided there unless the user wants to change it.`,
      },
    }),
  );
}
