#!/usr/bin/env node
// Checks a work plan against its ledger (the list of where every line of the plan comes from), and writes the
// plan's sources section from the ledger. Reads files only; it never changes material.
//
//   node ledger.mjs check <plan.md> <ledger.json> [--json]   FAIL lines break the plan, WARN lines need a look
//   node ledger.mjs sources <ledger.json> [--into <plan.md>] print the sources section, or replace it in the plan
//   node ledger.mjs text <file>                              print the text this script reads from a file
//
// Exit codes: 0 no FAIL, 1 FAIL found, 2 the command or a file could not be used.
// The ledger format is in ../references/ledger.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeT, pickLang } from "./i18n.mjs";

const PREFIX = "[hus-work-plan]";
const KINDS = ["material", "inference", "assumption"];
const READ = ["full", "partial", "unreadable"];

// ---------- text from a file ----------

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".log", ".eml", ".srt", ".vtt"]);
const HTML_EXT = new Set([".html", ".htm"]);
// Office files are zip archives of XML. These are the parts that hold the words, in reading order.
const ZIP_PARTS = {
  ".docx": /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/,
  ".pptx": /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/,
  ".xlsx": /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/,
  ".hwpx": /^Contents\/section\d+\.xml$/,
  ".odt": /^content\.xml$/,
  ".ods": /^content\.xml$/,
  ".odp": /^content\.xml$/,
};
const TEXTUTIL_EXT = new Set([".doc", ".rtf", ".rtfd", ".webarchive"]);

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// Paragraph, cell and line ends become spaces so words in different paragraphs do not run together.
export const xmlText = (xml) =>
  decode(
    xml
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(w:p|a:p|hp:p|text:p|text:h|si|row|c|p|div|li|tr|td|th|h\d)>|<(w:tab|w:br|br|hp:lineBreak)\b[^>]*\/?>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  );

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const byNumber = (a, b) => a.localeCompare(b, "en", { numeric: true });

// { text } or { why } when the words cannot be read by a program (an image, a scan, a format with no reader here).
export function extract(path) {
  if (!existsSync(path)) return { why: "file not found" };
  if (statSync(path).isDirectory()) return { why: "a folder, not a file: list each file as its own material" };
  const ext = extname(path).toLowerCase();
  try {
    if (TEXT_EXT.has(ext)) return { text: readFileSync(path, "utf8") };
    if (HTML_EXT.has(ext)) return { text: xmlText(readFileSync(path, "utf8")) };
    if (ext === ".pdf") {
      const text = run("pdftotext", ["-enc", "UTF-8", path, "-"]);
      return text.trim() ? { text } : { why: "the PDF has no text layer (a scan or an image)" };
    }
    if (ZIP_PARTS[ext]) {
      const parts = run("unzip", ["-Z1", path]).split("\n").filter((p) => ZIP_PARTS[ext].test(p)).sort(byNumber);
      if (!parts.length) return { why: "no text parts in the file" };
      return { text: parts.map((p) => xmlText(run("unzip", ["-p", path, p]))).join("\n") };
    }
    if (TEXTUTIL_EXT.has(ext)) return { text: run("textutil", ["-convert", "txt", "-stdout", path]) };
  } catch (e) {
    const tool = e.code === "ENOENT" ? ` (${e.path || "a reader"} is not installed)` : "";
    return { why: `could not read the file${tool}` };
  }
  return { why: `no reader for ${ext || "files without an extension"} (images and scans cannot be checked)` };
}

