#!/usr/bin/env node
// Serves a question file as a local web page and waits until the person submits their answers,
// then prints one line per question to stdout and exits. The answers are also kept as <project>/.hus-visual-decision/decisions/<date>-<name>.md (record.mjs).
//
//   node serve.mjs <questions.json> [--check] [--timeout 60] [--grace 60] [--port 4747] [--no-open] [--keep]
//
// --check only validates the question file and exits (0 = valid, 2 = needs fixes); no page opens.
// --timeout <minutes> stops waiting after that long (default 60; 0 = no limit).
// --grace <seconds> is how long the page may stay disconnected (reload, network blip) before it counts as closed (default 60).
// --keep keeps the server running after submit (for demos). Listens on 127.0.0.1 only.
//
// Exit codes: 0 submitted · 1 server error · 2 question file needs fixes · 3 cancelled on the page · 4 timed out · 5 page closed.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeT, pickLang, strings } from "./i18n.mjs";
import { answersFor, cleanState, recommended } from "./answers.mjs";
import { writeRecord } from "./record.mjs";
import { IMAGE_TYPES, check, imageFile, unanswered } from "./validate.mjs";

const EXIT = { submitted: 0, error: 1, invalid: 2, cancelled: 3, timeout: 4, closed: 5 };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const VALUED = ["--port", "--timeout", "--grace"];
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const file = args.find((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]));
if (!file || !existsSync(file)) {
  console.error("[hus-visual-decision] A question file is required: node serve.mjs <questions.json>");
  process.exit(EXIT.invalid);
}
const num = (name, fallback) => {
  const v = Number(opt(name, fallback));
  if (!Number.isFinite(v) || v < 0) {
    console.error(`[hus-visual-decision] ${name} needs a number of 0 or more`);
    process.exit(EXIT.invalid);
  }
  return v;
};
const timeoutMin = num("--timeout", 60);
const graceSec = num("--grace", 60);

const cwd = process.cwd();
const app = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "app.html");
let raw, questions;
try {
  raw = readFileSync(file, "utf8");
  questions = JSON.parse(raw);
} catch (e) {
  console.error(`[hus-visual-decision] The question file is not valid JSON (${file}): ${e.message}`);
  process.exit(EXIT.invalid);
}

const problems = check(questions, { cwd });
if (problems.length) {
  console.error("[hus-visual-decision] The question file needs fixes:\n- " + problems.join("\n- "));
  process.exit(EXIT.invalid);
}
if (flag("--check")) {
  console.error(`[hus-visual-decision] The question file is valid (${questions.decisions.length} questions).`);
  process.exit(EXIT.submitted);
}
// The hash of the file as written. Choices the browser kept for another version of the file are dropped.
const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
questions.id ||= basename(file, extname(file));
questions.hash = hash;
questions.lang = pickLang(questions.lang);
const en = makeT("en");
let submitted = false;
let ending = false;

