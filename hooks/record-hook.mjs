#!/usr/bin/env node
// Stop hook: writes decisions finished in the web page, and not yet recorded, into the record folder.
// Does nothing if there is no answer file in .decisions/answers. To run by hand: node record-hook.mjs --cwd <folder>
import { writePending } from "../skills/visual-decision/scripts/record.mjs";

let cwd = process.cwd();
const i = process.argv.indexOf("--cwd");
if (i > 0) cwd = process.argv[i + 1];
else if (!process.stdin.isTTY) {
  try {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    cwd = JSON.parse(text).cwd || cwd;
  } catch {}
}
try {
  const written = writePending(cwd);
  if (i > 0) console.log(written.length ? "Decision records written:\n" + written.map((p) => "- " + p).join("\n") : "No new decisions to record.");
} catch (e) {
  console.error("Could not write the decision record: " + e.message);
}
process.exit(0);