// Quotes are compared after these changes, so line breaks, curly quotes and Unicode forms do not count as differences.
export const normalize = (s) =>
  String(s)
    .normalize("NFC")
    .replace(/[­​-‍⁠﻿]/g, "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const squeeze = (s) => normalize(s).replace(/ /g, "");
// PDF text often breaks Korean words across lines, so a match without any spaces also counts.
export const contains = (text, quote) => normalize(text).includes(normalize(quote)) || squeeze(text).includes(squeeze(quote));

// ---------- ledger ----------

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${path}: ${e.message}`);
  }
}

const ids = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);

// Problems in the ledger itself, and in each quote against its material.
export function checkLedger(ledger, root) {
  const out = [];
  const fail = (msg) => out.push(["FAIL", msg]);
  const warn = (msg) => out.push(["WARN", msg]);
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) return [["FAIL", "the ledger is not a JSON object"]];
  const materials = Array.isArray(ledger.materials) ? ledger.materials : [];
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  if (!Array.isArray(ledger.materials)) fail("the ledger has no \"materials\" list");
  if (!Array.isArray(ledger.entries)) fail("the ledger has no \"entries\" list");

  const mats = new Map();
  for (const m of materials) {
    const id = m && m.id != null ? String(m.id) : "";
    if (!id) { fail("a material has no id"); continue; }
    if (mats.has(id)) fail(`material ${id} is listed twice`);
    if (!m.path) fail(`material ${id} has no path`);
    if (m.read != null && !READ.includes(m.read)) fail(`material ${id} has read "${m.read}"; use ${READ.join(", ")}`);
    const path = m.path ? (isAbsolute(m.path) ? m.path : resolve(root, m.path)) : "";
    const got = path ? extract(path) : { why: "no path" };
    if (got.why === "file not found") fail(`material ${id}: ${m.path} is not there`);
    else if (got.why && m.read !== "unreadable") warn(`material ${id} (${m.path}): ${got.why}. Its quotes cannot be checked; mark it "read": "unreadable" or "partial" and say so in the plan`);
    mats.set(id, { ...m, text: got.text });
  }

  const seen = new Set();
  for (const e of entries) {
    const id = e && e.id != null ? String(e.id) : "";
    if (!id) { fail("an entry has no id"); continue; }
    if (!/^\d+$/.test(id)) fail(`entry id "${id}" is not a number; the plan cites entries as [1], [2]`);
    if (seen.has(id)) fail(`entry ${id} is listed twice`);
    seen.add(id);
    if (!KINDS.includes(e.kind)) { fail(`entry ${id} has kind "${e.kind}"; use ${KINDS.join(", ")}`); continue; }
    if (e.kind === "material") {
      const m = mats.get(String(e.material));
      if (!m) { fail(`entry ${id} points to material "${e.material}", which is not listed`); continue; }
      if (!e.quote || !String(e.quote).trim()) { fail(`entry ${id} has no quote`); continue; }
      if (m.read === "unreadable") fail(`entry ${id} quotes material ${m.id}, which is marked unreadable`);
      else if (m.text != null && !contains(m.text, e.quote)) fail(`entry ${id}: the quote is not in ${m.path} word for word: "${String(e.quote).slice(0, 120)}"`);
    } else {
      if (!e.text || !String(e.text).trim()) fail(`entry ${id} (${e.kind}) has no text`);
    }
  }
  for (const e of entries) {
    if (!e || e.kind !== "inference") continue;
    const from = ids(e.from);
    if (!from.length) fail(`inference ${e.id} does not say what it is inferred from`);
    for (const f of from) if (!seen.has(f)) fail(`inference ${e.id} is inferred from entry ${f}, which is not listed`);
    if (from.includes(String(e.id))) fail(`inference ${e.id} is inferred from itself`);
  }
  return out;
}

// ---------- sources section ----------

const label = (m) => [m.what, m.path].filter(Boolean).join(", ");

export function sourcesSection(ledger) {
  const lang = pickLang(ledger.lang);
  const t = makeT(lang);
  const mats = new Map((ledger.materials || []).map((m) => [String(m.id), m]));
  const lines = [`## ${t("sources.heading")}`, "", t("sources.intro"), ""];
  const entries = [...(ledger.entries || [])].sort((a, b) => Number(a.id) - Number(b.id));
  for (const e of entries) {
    if (e.kind === "material") {
      const m = mats.get(String(e.material)) || { path: String(e.material) };
      const where = e.where ? t("sources.where", { where: e.where }) : "";
      lines.push(t("sources.material", { n: e.id, source: label(m), where, quote: normalize(e.quote) }));
    } else if (e.kind === "inference") {
      const from = ids(e.from).map((f) => `[${f}]`).join(", ");
      lines.push(t("sources.inference", { n: e.id, text: e.text, from, why: e.why ? ` ${e.why}` : "" }));
    } else if (e.kind === "assumption") {
      lines.push(t("sources.assumption", { n: e.id, text: e.text, why: e.why ? ` ${e.why}` : "" }));
    }
  }
  const unread = (ledger.materials || []).filter((m) => m.read === "unreadable" || m.read === "partial");
  if (unread.length) {
    lines.push("", `### ${t("sources.unread")}`, "");
    for (const m of unread) lines.push(t(`sources.read.${m.read}`, { source: label(m), note: m.note ? ` ${m.note}` : "" }));
  }
  return { lang, heading: `## ${t("sources.heading")}`, text: lines.join("\n") + "\n" };
}

// The sources section is the last section of the plan. Everything from its heading to the end is replaced.
export function withSources(plan, section) {
  const at = plan.split("\n").findIndex((l) => l.trim() === section.heading);
  const body = at < 0 ? plan.replace(/\s*$/, "\n\n") : plan.split("\n").slice(0, at).join("\n").replace(/\s*$/, "\n\n");
  return body + section.text;
}

// ---------- plan ----------

