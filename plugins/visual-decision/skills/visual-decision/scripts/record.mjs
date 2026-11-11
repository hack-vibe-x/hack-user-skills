// Builds the decision record (markdown) and the summary Claude reads, from the questions and the answers.
// Used by the server and by the record hook.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { makeT, pickLang } from "./i18n.mjs";

export const REASON_KEYS = ["info", "options", "delegate"];

export const day = (iso) => {
  const t = iso ? new Date(iso) : new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

function contrast(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return null;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05);
}
const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "");

// One decision as record lines: what was chosen, the differences that backed it, and what was not chosen.
function lines(d, a, t) {
  const B = (key) => `**${t(key)}:**`;
  const rec = (o) => (o.rec ? t("rec.recommended") : "");
  const L = [];
  if (!a) return [`- ${B("rec.undecided")} ${t("rec.noAnswer")}`];
  if (a.defer) {
    L.push(`- ${B("rec.undecided")} ${t(`reason.${a.defer}.title`)} → ${t(`reason.${a.defer}.desc`)}`);
    if (a.why) L.push(`- ${B("rec.reason")} ${a.why}`);
  } else if (d.type === "pick") {
    const o = d.options.find((x) => x.key === a.choice);
    const dims = d.dims || [];
    L.push(`- ${B("rec.decision")} ${strip(o.label)}${rec(o)}`);
    if (dims.length) L.push(`- ${B("rec.basis")} ${dims.map((k, j) => `${k} ${strip((o.d || [])[j]?.[0])}`).join(" / ")}`);
    for (const x of d.options) {
      if (x === o) continue;
      const bad = dims.map((k, j) => ((x.d || [])[j]?.[1] === "bad" ? `${k} ${strip(x.d[j][0])}` : "")).filter(Boolean);
      L.push(`- ${B("rec.rejected")} ${strip(x.label)}${bad.length ? " — " + bad.join(", ") : ""}`);
    }
  } else if (d.type === "preview") {
    const o = d.options.find((x) => x.key === a.choice);
    const c = contrast(o.color);
    L.push(`- ${B("rec.decision")} ${strip(o.label)}${o.color ? ` \`${o.color}\`` : ""}${rec(o)}`);
    L.push(`- ${B("rec.basis")} ${[o.desc, c ? t("rec.contrast", { r: c.toFixed(1) }) : ""].filter(Boolean).join(", ")}`);
    for (const x of d.options) {
      if (x === o) continue;
      const cx = contrast(x.color);
      L.push(`- ${B("rec.rejected")} ${strip(x.label)} — ${[x.desc, cx ? t("rec.contrastShort", { r: cx.toFixed(1) }) : ""].filter(Boolean).join(", ")}`);
    }
  } else if (d.type === "multi") {
    const u = d.unit || "";
    const cost = (x) => (x.cost != null ? ` ${x.cost}${u}` : "");
    const inn = d.items.filter((x) => a.choices.includes(x.id));
    const out = d.items.filter((x) => !a.choices.includes(x.id));
    const tot = inn.reduce((s, x) => s + (x.cost || 0), 0);
    L.push(`- **${t("rec.included")}${d.budget != null ? ` (${tot}${u} / ${d.budget}${u})` : ""}:** ${inn.map((x) => strip(x.label) + cost(x)).join(", ") || t("rec.none")}`);
    L.push(`- ${B("rec.excluded")} ${out.map((x) => strip(x.label) + cost(x)).join(", ") || t("rec.none")}`);
  } else if (d.type === "batch") {
    for (const x of d.items) {
      const o = x.options.find((y) => y.key === a.choices[x.id]);
      L.push(`- **${strip(x.q)}:** ${strip(o.label)}${o.sub ? " — " + strip(o.sub) : ""}${rec(o)}`);
    }
  } else if (d.type === "value") {
    const s = d.stops.find((x) => x.v === a.choice);
    L.push(`- ${B("rec.decision")} ${a.choice} ${d.unit || ""}`.trimEnd());
    if (s?.outs?.length) L.push(`- ${B("rec.atValue")} ${s.outs.map((o) => `${o.k} ${o.v}`).join(" / ")}`);
  }
  if (a.note) L.push(`- ${B("rec.note")} ${a.note}`);
  return L;
}

export function buildRecord(q, S, at) {
  const t = makeT(pickLang(q.lang));
  const ds = q.decisions;
  const back = ds.filter((d) => S[d.id]?.defer).length;
  const L = [`# ${q.title || t("rec.title")} · ${day(at)}`, "", t("rec.summary", { done: ds.length - back, total: ds.length, back }), ""];
  ds.forEach((d, i) => L.push(`## ${i + 1}. ${strip(d.q)}`, "", ...lines(d, S[d.id], t), ""));
  return L.join("\n");
}

// The answers Claude reads: per question id, the chosen value, why it was sent back, and any note.
export function answersFor(q, S) {
  const out = {};
  for (const d of q.decisions) {
    const a = S[d.id] || {};
    out[d.id] = a.defer
      ? { choice: null, handBack: a.defer, ...(a.why ? { why: a.why } : {}), ...(a.note ? { note: a.note } : {}) }
      : { choice: a.choices ?? a.choice ?? null, ...(a.note ? { note: a.note } : {}) };
  }
  return out;
}

// Per-project data folder (settings, pending question files, answer files). See the naming policy: hus-<name>.
export const DATA_DIR = ".hus-visual-decision";

export function config(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, DATA_DIR, "config.json"), "utf8"));
  } catch {
    return {};
  }
}
export const recordDir = (cwd) => join(cwd, config(cwd).recordDir || "docs/decisions");
// If a record with the same date and name exists, add a number instead of overwriting it.
export function recordPathFor(cwd, session) {
  const base = join(recordDir(cwd), `${day(session.answeredAt)}-${session.id}`);
  let path = `${base}.md`;
  for (let n = 2; existsSync(path); n++) path = `${base}-${n}.md`;
  return path;
}

// Finds answered batches that have no record yet and writes them as documents. Returns the paths written.
export function writePending(cwd) {
  const dir = join(cwd, DATA_DIR, "answers");
  if (!existsSync(dir)) return [];
  const written = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const file = join(dir, f);
    let s;
    try {
      s = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (s.recordedAt || !s.questions || !s.state) continue;
    const t = makeT(pickLang(s.questions.lang));
    const out = recordDir(cwd);
    mkdirSync(out, { recursive: true });
    const path = recordPathFor(cwd, s);
    writeFileSync(path, buildRecord(s.questions, s.state, s.answeredAt));
    const index = join(out, "README.md");
    if (!existsSync(index)) writeFileSync(index, `# ${t("rec.idx.title")}\n\n${t("rec.idx.intro")}\n\n`);
    appendFileSync(index, `- ${day(s.answeredAt)} · [${s.questions.title || s.id}](${relative(out, path)}) · ${t("rec.idx.line", { n: s.questions.decisions.length })}\n`);
    s.recordedAt = new Date().toISOString();
    s.recordPath = relative(cwd, path);
    writeFileSync(file, JSON.stringify(s, null, 1));
    written.push(s.recordPath);
  }
  return written;
}