const send = (res, status, type, body) => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};
// A sandboxed frame sends "Origin: null", which is not a URL. Anything that is not this page is refused.
function sameOrigin(req, host) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).hostname === host;
  } catch {
    return false;
  }
}
async function readJson(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

// Open pages hold a server-sent event stream. When the last one closes and none comes back within the grace period, the page counts as closed.
const pages = new Set();
let closedTimer = null;
function liveStream(req, res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write(`event: hello\ndata: ${JSON.stringify({ hash })}\n\n`);
  pages.add(res);
  clearTimeout(closedTimer);
  req.on("close", () => {
    pages.delete(res);
    if (!pages.size && !ending && !submitted && !flag("--keep")) closedTimer = setTimeout(() => finish("closed"), graceSec * 1000);
  });
}
// Comments keep the stream from being dropped by an idle timeout.
setInterval(() => pages.forEach((res) => res.write(": ping\n\n")), 15000).unref();

// Ends the wait without answers. The page hears why, and Claude reads one line on stdout.
function finish(reason) {
  if (ending) return;
  ending = true;
  clearTimeout(closedTimer);
  pages.forEach((res) => res.write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`));
  const lines = {
    cancelled: "Decisions cancelled. The person pressed Cancel on the page; no answers were given.",
    timeout: `Decisions timed out. No submit within ${timeoutMin} minutes; no answers were given.`,
    closed: `Decisions not submitted. The page was closed (no connection for ${graceSec} seconds); no answers were given.`,
  };
  console.log(`${lines[reason]} Question file: ${file}`);
  setTimeout(() => process.exit(EXIT[reason]), 300);
}

// What Claude reads: one line per question; sent-back ones say what to do next. Always English.
function report(answers, record) {
  const L = [`Decisions are done. ${record}`, ""];
  for (const d of questions.decisions) {
    const a = answers[d.id];
    const note = a.note ? ` · additional comments: ${a.note}` : "";
    const why = a.why ? ` Why: ${a.why}` : "";
    if (a.handBack === "delegate") {
      const rec = recommended(d);
      const pick = rec ? `Go with the recommended ${JSON.stringify(rec)}.` : "There is no recommended option: choose one yourself.";
      L.push(`- ${d.id}: sent back (delegate) — ${pick} Tell the user what you chose.${why}${note}`);
    } else if (a.handBack) L.push(`- ${d.id}: sent back (${a.handBack}) — ${en(`reason.${a.handBack}.desc`)}${why}${note}`);
    else if (a.own) L.push(`- ${d.id}: own answer (none of the options) — ${JSON.stringify(a.own)}${note}`);
    else L.push(`- ${d.id}: ${JSON.stringify(a.choice)}${note}`);
  }
  const back = Object.values(answers).filter((a) => a.handBack === "info" || a.handBack === "options").length;
  if (back) L.push("", `${back} question(s) need to be asked again. Write a new question file with only those and open it.`);
  console.log(L.join("\n"));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  // Keep other websites from sending requests to this server.
  const host = (req.headers.host || "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return send(res, 403, "text/plain", "forbidden");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, "text/html; charset=utf-8", readFileSync(app));
  if (req.method === "GET" && url.pathname === "/api/questions") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ...questions, strings: strings(questions.lang) }));
  if (req.method === "GET" && url.pathname === "/api/live") {
    if (ending) return send(res, 410, "text/plain", "ended");
    return liveStream(req, res);
  }
  if (req.method === "GET" && url.pathname === "/file") {
    const real = imageFile(cwd, url.searchParams.get("path") || "");
    return real ? send(res, 200, IMAGE_TYPES[extname(real).toLowerCase()], readFileSync(real)) : send(res, 404, "text/plain", "not found");
  }
  if (req.method === "POST" && url.pathname === "/api/cancel") {
    if (!sameOrigin(req, host)) return send(res, 403, "text/plain", "forbidden");
    if (submitted || ending) return send(res, 409, "text/plain", "already finished");
    send(res, 200, "application/json; charset=utf-8", "{}");
    return finish("cancelled");
  }
  if (req.method === "POST" && url.pathname === "/api/submit") {
    if (!sameOrigin(req, host)) return send(res, 403, "text/plain", "forbidden");
    if (ending) return send(res, 410, "text/plain", "ended");
    if (submitted) return send(res, 409, "text/plain", "already submitted");
    const body = await readJson(req);
    if (!body) return send(res, 400, "text/plain", "bad json");
    // A page loaded from another version of the question file must reload first.
    if (body.hash != null && body.hash !== hash) return send(res, 409, "text/plain", "the questions changed; reload the page");
    if (!body.state || typeof body.state !== "object") return send(res, 400, "text/plain", "no state");
    // Keep only answers that match the questions, and refuse a submit that leaves any question open.
    const state = cleanState(questions, body.state);
    const open = unanswered(questions, state);
    if (open.length) return send(res, 400, "text/plain", `unanswered: ${open.join(", ")}`);
    if (submitted || ending) return send(res, 409, "text/plain", "already submitted");
    submitted = true;
    clearTimeout(closedTimer);
    // The record is for looking back later; if it cannot be written, the answers still go to Claude.
    let path = null, record;
    try {
      path = writeRecord(cwd, questions.id, questions, state);
      record = `Record: ${relative(cwd, path)}`;
    } catch (e) {
      record = `No record was written (${e.message}).`;
    }
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ path: path && relative(cwd, path) }));
    report(answersFor(questions, state), record);
    if (flag("--keep")) submitted = false;
    else setTimeout(() => process.exit(EXIT.submitted), 300);
    return;
  }
  send(res, 404, "text/plain", "not found");
});

function listen(port, tries) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 0) listen(port + 1, tries - 1);
    else {
      console.error("[hus-visual-decision] " + String(e));
      process.exit(EXIT.error);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    const limit = timeoutMin ? `, gives up after ${timeoutMin} minutes` : "";
    console.error(`[hus-visual-decision] Decision page: ${url} (${questions.decisions.length} questions, waiting for the person to submit${limit})`);
    if (flag("--no-open")) return;
    const [cmd, ...pre] = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
    execFile(cmd, [...pre, url], (err) => {
      if (err) console.error(`[hus-visual-decision] Could not open a browser (${err.code || err.message}). Give the person this address: ${url}`);
    });
  });
}
// setTimeout overflows above about 24 days, so longer limits are capped there.
if (timeoutMin) setTimeout(() => !submitted && finish("timeout"), Math.min(timeoutMin * 60000, 2 ** 31 - 1));
listen(Number(opt("--port", 4747)), 20);