// Lines with a number (amounts, dates, counts) are where an invented fact does the most harm, so a line that has
// a digit and no [n] is reported. Step labels, list numbers and checkbox marks are not counted as numbers.
// Words for step labels differ by language, so they come from the language files ("plan.notNumbers"), English always included.
const NOT_A_FACT = [/^\s*#+\s.*$/, /^\s*\|?\s*:?-{3,}.*$/, /\[\d+(\s*,\s*\d+)*\]/g, /^\s*(\d+[.)]|[-*+])\s+/, /\[[ xX]\]/g];
const labelPatterns = (lang) => [...new Set(["en", lang].map((l) => makeT(l)("plan.notNumbers")))].map((src) => new RegExp(src, "giu"));

export function checkPlan(plan, ledger) {
  const out = [];
  const section = sourcesSection(ledger);
  const patterns = [...NOT_A_FACT, ...labelPatterns(section.lang)];
  const lines = plan.split("\n");
  const end = lines.findIndex((l) => l.trim() === section.heading);
  const body = end < 0 ? lines : lines.slice(0, end);
  const known = new Set((ledger.entries || []).map((e) => String(e.id)));
  const cited = new Set();
  let fence = false;
  body.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    for (const m of line.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
      for (const n of m[1].split(",").map((s) => s.trim())) {
        cited.add(n);
        if (!known.has(n)) out.push(["FAIL", `line ${i + 1} cites [${n}], which is not in the ledger`]);
      }
    }
    if (fence) return; // prompts are instructions to an AI, not claims; their facts are checked where the plan states them
    const rest = patterns.reduce((s, re) => s.replace(re, " "), line);
    if (/\d/.test(rest) && !/\[\d+/.test(line)) out.push(["WARN", `line ${i + 1} has a number but no source: ${line.trim().slice(0, 100)}`]);
  });
  if (end < 0) out.push(["FAIL", `the plan has no "${section.heading}" section; run: ledger.mjs sources <ledger> --into <plan>`]);
  else if (lines.slice(end).join("\n").trim() !== section.text.trim()) out.push(["FAIL", "the sources section differs from the ledger; run: ledger.mjs sources <ledger> --into <plan>"]);
  for (const id of known) if (!cited.has(id)) out.push(["WARN", `entry ${id} is in the ledger but the plan never cites it`]);
  return out;
}

// ---------- command line ----------

function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name) => {
    const i = rest.indexOf(name);
    if (i < 0) return null;
    const v = rest[i + 1];
    rest.splice(i, 2);
    return v ?? "";
  };
  const asJson = rest.includes("--json");
  if (asJson) rest.splice(rest.indexOf("--json"), 1);
  const usage = () => {
    console.error(`${PREFIX} usage: ledger.mjs check <plan.md> <ledger.json> [--json] | sources <ledger.json> [--into <plan.md>] | text <file>`);
    return 2;
  };
  try {
    if (cmd === "text") {
      if (rest.length !== 1) return usage();
      const got = extract(resolve(rest[0]));
      if (got.why) { console.error(`${PREFIX} ${rest[0]}: ${got.why}`); return 2; }
      process.stdout.write(got.text.endsWith("\n") ? got.text : got.text + "\n");
      return 0;
    }
    if (cmd === "sources") {
      const into = flag("--into");
      if (rest.length !== 1 || into === "") return usage();
      const ledger = loadJson(rest[0]);
      const section = sourcesSection(ledger);
      if (into == null) { process.stdout.write(section.text); return 0; }
      writeFileSync(into, withSources(readFileSync(into, "utf8"), section));
      console.error(`${PREFIX} Wrote the sources section into ${into} (${(ledger.entries || []).length} entries).`);
      return 0;
    }
    if (cmd === "check") {
      if (rest.length !== 2) return usage();
      const [planPath, ledgerPath] = rest;
      const ledger = loadJson(ledgerPath);
      const root = ledger.root ? resolve(ledger.root) : process.cwd();
      const found = checkLedger(ledger, root);
      if (!found.some(([lvl, msg]) => lvl === "FAIL" && /not a JSON object|no "(materials|entries)"/.test(msg))) found.push(...checkPlan(readFileSync(planPath, "utf8"), ledger));
      const fails = found.filter(([l]) => l === "FAIL").length;
      const warns = found.length - fails;
      if (asJson) console.log(JSON.stringify({ fails, warns, found: found.map(([level, message]) => ({ level, message })) }, null, 2));
      else {
        for (const [lvl, msg] of found) console.log(`${PREFIX} ${lvl} ${msg}`);
        console.log(`${PREFIX} ${fails ? `${fails} FAIL, ${warns} WARN.` : `No FAIL${warns ? `, ${warns} WARN to look at` : ""}. Every quote is in its material word for word.`}`);
      }
      return fails ? 1 : 0;
    }
    return usage();
  } catch (e) {
    console.error(`${PREFIX} ${e.message}`);
    return 2;
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) process.exitCode = main(process.argv.slice(2));
