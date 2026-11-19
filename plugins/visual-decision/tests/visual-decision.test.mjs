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
import { readout, readoutMap, wording } from "../skills/visual-decision/scripts/words.mjs";
import { buildRecord, projectDir, writeRecord } from "../skills/visual-decision/scripts/record.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SERVE = join(here, "..", "skills", "visual-decision", "scripts", "serve.mjs");
const ASK_HOOK = join(here, "..", "hooks", "ask-hook.mjs");
const tmp = () => mkdtempSync(join(tmpdir(), "hus-visual-decision-test-"));

const Q = {
  id: "t",
  lang: "en",
  decisions: [
    { id: "a", plain: "Pick one of two ways to show the button.", type: "pick", q: "Which?", dims: ["Speed"], options: [{ key: "x", label: "<Button>", d: [["fast", "good"]], rec: true }, { key: "y", label: "Link", d: [["slow", "bad"]] }] },
    { id: "b", plain: "Pick which items go in.", type: "multi", q: "Which items?", items: [{ id: "i1", label: "One" }, { id: "i2", label: "Two" }] },
    { id: "c", plain: "Answer one small question.", type: "batch", q: "Each?", items: [{ id: "r1", q: "Row", options: [{ key: "k1", label: "K1" }] }] },
    { id: "d", plain: "Pick a number.", type: "value", q: "How many?", stops: [{ v: 1 }, { v: 5 }] },
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
    "- **Answer:** Link\n- **Not chosen:** \\<Button\\>\n- **AI recommendation:** different (\\<Button\\>)\n- **Additional comments:** use \\<Chip\\> later",
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

test("check: the new fields (layers, undo, cells with ranges, panels, themes, new pictures)", () => {
  const p = (q) => check(q).join("\n");
  const base = { id: "s", type: "pick", q: "?", dims: [{ q: "How long?", short: "Time", max: 3 }], options: [{ key: "x", label: "X", d: [{ v: "1–3 days", n: 2, lo: 1, hi: 3, conf: "low", why: "not tried", t: "bad" }] }] };
  const full = {
    themes: [{ id: "undo", label: "Undo" }],
    decisions: [{ ...base, plain: "Two or three easy sentences.", undo: { level: "costly", how: "revert" }, themes: ["undo"], terms: [["Table", "a list"]], recNote: { if: "safety first", conf: "mid", why: "w" },
      panels: [{ title: "Changes", visual: { type: "blast", add: 0, change: 3, del: 1 } }, { title: "Fails if", text: "t" }, { title: "Touches", visual: { type: "impact", center: "db", rings: [[{ l: "a", t: "bad" }]] } }],
      options: [{ ...base.options[0], undo: "none", gist: "g", give: "x", means: "m", after: ["a"], check: "c", next: "n", detail: { evidence: [["measured", "e"]], prereq: "p", confusion: "c", visual: { type: "story", panels: [{ caption: "1", visual: { type: "screen", layout: "split" } }] } },
        visual: { type: "diff", before: { type: "button", text: "Go" }, after: { type: "button", text: "Start" }, notes: [{ at: [10, 20], text: "here", dim: 0 }], focus: [0, 0, 50, 50] } },
        { key: "y", label: "Y", baseline: true, d: [["same", ""]], visual: { type: "timeline", max: 40, lanes: [{ name: "db", items: [{ from: 0, to: 30, label: "kept" }] }], pnr: 30 } }] },
      { id: "v", type: "value", q: "?", values: { q: "?", left: "fast", right: "safe", labels: ["a", "b"], map: [1, 0] }, assume: "a", stops: [{ v: 1, outs: [{ k: "risk", v: "3 in 100", odds: { hit: 3, lo: 2, hi: 4 } }] }, { v: 2, means: "m" }] },
      { id: "m", type: "multi", q: "?", items: [{ id: "i", label: "I", visual: { type: "odds", hit: 3 } }] }],
  };
  assert.equal(p(full), "");
  const d0 = full.decisions[0];
  const one = (over, opt) => ({ ...full, decisions: [{ ...d0, ...over, options: [{ ...d0.options[0], ...opt }, d0.options[1]] }] });
  assert.match(p(one({ undo: "maybe" })), /undo must be/);
  assert.match(p(one({}, { undo: { level: "x" } })), /undo must be/);
  assert.match(p(one({ themes: ["nope"] })), /themes must list ids/);
  assert.match(p(one({ recNote: { conf: "very" } })), /recNote/);
  assert.match(p(one({ terms: "t" })), /terms must be/);
  assert.match(p(one({ panels: [{ text: "no title" }] })), /panels must be/);
  assert.match(p(one({}, { d: [{ v: "x", conf: "sure" }] })), /each d cell/);
  assert.match(p(one({}, { d: [{ v: "x", n: "two" }] })), /each d cell/);
  assert.match(p(one({}, { d: [{ t: "good" }] })), /each d cell/);
  assert.match(p(one({}, { after: "a" })), /after must be/);
  assert.match(p(one({}, { visual: { type: "diff" } })), /needs before/);
  assert.match(p(one({}, { visual: { type: "diff", before: { type: "steps" } } })), /steps array/);
  assert.match(p(one({}, { visual: { type: "timeline", max: 0, lanes: [] } })), /timeline needs max/);
  assert.match(p(one({}, { visual: { type: "impact", center: "x", rings: [[{}]] } })), /impact visual/);
  assert.match(p(one({}, { visual: { type: "odds" } })), /odds visual/);
  assert.match(p(one({}, { visual: { type: "screen", notes: [{ at: [1] }] } })), /notes must be/);
  assert.match(p(one({}, { visual: { type: "screen", focus: [1, 2] } })), /focus must be/);
  assert.match(p({ ...full, decisions: [{ ...full.decisions[1], values: { labels: ["a"], map: [5] } }] }), /values must be/);
  assert.match(p({ themes: [{ label: "no id" }], decisions: [base] }), /themes must be a list/);
});

test("undo level none works like noDelegate, and what decided it is kept", () => {
  const q = { ...Q, decisions: [{ ...Q.decisions[0], undo: { level: "none" } }, ...Q.decisions.slice(1)] };
  assert.deepEqual(cleanState(q, { a: { defer: "delegate" } }), {});
  assert.deepEqual(cleanState(Q, { a: { choice: "x", decisive: ["Speed", 3, "", "x".repeat(81)] } }).a, { choice: "x", decisive: ["Speed"] });
  assert.deepEqual(cleanState(Q, { a: { defer: "info", decisive: ["Speed"] } }).a, { defer: "info" }, "a sent-back answer has no reason chips");
  assert.deepEqual(answersFor(Q, { a: { choice: "x", decisive: ["Speed"] } }).a, { choice: "x", decisive: ["Speed"] });
});

test("record: what it does, the AI's view, what decided it, how to undo, check and next", () => {
  const q = { ...Q, decisions: [{ ...Q.decisions[0], recNote: { if: "speed matters most", conf: "mid" }, undo: "easy",
    options: [{ ...Q.decisions[0].options[0], means: "It loads fast.", check: "Time it", next: "Ship", undo: { level: "costly", how: "revert the commit" } }, Q.decisions[0].options[1]] }, ...Q.decisions.slice(1)] };
  const md = buildRecord(q, { ...FULL, a: { choice: "x", decisive: ["Speed"] } });
  for (const line of ["- **What it does:** It loads fast.", "- **AI recommendation:** same · Mostly right · from similar work", "- **What decided it:** Speed",
    "- **Undo:** Undoing takes work · revert the commit", "- **How to check it worked:** Time it", "- **Next:** Ship"])
    assert.ok(md.includes(line), `${line}\n---\n${md}`);
  const del = buildRecord(q, { ...FULL, a: { defer: "delegate" } });
  assert.ok(del.includes("- **Chosen by:** speed matters most"), del);
  assert.ok(!del.includes("What it does"), "a delegated answer has no chosen option yet");
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
  const q = { ...Q, decisions: [...Q.decisions, { id: "e", plain: "Pick one; nothing is recommended.", type: "pick", q: "No rec?", options: [{ key: "m", label: "M" }, { key: "n", label: "N" }] }, { id: "f", plain: "Pick the only option, or write your own.", type: "pick", q: "Own?", options: [{ key: "m", label: "M" }] }] };
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

// ---------- the words ----------

const P = (over = {}, lang = "en") => ({ lang, decisions: [{ id: "a", type: "pick", q: "Which?", plain: "Pick how the list looks.", options: [{ key: "x", label: "X" }, { key: "y", label: "Y" }], ...over }] });

test("words: a question without plain is sent back, and a plain one passes", () => {
  assert.deepEqual(wording(P()), []);
  assert.match(wording(P({ plain: "" }))[0], /\[a\] plain is missing/);
  assert.match(check(P({ plain: "" }), { words: true })[0], /plain is missing/);
  assert.deepEqual(check(P({ plain: "" })), [], "the structure check alone does not ask for words");
});

test("words: an abbreviation or a name from code needs a line in terms, in any field, html included", () => {
  assert.match(wording(P({ q: "Send an auto DM?" }))[0], /"DM" \(q\) is written like code/);
  assert.match(wording(P({ options: [{ key: "x", label: "X", gist: "reads session_relay.json" }, { key: "y", label: "Y" }] }))[0], /session_relay/);
  assert.match(wording(P({ options: [{ key: "x", label: "X", visual: { type: "html", html: "<style>.a{color:red}</style><b>pendingFile</b>" } }, { key: "y", label: "Y" }] }))[0], /pendingFile/);
  assert.deepEqual(wording(P({ q: "Send an auto DM?", terms: [["DM", "A private message to one person"]] })), []);
  assert.deepEqual(wording({ ...P({ q: "Send auto DMs?" }), terms: [["DM", "A private message to one person"]] }), [], "a term at the top covers every question, and a plural");
  assert.deepEqual(wording(P({ q: "Which AI, and which URL?" })), [], "words nearly everyone knows need no line");
  assert.deepEqual(wording(P({ options: [{ key: "x", label: "X", visual: { type: "html", html: "<style>.ABC_d{color:red}</style><b>Plain</b>" } }, { key: "y", label: "Y" }] })), [], "style is not words");
});

test("words: a long sentence is split, plain stays short, and terms are few, used and explained", () => {
  const long = "This is a very long sentence that keeps going and going with one more clause and then another and another until nobody can hold it all in their head at once, which is the problem.";
  assert.match(wording(P({ plain: long }))[0], /a sentence of \d+ characters/);
  assert.match(wording(P({ plain: "One. Two. Three. Four. Five." }))[0], /5 sentences/);
  assert.match(wording(P({ terms: [["Moon", "A thing in the sky at night"]] }))[0], /"Moon" is not used/);
  assert.match(wording(P({ q: "Which cat?", terms: [["cat", "cat"]] }))[0], /explain it in other words/);
  const six = ["a1", "b2", "c3", "d4", "e5", "f6"].map((w) => [w, `${w} means something else entirely`]);
  assert.match(wording(P({ q: "a1 b2 c3 d4 e5 f6", terms: six }))[0], /6 terms/);
  const ko = P({ plain: "\uD55C \uBB38\uC7A5\uC774 \uB108\uBB34 \uAE38\uBA74 \uC77D\uB294 \uC0AC\uB78C\uC774 \uB05D\uAE4C\uC9C0 \uB530\uB77C\uAC00\uC9C0 \uBABB\uD574\uC11C \uC55E\uC5D0\uC11C \uBB34\uC2A8 \uB9D0\uC774 \uB098\uC654\uB294\uC9C0 \uC78A\uC5B4\uBC84\uB9AC\uACE0 \uB9D9\uB2C8\uB2E4 \uADF8\uB798\uC11C \uD55C \uBB38\uC7A5\uC5D0\uB294 \uD55C \uAC00\uC9C0 \uC774\uC57C\uAE30\uB9CC \uB123\uACE0 \uB098\uBA38\uC9C0\uB294 \uB2E4\uC74C \uBB38\uC7A5\uC73C\uB85C \uB118\uAE30\uB294 \uAC83\uC774 \uC88B\uC2B5\uB2C8\uB2E4 \uADF8\uB7EC\uBA74 \uD6E8\uC52C \uC77D\uAE30 \uC26C\uC6CC\uC9D1\uB2C8\uB2E4." }, "ko");
  assert.match(wording(ko)[0], /a sentence of \d+ characters/);
});

test("words: the readout holds the words the person sees and nothing else", () => {
  const q = P({ terms: [["Moon", "A thing in the sky"]], options: [{ key: "secret-key", label: "Round", d: [["big", "good"]], visual: { type: "html", html: "<style>.z{color:red}</style><p>Only words</p>" }, color: "#fff" }, { key: "y", label: "Y" }] });
  const out = readout({ title: "T", ...q });
  assert.match(out, /== Which\?/);
  assert.match(out, /^\d+\. Only words$/m);
  assert.match(out, /^\d+\. Round$/m);
  assert.doesNotMatch(out, /secret-key|color:red|#fff|good/);
  assert.doesNotMatch(out, /options\[|plain|visual\.html|facts\[/, "no field names: a reader would take them for words on the page");
  const where = readoutMap({ title: "T", ...q });
  assert.match(where, /^\d+\t\[a\] options\[0\]\.visual\.html$/m);
  const two = readout({ ...q, decisions: [{ ...q.decisions[0], options: [{ key: "x", label: "X", visual: { type: "html", html: "<div>First line</div><div>Second line</div>" } }, { key: "y", label: "Y" }] }] });
  assert.match(two, /^\d+\. First line\n\d+\. Second line$/m, "a picture is read block by block");
});

test("--text prints the readout and exits; --check refuses a question file with code-like words", async () => {
  const cwd = tmp();
  const bad = join(cwd, "bad.json");
  writeFileSync(bad, JSON.stringify(P({ q: "Use the API?" })));
  const text = spawn(process.execPath, [SERVE, bad, "--text"], { cwd });
  let out = "";
  text.stdout.on("data", (b) => (out += b));
  assert.equal(await exited(text), 0);
  assert.match(out, /Use the API\?/);
  const chk = spawn(process.execPath, [SERVE, bad, "--check"], { cwd });
  let err = "";
  chk.stderr.on("data", (b) => (err += b));
  assert.equal(await exited(chk), 2);
  assert.match(err, /"API" \(q\)/);
});
