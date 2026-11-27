// Writes a submitted batch as one Markdown file, <project>/.hus-visual-decision/decisions/<date>-<name>.md, so it can be looked up later.
// <project> is the git root above the working directory, or the working directory when there is none.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { makeT } from "./i18n.mjs";
import { cleanState, recommended, undoOf } from "./answers.mjs";

export function projectDir(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return resolve(cwd);
  }
}

const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Plain text: keep angle brackets visible in Markdown.
const esc = (s) => String(s ?? "").replace(/[<>]/g, "\\$&");
const label = (list, key) => (list || []).find((o) => o.key === key)?.label ?? key;

// The lines for one question: what was chosen and what was not, or why it was sent back.
function lines(d, a = {}, t) {
  const B = (k) => `- **${t(k)}:**`;
  const L = [];
  const rec = (o) => (o?.rec ? ` (${t("pick.rec")})` : "");
  if (a.defer) {
    L.push(`${B("rec.answer")} ${t("ans.sentBack", { reason: t(`reason.${a.defer}.title`) })}`);
    if (a.defer === "delegate") {
      const r = recommended(d);
      L.push(`- ${r == null ? t("rec.noRec") : t("rec.delegated", { x: esc(text(d, r)) })}`);
    }
    if (a.why) L.push(`${B("sum.reason")} ${esc(a.why)}`);
  } else if (d.type === "pick" || d.type === "preview") {
    const o = d.options.find((x) => x.key === a.choice);
    L.push(`${B("rec.answer")} ${o ? esc(o.label) + rec(o) : esc(t("ans.own", { x: a.own }))}`);
    const rest = d.options.filter((x) => x !== o).map((x) => esc(x.label));
    if (rest.length) L.push(`${B("rec.rejected")} ${rest.join(", ")}`);
  } else if (d.type === "multi") {
    const inn = d.items.filter((i) => a.choices.includes(i.id)).map((i) => esc(i.label));
    const out = d.items.filter((i) => !a.choices.includes(i.id)).map((i) => esc(i.label));
    L.push(`${B("rec.answer")} ${inn.join(", ") || t("ans.nothing")}`);
    if (out.length) L.push(`${B("rec.rejected")} ${out.join(", ")}`);
  } else if (d.type === "batch") {
    for (const i of d.items) L.push(`- **${esc(i.q)}:** ${esc(label(i.options, a.choices[i.id]))}`);
  } else if (d.type === "value") {
    L.push(`${B("rec.answer")} ${esc(text(d, a.choice))}`);
  }
  if (!a.defer) L.push(...extra(d, a, t, B));
  else if (a.defer === "delegate" && d.recNote?.if) L.push(`${B("rec.by")} ${esc(d.recNote.if)}`);
  if (a.note) L.push(`${B("sum.note")} ${esc(a.note)}`);
  return L;
}
// For a settled answer: what it does, how it compares with the recommendation, what decided it, how to undo it,
// how to check that it worked and what comes next. Each line only when the question file says it.
function extra(d, a, t, B) {
  const L = [];
  const opt = (d.type === "pick" || d.type === "preview") && !a.own ? d.options.find((x) => x.key === a.choice) : null;
  const stop = d.type === "value" ? d.stops.find((s) => s.v === a.choice) : null;
  const src = opt || stop || {};
  if (src.means) L.push(`${B("rec.means")} ${esc(src.means)}`);
  const r = recommended(d);
  const mine = a.own ? null : a.choices ?? a.choice;
  if (r != null && mine != null) {
    const same = JSON.stringify(r) === JSON.stringify(mine);
    const conf = d.recNote?.conf ? ` · ${t(`conf.${d.recNote.conf}`)}` : "";
    L.push(`${B("rec.ai")} ${same ? t("rec.aiSame") : t("rec.aiDiff", { x: esc(text(d, r)) })}${conf}`);
  }
  if (a.decisive) L.push(`${B("rec.decisive")} ${a.decisive.map(esc).join(", ")}`);
  const u = undoOf(opt?.undo) || undoOf(d.undo);
  if (u && ["easy", "costly", "none"].includes(u.level)) L.push(`${B("rec.undo")} ${t(`undo.${u.level}`)}${u.how ? ` · ${esc(u.how)}` : ""}`);
  if (src.check) L.push(`${B("rec.check")} ${esc(src.check)}`);
  if (src.next) L.push(`${B("rec.next")} ${esc(src.next)}`);
  return L;
}
// An answer value in words.
function text(d, v) {
  if (d.type === "pick" || d.type === "preview") return label(d.options, v);
  // The unit follows the number as written: " days" keeps a space, "%" does not.
  if (d.type === "value") return `${v}${d.unit || ""}`.trim();
  if (d.type === "multi") return d.items.filter((i) => v.includes(i.id)).map((i) => i.label).join(", ");
  if (d.type === "batch") return d.items.map((i) => `${i.q}: ${label(i.options, v[i.id])}`).join(" / ");
  return JSON.stringify(v);
}

export function buildRecord(q, state, at = new Date()) {
  const S = cleanState(q, state);
  const t = makeT(q.lang || "en");
  const L = [`# ${esc(q.title || t("nav.title"))} · ${day(at)}`, ""];
  q.decisions.forEach((d, i) => L.push(`## ${i + 1}. ${esc(d.q)}`, "", ...lines(d, S[d.id], t), ""));
  return L.join("\n");
}

// Writes the record and returns its path. A record with the same date and name gets a number, not overwritten.
export function writeRecord(cwd, name, q, state, at = new Date()) {
  const dir = join(projectDir(cwd), ".hus-visual-decision", "decisions");
  mkdirSync(dir, { recursive: true });
  const slug = String(name).replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^[-.]+|-+$/g, "") || "decisions";
  const base = join(dir, `${day(at)}-${slug}`);
  let path = `${base}.md`;
  for (let n = 2; existsSync(path); n++) path = `${base}-${n}.md`;
  writeFileSync(path, buildRecord(q, state, at));
  return path;
}
