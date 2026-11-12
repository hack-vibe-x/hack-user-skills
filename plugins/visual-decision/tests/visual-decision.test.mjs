// Run: node --test plugins/visual-decision/tests/*.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { answersFor, buildRecord, cleanState, writePending } from "../skills/visual-decision/scripts/record.mjs";
import { check, safeId, unanswered } from "../skills/visual-decision/scripts/validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SERVE = join(here, "..", "skills", "visual-decision", "scripts", "serve.mjs");
const tmp = () => mkdtempSync(join(tmpdir(), "hus-visual-decision-test-"));

const Q = {
  id: "t",
  lang: "en",
  decisions: [
    { id: "a", type: "pick", q: "Which?", dims: ["Speed"], options: [{ key: "x", label: "<Button>", d: [["fast", "good"]], rec: true }, { key: "y", label: "Link", d: [["slow", "bad"]] }] },
    { id: "b", type: "multi", q: "Which items?", items: [{ id: "i1", label: "One" }, { id: "i2", label: "Two" }] },
    { id: "c", type: "batch", q: "Each?", items: [{ id: "r1", q: "Row", options: [{ key: "k1", label: "K1" }] }] },
    { id: "d", type: "value", q: "How many?", stops: [{ v: 1 }, { v: 5 }] },
  ],
};
const FULL = { a: { choice: "x" }, b: { choices: ["i2"] }, c: { choices: { r1: "k1" } }, d: { choice: 5 } };

test("both samples pass the check", () => {
  for (const f of ["decisions.json", "decisions.ko.json"]) assert.deepEqual(check(JSON.parse(readFileSync(join(here, "..", "samples", f), "utf8"))), [], f);
});

