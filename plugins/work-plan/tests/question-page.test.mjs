// Run: node --test plugins/work-plan/tests/question-page.test.mjs
// The question page in skills/work-plan/question-page/ is a copy of visual-decision's (see BUNDLED.json there).
// These tests check that the copy runs on its own, from this plugin's folder only. Everything happens in a temp folder.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = join(here, "..", "skills", "work-plan", "question-page");
const SERVE = join(PAGE, "scripts", "serve.mjs");

const Q = {
  id: "round-1",
  lang: "en",
  decisions: [
    {
      id: "scope",
      plain: "Pick how much of the work the plan covers.",
      type: "pick",
      q: "How much should the plan cover?",
      dims: ["Can I undo it?"],
      options: [
        { key: "all", label: "All of it", d: [["yes", "good"]], rec: true },
        { key: "first", label: "Only the first part", d: [["yes", "good"]] },
      ],
    },
  ],
};

function project() {
  const dir = mkdtempSync(join(tmpdir(), "hus-work-plan-page-test-"));
  mkdirSync(join(dir, ".git"));
  const file = join(dir, "round-1.json");
  writeFileSync(file, JSON.stringify(Q));
  return { dir, file };
}

test("the copy says which plugin and version it comes from", () => {
  const mark = JSON.parse(readFileSync(join(PAGE, "BUNDLED.json"), "utf8"));
  assert.equal(mark.from, "hack-user-skills-visual-decision");
  assert.match(mark.version, /^\d+\.\d+\.\d+$/);
  assert.ok(existsSync(join(PAGE, "visual-decision.md")), "the question rules are there");
  assert.ok(!existsSync(join(PAGE, "SKILL.md")), "the copy is not a second skill");
});

test("the copy checks a question file and prints its words", () => {
  const { dir, file } = project();
  const check = spawnSync(process.execPath, [SERVE, file, "--check"], { cwd: dir, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const text = spawnSync(process.execPath, [SERVE, file, "--text"], { cwd: dir, encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /How much should the plan cover\?/);
  writeFileSync(file, JSON.stringify({ decisions: [] }));
  assert.equal(spawnSync(process.execPath, [SERVE, file, "--check"], { cwd: dir }).status, 2);
});

test("the copy opens a page, takes the answer and keeps a record", async () => {
  const { dir, file } = project();
  const port = 47000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [SERVE, file, "--no-open", "--port", String(port)], { cwd: dir });
  let out = "";
  let err = "";
  child.stdout.on("data", (c) => (out += c));
  const url = await new Promise((ok, no) => {
    child.stderr.on("data", (c) => {
      err += c;
      const m = err.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) ok(m[0]);
    });
    child.on("exit", () => no(new Error(err)));
  });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const sent = await fetch(url + "api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: { scope: { choice: "all" } } }),
  });
  assert.equal(sent.status, 200, await sent.text());
  const code = await new Promise((ok) => child.on("exit", ok));
  assert.equal(code, 0);
  assert.match(out, /Decisions are done\./);
  assert.match(out, /- scope: "all"/);
  const records = readdirSync(join(dir, ".hus-visual-decision", "decisions"));
  assert.equal(records.length, 1);
  assert.match(records[0], /^\d{4}-\d\d-\d\d-round-1\.md$/);
});
