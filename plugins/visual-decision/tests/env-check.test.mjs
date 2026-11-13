// Run: node --test plugins/visual-decision/tests/env-check.test.mjs
// Tests hooks/env-check.sh and the node guard in hooks/hooks.json with a fake PATH. Nothing is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, "..", "hooks");
const CHECK = join(HOOKS, "env-check.sh");
const tmp = () => mkdtempSync(join(tmpdir(), "hus-visual-decision-envcheck-"));

// A PATH holding only the tools the script needs, so the node and brew of this computer are not found.
function toolPath(extra = {}) {
  const dir = tmp();
  for (const t of ["sh", "uname", "touch", "mkdir"]) {
    const p = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim();
    if (p) symlinkSync(p, join(dir, t));
  }
  for (const [name, body] of Object.entries(extra)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function check({ path, home = tmp(), brewPaths = "/nonexistent/brew", args = [] }) {
  const r = spawnSync("sh", [CHECK, ...args], { encoding: "utf8", env: { PATH: path, HOME: home, HUS_VISUAL_DECISION_BREW_PATHS: brewPaths, HUS_VISUAL_DECISION_NODE_PATHS: "/nonexistent/node" } });
  return { code: r.status, out: r.stdout, err: r.stderr, home };
}
const context = (r) => JSON.parse(r.out).hookSpecificOutput.additionalContext;

test("silent when Node.js 18 or later is there", () => {
  const r = check({ path: toolPath({ node: "exit 0" }) });
  assert.deepEqual([r.code, r.out, r.err], [0, "", ""]);
});

test("a Node.js that is too old counts as missing", () => {
  const r = check({ path: toolPath({ node: "exit 1" }) });
  assert.match(context(r), /needs Node\.js 18 or later/);
});

test("with Homebrew: four options, one exact command, and the reassurances", () => {
  const brew = join(tmp(), "brew");
  writeFileSync(brew, "#!/bin/sh\n");
  chmodSync(brew, 0o755);
  const r = check({ path: toolPath(), brewPaths: brew });
  const o = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(o.hookEventName, "SessionStart");
  const c = o.additionalContext;
  assert.match(c, /AskUserQuestion/);
  assert.ok(c.includes(`exactly \`${brew} install node\``));
  for (const label of ["Install it for me", "Send me the command", "Not now", "Do not ask again"]) assert.ok(c.includes(label), label);
  assert.match(c, /nothing is installed until they choose/);
  assert.match(c, /no administrator password/);
  assert.match(c, /brew uninstall node/);
  assert.match(c, /Never use sudo/);
  assert.ok(!c.includes("\n"));
});

test("without Homebrew: Claude installs nothing and points to the download page", () => {
  const c = context(check({ path: toolPath() }));
  assert.ok(!c.includes("Install it for me"));
  assert.match(c, /do not install anything yourself/);
  assert.match(c, /https:\/\/nodejs\.org/);
});

test("the 'do not ask again' command given to Claude really silences the hook", () => {
  const home = tmp();
  const path = toolPath();
  const c = context(check({ path, home }));
  const command = c.match(/you run `(mkdir -p [^`]+)`/)[1];
  assert.equal(spawnSync("sh", ["-c", command], { env: { PATH: path, HOME: home } }).status, 0);
  assert.ok(existsSync(join(home, ".hus-visual-decision", "no-env-check")));
  const r = check({ path, home });
  assert.deepEqual([r.code, r.out], [0, ""]);
});

test("a Node.js kept by a version manager is found even when PATH does not list it", () => {
  const home = tmp();
  const dir = join(home, ".nvm", "versions", "node", "v22.1.0", "bin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "node"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "node"), 0o755);
  const quiet = check({ path: toolPath(), home });
  assert.deepEqual([quiet.code, quiet.out], [0, ""]);
  const found = check({ path: toolPath(), home, args: ["path"] });
  assert.deepEqual([found.code, found.out.trim()], [0, join(dir, "node")]);
});

test("path mode: exits 1 with no output when there is no usable node, and ignores 'do not ask again'", () => {
  const home = tmp();
  mkdirSync(join(home, ".hus-visual-decision"));
  writeFileSync(join(home, ".hus-visual-decision", "no-env-check"), "");
  const none = check({ path: toolPath(), home, args: ["path"] });
  assert.deepEqual([none.code, none.out], [1, ""]);
  const there = check({ path: toolPath({ node: "exit 0" }), home, args: ["path"] });
  assert.equal(there.code, 0);
});

test("a Node.js that is too old is named in the question, and Claude is told what to do if it still comes first", () => {
  const c = context(check({ path: toolPath({ node: 'if [ "$1" = -v ]; then echo v16.20.0; else exit 1; fi' }), brewPaths: "/bin/sh" }));
  assert.match(c, /Node\.js v16\.20\.0 is on this computer .*older than 18/);
  assert.match(c, /older Node\.js still comes first in their PATH/);
  assert.match(c, /do not edit any shell file/);
});

test("hooks.json: the node hooks find node through env-check.sh, stay silent without it, and pass stdin when it is there", () => {
  const hooks = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8")).hooks;
  const guarded = [...hooks.PreToolUse, ...hooks.SessionStart].flatMap((e) => e.hooks).filter((h) => h.args[0] === "-c");
  assert.equal(guarded.length, 2);
  const plugin = join(HOOKS, "..");
  const fill = (a) => a.replace("${CLAUDE_PLUGIN_ROOT}", plugin);
  for (const h of guarded) {
    const [flag, script, name, checker, target] = h.args;
    assert.ok(existsSync(fill(checker)) && existsSync(fill(target)), target);
    const run = (path, home) => spawnSync("sh", [flag, script, name, fill(checker), fill(target)], { input: "{}", encoding: "utf8", env: { PATH: path, HOME: home, HUS_VISUAL_DECISION_NODE_PATHS: "/nonexistent/node" } });
    const none = run(toolPath(), tmp());
    assert.deepEqual([none.status, none.stdout, none.stderr], [0, "", ""]);
  }
  const first = hooks.SessionStart[0].hooks[0];
  assert.deepEqual(first.args, ["${CLAUDE_PLUGIN_ROOT}/hooks/env-check.sh"]);
});

test("the ask hook still runs through the guard with the node found, and gets stdin", () => {
  const hooks = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8")).hooks;
  const h = hooks.PreToolUse[0].hooks[0];
  const realNode = process.execPath;
  const bin = tmp();
  symlinkSync(realNode, join(bin, "node"));
  for (const t of ["sh", "uname"]) symlinkSync(spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim(), join(bin, t));
  const fill = (a) => a.replace("${CLAUDE_PLUGIN_ROOT}", join(HOOKS, ".."));
  const input = JSON.stringify({ tool_name: "AskUserQuestion", tool_input: { questions: [] }, cwd: tmp() });
  const r = spawnSync("sh", [h.args[0], h.args[1], h.args[2], fill(h.args[3]), fill(h.args[4])], { input, encoding: "utf8", env: { PATH: bin, HOME: tmp() } });
  assert.equal(r.status, 0, r.stderr);
});