test("check reports what breaks the page", () => {
  assert.deepEqual(check(Q), []);
  const p = (q) => check(q).join("\n");
  assert.match(p({ ...Q, id: "a/b" }), /may hold only/);
  assert.match(p({ ...Q, id: ".." }), /may hold only/);
  assert.match(p({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X", visual: { type: "steps" } }] }] }), /steps array/);
  assert.match(p({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X" }, { key: "x", label: "Y" }] }] }), /unique/);
  assert.match(p({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X", rec: 1 }, { key: "y", label: "Y", rec: 1 }] }] }), /only one option/);
  assert.match(p({ decisions: [{ id: "s", type: "multi", q: "?", items: [{ id: "i", label: "I" }, { id: "i", label: "J" }] }] }), /unique/);
  assert.match(p({ decisions: [{ id: "s", type: "nope", q: "?" }] }), /type must be/);
  assert.match(p({ decisions: [] }), /empty/);
  assert.match(p({ ...Q, decisions: [{ ...Q.decisions[0], noDelegate: "yes" }] }), /noDelegate must be/);
  assert.match(p({ ...Q, supersedes: "t" }), /own id/);
  assert.match(p({ ...Q, supersedes: ["ok", "a/b"] }), /supersedes must be/);
  assert.deepEqual(check({ ...Q, supersedes: ["older-batch"] }), []);
  assert.match(p({ decisions: [{ id: "s", type: "preview", q: "?", preview: { html: "<b>x</b>", height: -1 }, options: [{ key: "x", label: "X" }] }] }), /height/);
  assert.equal(safeId("my questions/v2"), "my-questions-v2");
  assert.equal(safeId("décision 1"), "décision-1");
});

test("cleanState drops answers that do not match the questions", () => {
  const stale = { a: { choice: "gone", note: "n" }, b: { choices: ["i1", "zz"] }, c: { choices: { r1: "nope" } }, d: { choice: 3 }, zz: { choice: 1 } };
  assert.deepEqual(cleanState(Q, stale), { a: { note: "n" }, b: { choices: ["i1"] }, c: { choices: {} } });
  assert.deepEqual(unanswered(Q, stale), ["a", "c", "d"]);
  assert.deepEqual(unanswered(Q, FULL), []);
  assert.deepEqual(cleanState(Q, { a: { defer: "info", why: "w", choice: "x" } }), { a: { defer: "info", why: "w" } });
  assert.deepEqual(cleanState(Q, { a: { defer: "made-up" } }), {});
});

test("noDelegate: handing a hard-to-undo decision to Claude is dropped", () => {
  const q = { ...Q, decisions: [{ ...Q.decisions[0], noDelegate: true }, ...Q.decisions.slice(1)] };
  assert.deepEqual(cleanState(q, { a: { defer: "delegate", why: "w" } }), {});
  assert.deepEqual(cleanState(q, { a: { defer: "info" } }), { a: { defer: "info" } });
  assert.deepEqual(unanswered(q, { ...FULL, a: { defer: "delegate" } }), ["a"]);
});

test("supersedes links the new record and the earlier one both ways", () => {
  const cwd = tmp();
  const dir = join(cwd, ".hus-visual-decision", "answers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "20260102T000000-t.json"), JSON.stringify({ id: "t", answeredAt: "2026-01-02T00:00:00Z", questions: Q, state: { ...FULL, a: { defer: "options" } } }));
  writeFileSync(join(dir, "20260102T010000-t2.json"), JSON.stringify({ id: "t2", answeredAt: "2026-01-02T01:00:00Z", questions: { ...Q, id: "t2", supersedes: "t" }, state: FULL }));
  const written = writePending(cwd);
  assert.equal(written.length, 2);
  const [oldMd, newMd] = written.map((p) => readFileSync(join(cwd, p), "utf8"));
  assert.match(newMd, /Decides again what was asked in \[t\]\(2026-01-02-t\.md\)/);
  assert.match(oldMd, /Decided again later in \[t2 · 2026-01-02\]\(2026-01-02-t2\.md\)/);
  // An id with no record yet is named, not linked.
  assert.match(buildRecord({ ...Q, supersedes: "nowhere" }, FULL, "2026-01-02T00:00:00Z"), /`nowhere`/);
});

test("records keep angle brackets visible and survive stale answers", () => {
  const md = buildRecord(Q, FULL, "2026-01-02T03:04:05Z");
  assert.match(md, /\\<Button\\>/);
  assert.match(md, /\*\*Not chosen:\*\* Link — Speed slow/);
  assert.doesNotThrow(() => buildRecord(Q, { a: { choice: "gone" }, c: { choices: { r1: "nope" } } }, "2026-01-02T00:00:00Z"));
  assert.deepEqual(answersFor(Q, { a: { choice: "gone" } }).a, { choice: null });
});

test("writePending records the good answer files even when one is broken", () => {
  const cwd = tmp();
  const dir = join(cwd, ".hus-visual-decision", "answers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "1-bad.json"), JSON.stringify({ id: "bad", questions: { decisions: "not a list" }, state: {} }));
  writeFileSync(join(dir, "2-junk.json"), "{");
  writeFileSync(join(dir, "3-t.json"), JSON.stringify({ id: "t", answeredAt: "2026-01-02T00:00:00Z", questions: Q, state: FULL }));
  const written = writePending(cwd);
  assert.equal(written.length, 1);
  assert.deepEqual(writePending(cwd), [], "a second run writes nothing");
  assert.ok(readdirSync(join(cwd, "docs", "decisions")).includes("README.md"));
});

// Starts the server on a free port and resolves with its port once it is listening.
function serve(cwd, qfile, extra = []) {
  const child = spawn(process.execPath, [SERVE, qfile, "--no-open", "--port", String(20000 + Math.floor(Math.random() * 20000)), ...extra], { cwd });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  const ready = new Promise((res, rej) => {
    let err = "";
    child.stderr.on("data", (b) => {
      err += b;
      const m = err.match(/127\.0\.0\.1:(\d+)\//);
      if (m) res(Number(m[1]));
    });
    child.on("exit", (code) => rej(new Error(`exited ${code}: ${err}`)));
  });
  return { child, ready, out: () => out };
}

test("server: refuses Origin null, unknown answers and a second submit", async () => {
  const cwd = tmp();
  const qfile = join(cwd, "q.json");
  writeFileSync(qfile, JSON.stringify(Q));
  const s = serve(cwd, qfile);
  try {
    const port = await s.ready;
    const url = `http://127.0.0.1:${port}/api/submit`;
    const post = (body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ state: FULL }, { origin: "null" })).status, 403);
    assert.equal((await post({ state: FULL }, { origin: "http://evil.example" })).status, 403);
    const stale = await post({ state: { ...FULL, a: { choice: "gone" } } });
    assert.equal(stale.status, 400);
    assert.match(await stale.text(), /unanswered: a/);
    const both = await Promise.all([post({ state: FULL }), post({ state: FULL })]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
    await new Promise((r) => s.child.once("exit", r));
    assert.equal(s.out().match(/Decisions are done/g)?.length, 1);
    const files = readdirSync(join(cwd, ".hus-visual-decision", "answers"));
    assert.equal(files.length, 1);
  } finally {
    s.child.kill();
  }
});

const exited = (child) => new Promise((r) => (child.exitCode != null ? r(child.exitCode) : child.once("exit", (code) => r(code))));

test("server: hands out the file hash and refuses answers made for another version", async () => {
  const cwd = tmp();
  const qfile = join(cwd, "q.json");
  writeFileSync(qfile, JSON.stringify(Q));
  const s = serve(cwd, qfile);
  try {
    const port = await s.ready;
    const q = await (await fetch(`http://127.0.0.1:${port}/api/questions`)).json();
    assert.match(q.hash, /^[0-9a-f]{16}$/);
    const r = await fetch(`http://127.0.0.1:${port}/api/submit`, { method: "POST", body: JSON.stringify({ state: FULL, hash: "0000000000000000" }) });
    assert.equal(r.status, 409);
  } finally {
    s.child.kill();
  }
});

test("server: Cancel on the page ends the wait with exit 3 and no answer file", async () => {
  const cwd = tmp();
  const qfile = join(cwd, "q.json");
  writeFileSync(qfile, JSON.stringify(Q));
  const s = serve(cwd, qfile);
  try {
    const port = await s.ready;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cancel`, { method: "POST", headers: { origin: "http://evil.example" } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cancel`, { method: "POST" })).status, 200);
    assert.equal(await exited(s.child), 3);
    assert.match(s.out(), /^Decisions cancelled\./);
    assert.throws(() => readdirSync(join(cwd, ".hus-visual-decision", "answers")));
  } finally {
    s.child.kill();
  }
});

test("server: --timeout ends the wait with exit 4", async () => {
  const cwd = tmp();
  const qfile = join(cwd, "q.json");
  writeFileSync(qfile, JSON.stringify(Q));
  const s = serve(cwd, qfile, ["--timeout", "0.01"]);
  try {
    await s.ready;
    assert.equal(await exited(s.child), 4);
    assert.match(s.out(), /^Decisions timed out\./);
  } finally {
    s.child.kill();
  }
});

test("server: a closed page ends the wait with exit 5, but a quick reload does not", async () => {
  const cwd = tmp();
  const qfile = join(cwd, "q.json");
  writeFileSync(qfile, JSON.stringify(Q));
  const s = serve(cwd, qfile, ["--grace", "0.4"]);
  const open = async (port) => {
    const ac = new AbortController();
    const r = await fetch(`http://127.0.0.1:${port}/api/live`, { signal: ac.signal });
    assert.equal(r.headers.get("content-type"), "text/event-stream");
    r.body.getReader().read().catch(() => {});
    return ac;
  };
  try {
    const port = await s.ready;
    // Before any page connects, nothing ends the wait.
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(s.child.exitCode, null);
    (await open(port)).abort();
    const again = await open(port);
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(s.child.exitCode, null, "a reload inside the grace period keeps the server");
    again.abort();
    assert.equal(await exited(s.child), 5);
    assert.match(s.out(), /^Decisions not submitted\. The page was closed/);
  } finally {
    s.child.kill();
  }
});

test("--check validates without opening a page; bad JSON gets a readable error", async () => {
  const cwd = tmp();
  const run = (args) =>
    new Promise((res) => {
      const c = spawn(process.execPath, [SERVE, ...args], { cwd });
      let err = "";
      c.stderr.on("data", (b) => (err += b));
      c.on("exit", (code) => res({ code, err }));
    });
  writeFileSync(join(cwd, "ok.json"), JSON.stringify(Q));
  writeFileSync(join(cwd, "bad.json"), "{ nope");
  writeFileSync(join(cwd, "id.json"), JSON.stringify({ ...Q, id: "../x" }));
  assert.equal((await run(["ok.json", "--check"])).code, 0);
  const bad = await run(["bad.json", "--check"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /not valid JSON/);
  assert.equal((await run(["id.json", "--check"])).code, 2);
});
