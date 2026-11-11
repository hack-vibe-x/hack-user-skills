#!/usr/bin/env node
// Serves a question file as a local web page and waits until the person submits their answers.
// On submit it writes the answers to <working dir>/.decisions/answers/<stamp>-<id>.json, prints a summary to stdout, and exits.
// It does not write the decision record document. The record hook (hooks/record-hook.mjs) does that from the answer file.
//
//   node serve.mjs <questions.json> [--port 4747] [--no-open] [--keep]
//
// Listens on 127.0.0.1 only. --keep keeps the server running after submit (for demos).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { makeT, pickLang, strings } from "./i18n.mjs";
import { answersFor, buildRecord, config, recordPathFor } from "./record.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
if (!file || !existsSync(file)) {
  console.error("A question file is required: node serve.mjs <questions.json>");
  process.exit(2);
}

const cwd = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "assets", "app.html");
const questions = JSON.parse(readFileSync(file, "utf8"));
questions.id ||= basename(file, extname(file));
// UI language: the question file, then .decisions/config.json, then English.
questions.lang = pickLang(questions.lang, config(cwd).lang);
const en = makeT("en");
const askedAt = new Date().toISOString();

const problems = check(questions);
if (problems.length) {
  console.error("The question file needs fixes:\n- " + problems.join("\n- "));
  process.exit(2);
}

// Catch missing values that would break the page before it opens.
function check(q) {
  const p = [];
  if (!Array.isArray(q.decisions) || !q.decisions.length) return ["decisions is empty"];
  const ids = new Set();
  for (const d of q.decisions) {
    const at = `[${d.id ?? "no id"}]`;
    if (!d.id || ids.has(d.id)) p.push(`${at} id is missing or duplicated`);
    ids.add(d.id);
    if (!d.q) p.push(`${at} q (the one-line question) is missing`);
    if (d.type === "pick" || d.type === "preview") {
      if (!d.options?.length || d.options.some((o) => !o.key || !o.label)) p.push(`${at} every option needs a key and a label`);
      if (d.type === "pick" && d.options?.some((o) => (o.d || []).length !== (d.dims || []).length)) p.push(`${at} an option has a different number of d cells than dims`);
    } else if (d.type === "multi") {
      if (!d.items?.length || d.items.some((i) => !i.id || !i.label)) p.push(`${at} every item needs an id and a label`);
    } else if (d.type === "batch") {
      if (!d.items?.length || d.items.some((i) => !i.id || !i.q || !i.options?.length)) p.push(`${at} every item needs an id, a q and options`);
    } else if (d.type === "value") {
      if (!d.stops?.length || d.stops.some((s) => s.v == null)) p.push(`${at} every stop needs a v`);
    } else p.push(`${at} type must be one of pick, preview, multi, batch, value`);
  }
  return p;
}

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
// Image files are served only from inside the working directory or a temp directory.
const ROOTS = [cwd, "/private/tmp", "/tmp"].filter(existsSync).map((r) => realpathSync(r));
function allowed(path) {
  const abs = resolve(cwd, path);
  if (!existsSync(abs) || !TYPES[extname(abs).toLowerCase()]) return null;
  const real = realpathSync(abs);
  return ROOTS.some((r) => real === r || real.startsWith(r + sep)) ? real : null;
}

const send = (res, status, type, body) => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  // Keep other websites from sending requests to this server.
  const host = (req.headers.host || "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return send(res, 403, "text/plain", "forbidden");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, "text/html; charset=utf-8", readFileSync(app));
  if (req.method === "GET" && url.pathname === "/api/questions") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ...questions, strings: strings(questions.lang) }));
  if (req.method === "GET" && url.pathname === "/file") {
    const real = allowed(url.searchParams.get("path") || "");
    return real ? send(res, 200, TYPES[extname(real).toLowerCase()], readFileSync(real)) : send(res, 404, "text/plain", "not found");
  }
  if (req.method === "POST" && url.pathname === "/api/submit") {
    const origin = req.headers.origin;
    if (origin && new URL(origin).hostname !== host) return send(res, 403, "text/plain", "forbidden");
    let text = "";
    for await (const chunk of req) text += chunk;
    let state;
    try {
      state = JSON.parse(text).state;
    } catch {
      return send(res, 400, "text/plain", "bad json");
    }
    if (!state || typeof state !== "object") return send(res, 400, "text/plain", "no state");
    const session = { id: questions.id, askedAt, answeredAt: new Date().toISOString(), questions, state, answers: answersFor(questions, state) };
    const dir = join(cwd, ".decisions", "answers");
    mkdirSync(dir, { recursive: true });
    const stamp = session.answeredAt.replace(/[-:]/g, "").slice(0, 15);
    const out = join(dir, `${stamp}-${questions.id}.json`);
    writeFileSync(out, JSON.stringify(session, null, 1));
    const md = buildRecord(questions, state, session.answeredAt);
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ md, path: relative(cwd, recordPathFor(cwd, session)) }));
    report(session, relative(cwd, out));
    if (!flag("--keep")) setTimeout(() => process.exit(0), 300);
    return;
  }
  send(res, 404, "text/plain", "not found");
});

// What Claude reads: one line per question; sent-back ones say what to do next. Always English.
function report(session, answersFile) {
  const L = [`Decisions are done. Answer file: ${answersFile}`, ""];
  for (const d of questions.decisions) {
    const a = session.answers[d.id];
    if (a.handBack) L.push(`- ${d.id}: sent back (${a.handBack}) — ${en(`reason.${a.handBack}.desc`)}${a.why ? ` Why: ${a.why}` : ""}`);
    else L.push(`- ${d.id}: ${JSON.stringify(a.choice)}${a.note ? ` · additional comments: ${a.note}` : ""}`);
  }
  const back = Object.values(session.answers).filter((a) => a.handBack === "info" || a.handBack === "options").length;
  if (back) L.push("", `${back} question(s) need to be asked again. Fix only those and open a new question file.`);
  console.log(L.join("\n"));
}

function listen(port, tries) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 0) listen(port + 1, tries - 1);
    else {
      console.error(String(e));
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.error(`Decision page: ${url} (${questions.decisions.length} questions, waiting for the person to submit)`);
    if (!flag("--no-open")) execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], () => {});
  });
}
listen(Number(opt("--port", 4747)), 20);
