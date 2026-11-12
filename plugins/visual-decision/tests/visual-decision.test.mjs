// Run: node --test plugins/visual-decision/tests/visual-decision.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pickLang } from "../skills/visual-decision/scripts/i18n.mjs";
import { answersFor, cleanState } from "../skills/visual-decision/scripts/answers.mjs";
import { check, unanswered } from "../skills/visual-decision/scripts/validate.mjs";
import { buildRecord, projectDir, writeRecord } from "../skills/visual-decision/scripts/record.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SERVE = join(here, "..", "skills", "visual-decision", "scripts", "serve.mjs");
const ASK_HOOK = join(here, "..", "hooks", "ask-hook.mjs");
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
  assert.match(p({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X", visual: { type: "steps" } }] }] }), /steps array/);
  assert.match(p({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X" }, { key: "x", label: "Y" }] }] }), /unique/);
  assert.match(p({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X", rec: 1 }, { key: "y", label: "Y", rec: 1 }] }] }), /only one option/);
  assert.match(p({ decisions: [{ id: "s", type: "multi", q: "?", items: [{ id: "i", label: "I" }, { id: "i", label: "J" }] }] }), /unique/);
  assert.match(p({ decisions: [{ id: "s", type: "nope", q: "?" }] }), /type must be/);
  assert.match(p({ decisions: [] }), /empty/);
  assert.match(p({ ...Q, decisions: [{ ...Q.decisions[0], noDelegate: "yes" }] }), /noDelegate must be/);
  assert.match(p({ ...Q, decisions: [{ ...Q.decisions[0], ownAnswer: "no" }] }), /ownAnswer must be/);
  assert.match(p({ decisions: [{ id: "s", type: "preview", q: "?", preview: { html: "<b>x</b>", height: -1 }, options: [{ key: "x", label: "X" }] }] }), /height/);
});

test("check catches value shapes the page would misdraw", () => {
  const p = (q, o) => check(q, o).join("\n");
  const pick = (over) => ({ decisions: [{ id: "s", type: "pick", q: "?", dims: ["Speed"], options: [{ key: "x", label: "X", d: [["fast", "good"]] }], ...over }] });
  assert.equal(p(pick({})), "");
  assert.match(p(pick({ options: [{ key: 1, label: "X", d: [["fast", "good"]] }] })), /key \(text\)/);
  assert.match(p(pick({ options: [{ key: "x", label: "X", d: ["fast"] }] })), /each d cell/);
  assert.match(p(pick({ options: [{ key: "x", label: "X", d: [["fast", "great"]] }] })), /each d cell/);
  assert.match(p(pick({ facts: { Commits: "25" } })), /facts must be/);
  assert.match(p({ decisions: [{ id: "s", type: "multi", q: "?", items: [{ id: 2, label: "I" }] }] }), /id \(text\)/);
  assert.match(p({ decisions: [{ id: "s", type: "value", q: "?", stops: [{ v: 1, outs: { k: "a" } }] }] }), /outs must be/);
  assert.match(p(pick({ options: [{ key: "x", label: "X", d: [["fast", "good"]], visual: { type: "steps", steps: ["a"], reach: "far" } }] })), /reach must be/);
  // A batch key with ":" is fine (the page keeps item and key apart).
  assert.equal(p({ decisions: [{ id: "s", type: "batch", q: "?", items: [{ id: "ratio", q: "Ratio", options: [{ key: "16:9", label: "16:9" }, { key: "4:3", label: "4:3" }] }] }] }), "");
});

test("check: images the page cannot show, and lang codes", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, "shot.png"), "png");
  writeFileSync(join(cwd, "shot.bmp"), "bmp");
  const img = (src) => ({ decisions: [{ id: "s", type: "pick", q: "?", options: [{ key: "x", label: "X", visual: { type: "image", src } }] }] });
  assert.deepEqual(check(img("shot.png"), { cwd }), []);
  assert.match(check(img("shot.bmp"), { cwd }).join(), /cannot be shown/);
  assert.match(check(img("missing.png"), { cwd }).join(), /cannot be shown/);
  assert.deepEqual(check(img("missing.png")), [], "without cwd only the presence of src is checked");
  assert.equal(pickLang("ko-KR"), "ko");
  assert.equal(pickLang("ko_kr"), "ko");
  assert.equal(pickLang("../x", "ko"), "ko");
  assert.deepEqual(check({ ...Q, lang: "ko-KR" }), []);
  assert.deepEqual(check({ ...Q, lang: "en-US" }), []);
  assert.match(check({ ...Q, lang: "xx" }).join(), /lang "xx" has no locales file/);
});

test("cleanState drops answers that do not match the questions", () => {
  const stale = { a: { choice: "gone", note: "n" }, b: { choices: ["i1", "zz"] }, c: { choices: { r1: "nope" } }, d: { choice: 3 }, zz: { choice: 1 } };
  assert.deepEqual(cleanState(Q, stale), { a: { note: "n" }, b: { choices: ["i1"] }, c: { choices: {} } });
  assert.deepEqual(unanswered(Q, stale), ["a", "c", "d"]);
  assert.deepEqual(unanswered(Q, FULL), []);
  assert.deepEqual(cleanState(Q, { a: { defer: "info", why: "w", choice: "x" } }), { a: { defer: "info", why: "w" } });
  assert.deepEqual(cleanState(Q, { a: { defer: "made-up" } }), {});
  assert.deepEqual(answersFor(Q, { a: { choice: "gone" } }).a, { choice: null });
});

test("noDelegate: handing a hard-to-undo decision to Claude is dropped", () => {
  const q = { ...Q, decisions: [{ ...Q.decisions[0], noDelegate: true }, ...Q.decisions.slice(1)] };
  assert.deepEqual(cleanState(q, { a: { defer: "delegate", why: "w" } }), {});
  assert.deepEqual(cleanState(q, { a: { defer: "info" } }), { a: { defer: "info" } });
  assert.deepEqual(unanswered(q, { ...FULL, a: { defer: "delegate" } }), ["a"]);
});

test("own answer: a pick question takes typed text unless ownAnswer is false", () => {
  const own = { ...FULL, a: { own: "  a chip instead  " } };
  assert.deepEqual(cleanState(Q, own).a, { own: "a chip instead" });
  assert.deepEqual(unanswered(Q, own), []);
  assert.deepEqual(answersFor(Q, own).a, { choice: null, own: "a chip instead" });
  assert.deepEqual(cleanState(Q, { ...FULL, a: { choice: "x", own: "typed" } }).a, { choice: "x" }, "a chosen option wins");
  assert.deepEqual(unanswered(Q, { ...FULL, a: { own: "   " } }), ["a"], "blank text is no answer");
  const off = { ...Q, decisions: Q.decisions.map((d) => (d.id === "a" ? { ...d, ownAnswer: false } : d)) };
  assert.deepEqual(unanswered(off, own), ["a"]);
  const pv = { decisions: [{ id: "p", type: "preview", q: "Color?", options: [{ key: "r", label: "Red" }] }] };
  assert.deepEqual(unanswered(pv, { p: { own: "blue" } }), ["p"], "only pick questions take one");
});

test("record: every answer shape, in the question file's language, kept at the git root", () => {
  const q = { ...Q, title: "<T>", decisions: [...Q.decisions, { id: "e", type: "pick", q: "Own?", options: [{ key: "m", label: "M" }] }, { id: "f", type: "pick", q: "Hand?", options: [{ key: "m", label: "M", rec: true }] }] };
  const state = { ...FULL, a: { choice: "y", note: "use <Chip> later" }, b: { defer: "info", why: "need <data>" }, e: { own: "something else" }, f: { defer: "delegate" } };
  const md = buildRecord(q, state, new Date(2026, 0, 2));
  for (const line of [
    "# \\<T\\> · 2026-01-02",
    "- **Answer:** Link\n- **Not chosen:** \\<Button\\>\n- **Additional comments:** use \\<Chip\\> later",
    "- **Answer:** Sent back · I need more information\n- **Reason:** need \\<data\\>",
    "- **Row:** K1",
    "- **Answer:** 5",
    "- **Answer:** Own answer: something else\n- **Not chosen:** M",
    "- Claude goes with the recommended answer: M",
  ])
    assert.ok(md.includes(line), `${line}\n---\n${md}`);
  // The unit follows the number exactly as written.
  const unit = (u) => buildRecord({ ...Q, decisions: [{ ...Q.decisions[3], unit: u }] }, FULL);
  assert.ok(unit(" per day").includes("- **Answer:** 5 per day"));
  assert.ok(unit("x").includes("- **Answer:** 5x"));
  const ko = JSON.parse(readFileSync(join(here, "..", "skills", "visual-decision", "locales", "ko.json"), "utf8"));
  assert.ok(buildRecord({ ...Q, lang: "ko" }, FULL).includes(`- **${ko["rec.answer"]}:** \\<Button\\> (${ko["pick.rec"]})`));
  const top = tmp();
  mkdirSync(join(top, ".git"));
  mkdirSync(join(top, "web"));
  assert.equal(projectDir(join(top, "web")), top);
  const p1 = writeRecord(join(top, "web"), "my batch/v2", Q, FULL, new Date(2026, 0, 2));
  const p2 = writeRecord(top, "my batch/v2", Q, FULL, new Date(2026, 0, 2));
  assert.equal(p1, join(top, ".hus-visual-decision", "decisions", "2026-01-02-my-batch-v2.md"));
  assert.equal(p2, join(top, ".hus-visual-decision", "decisions", "2026-01-02-my-batch-v2-2.md"), "never overwritten");
});

const runHook = (file, input) =>
  new Promise((res) => {
    const c = spawn(process.execPath, [join(here, "..", "hooks", file)], { env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
    let s = "";
    c.stdout.on("data", (b) => (s += b));
    c.on("exit", (code) => res({ code, out: s }));
    c.stdin.end(JSON.stringify(input));
  });

test("session hook: points to .hus-visual-decision/decisions only when records exist", async () => {
  const top = tmp();
  mkdirSync(join(top, ".git"));
  mkdirSync(join(top, "web"));
  let r = await runHook("session-hook.mjs", { cwd: join(top, "web") });
  assert.equal(r.code, 0);
  assert.equal(r.out, "", "no records: nothing is said");
  mkdirSync(join(top, ".hus-visual-decision", "decisions"), { recursive: true });
  for (let i = 1; i <= 7; i++) writeFileSync(join(top, ".hus-visual-decision", "decisions", `2026-01-0${i}-b${i}.md`), "# x");
  writeFileSync(join(top, ".hus-visual-decision", "decisions", "README.md"), "not a record");
  r = await runHook("session-hook.mjs", { cwd: join(top, "web") });
  const h = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(h.hookEventName, "SessionStart");
  assert.match(h.additionalContext, /\.hus-visual-decision\/decisions\/ \(2026-01-07-b7\.md, 2026-01-06-b6\.md, 2026-01-05-b5\.md, 2026-01-04-b4\.md, 2026-01-03-b3\.md, and 2 older\)/);
});

test("ask hook: every AskUserQuestion goes to the web page", async () => {
  const out = await new Promise((res) => {
    const c = spawn(process.execPath, [ASK_HOOK]);
    let s = "";
    c.stdout.on("data", (b) => (s += b));
    c.on("exit", () => res(s));
    c.stdin.end(JSON.stringify({ cwd: tmp(), tool_name: "AskUserQuestion", tool_input: { questions: [] } }));
  });
  const h = JSON.parse(out).hookSpecificOutput;
  assert.equal(h.permissionDecision, "deny");
  assert.match(h.permissionDecisionReason, /hack-user-skills-visual-decision:visual-decision/);
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
const exited = (child) => new Promise((r) => (child.exitCode != null ? r(child.exitCode) : child.once("exit", (code) => r(code))));

test("server: refuses Origin null, unknown answers and a second submit, and writes one record", async () => {
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
    assert.equal(await exited(s.child), 0);
    assert.equal(s.out().match(/Decisions are done/g)?.length, 1);
    assert.match(s.out(), /- a: "x"\n- b: \["i2"\]\n- c: \{"r1":"k1"\}\n- d: 5/);
    const rec = s.out().match(/Record: (\.hus-visual-decision\/decisions\/\d{4}-\d\d-\d\d-t\.md)/);
    assert.ok(rec, s.out());
    assert.match(readFileSync(join(cwd, rec[1]), "utf8"), /## 1\. Which\?\n\n- \*\*Answer:\*\* \\<Button\\> \(Recommended\)/);
  } finally {
    s.child.kill();
  }
});

test("server: sent-back lines keep the comments, a delegated one names the answer, an own answer is quoted", async () => {
  const cwd = tmp();
  const qfile = join(cwd, "q.json");
  const q = { ...Q, decisions: [...Q.decisions, { id: "e", type: "pick", q: "No rec?", options: [{ key: "m", label: "M" }, { key: "n", label: "N" }] }, { id: "f", type: "pick", q: "Own?", options: [{ key: "m", label: "M" }] }] };
  writeFileSync(qfile, JSON.stringify(q));
  const s = serve(cwd, qfile);
  try {
    const port = await s.ready;
    const state = { ...FULL, a: { defer: "delegate" }, b: { defer: "options", note: "keep the logo" }, c: { defer: "delegate" }, e: { defer: "delegate" }, f: { own: "Neither: use a chip" } };
    const r = await fetch(`http://127.0.0.1:${port}/api/submit`, { method: "POST", body: JSON.stringify({ state }) });
    assert.equal(r.status, 200);
    assert.equal(await exited(s.child), 0);
    const out = s.out();
    assert.match(out, /- a: sent back \(delegate\) — Go with the recommended "x"\. Tell the user what you chose\./);
    assert.match(out, /- b: sent back \(options\) .* · additional comments: keep the logo/);
    assert.match(out, /- c: sent back \(delegate\) — There is no recommended option: choose one yourself\./);
    assert.match(out, /- e: sent back \(delegate\) — There is no recommended option/);
    assert.match(out, /- f: own answer \(none of the options\) — "Neither: use a chip"/);
    assert.match(out, /1 question\(s\) need to be asked again/);
  } finally {
    s.child.kill();
  }
});

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

test("server: Cancel on the page ends the wait with exit 3", async () => {
  const cwd = tmp();
  const qfile = join(tmp(), "q.json");
  writeFileSync(qfile, JSON.stringify(Q));
  const s = serve(cwd, qfile);
  try {
    const port = await s.ready;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cancel`, { method: "POST", headers: { origin: "http://evil.example" } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cancel`, { method: "POST" })).status, 200);
    assert.equal(await exited(s.child), 3);
    assert.match(s.out(), /^Decisions cancelled\./);
    assert.ok(s.out().includes(`Question file: ${qfile}`), s.out());
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
  assert.equal((await run(["ok.json", "--check"])).code, 0);
  const bad = await run(["bad.json", "--check"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /not valid JSON/);
});
