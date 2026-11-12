// Builds the decision record (markdown) and the summary Claude reads, from the questions and the answers.
// Used by the server and by the record hook.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
// Text fields are plain text. Escape angle brackets so a label like <Button> stays visible in Markdown.
const strip = (s) => String(s ?? "").replace(/[<>]/g, "\\$&");

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v ? v : undefined);

// Keeps only answers that match the questions: known option keys, item ids and stop values.
// A stale or hand-made state (for example an option key from an earlier version of the question file) is dropped, not trusted.
export function cleanState(q, S) {
  const out = {};
  if (!isObj(S)) return out;
  for (const d of q.decisions || []) {
    const a = S[d.id];
    if (!isObj(a)) continue;
    const c = {};
    // A decision marked noDelegate (hard to undo) cannot be handed to Claude; that answer is dropped.
    if (REASON_KEYS.includes(a.defer) && !(a.defer === "delegate" && d.noDelegate)) {
      c.defer = a.defer;
      if (str(a.why)) c.why = a.why;
    } else if (d.type === "pick" || d.type === "preview") {
      if ((d.options || []).some((o) => o.key === a.choice)) c.choice = a.choice;
    } else if (d.type === "multi") {
      if (Array.isArray(a.choices)) c.choices = (d.items || []).map((i) => i.id).filter((id) => a.choices.includes(id));
    } else if (d.type === "batch") {
      if (isObj(a.choices)) {
        c.choices = {};
        for (const i of d.items || []) if ((i.options || []).some((o) => o.key === a.choices[i.id])) c.choices[i.id] = a.choices[i.id];
      }
    } else if (d.type === "value") {
      if ((d.stops || []).some((s) => s.v === a.choice)) c.choice = a.choice;
    }
    if (str(a.note)) c.note = a.note;
    if (Object.keys(c).length) out[d.id] = c;
  }
  return out;
}

// Whether a cleaned answer settles the question.
export function isDone(d, a) {
  if (!a) return false;
  if (a.defer) return true;
  if (d.type === "batch") return !!a.choices && (d.items || []).every((i) => a.choices[i.id] != null);
  if (d.type === "multi") return Array.isArray(a.choices);
  return a.choice != null;
}

// One decision as record lines: what was chosen, the differences that backed it, and what was not chosen.
function lines(d, a, t) {
  const B = (key) => `**${t(key)}:**`;
  const rec = (o) => (o.rec ? t("rec.recommended") : "");
  const L = [];
  if (!isDone(d, a)) return [`- ${B("rec.undecided")} ${t("rec.noAnswer")}`];
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

export const supersededIds = (q) => [].concat(q?.supersedes ?? []).filter((x) => typeof x === "string" && x);

// links: { <earlier batch id>: <relative path to its record> } for the ones that were found.
export function buildRecord(q, state, at, links = {}) {
  const S = cleanState(q, state);
  const t = makeT(pickLang(q.lang));
  const ds = q.decisions;
  const back = ds.filter((d) => S[d.id]?.defer).length;
  const L = [`# ${q.title || t("rec.title")} · ${day(at)}`, "", t("rec.summary", { done: ds.length - back, total: ds.length, back }), ""];
  const prev = supersededIds(q).map((id) => (links[id] ? `[${id}](${links[id]})` : `\`${id}\``));
  if (prev.length) L.push(`> ${t("rec.supersedes", { list: prev.join(", ") })}`, "");
  ds.forEach((d, i) => L.push(`## ${i + 1}. ${strip(d.q)}`, "", ...lines(d, S[d.id], t), ""));
  return L.join("\n");
}

// The answers Claude reads: per question id, the chosen value, why it was sent back, and any note.
export function answersFor(q, state) {
  const S = cleanState(q, state);
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

const readSession = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// The latest recorded batch with this id, as an absolute record path.
function recordOf(cwd, dir, id) {
  let best = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const s = readSession(join(dir, f));
    if (s?.id !== id || !s.recordPath) continue;
    const path = join(cwd, s.recordPath);
    if (existsSync(path) && (!best || String(s.answeredAt) > best.at)) best = { at: String(s.answeredAt), path };
  }
  return best?.path ?? null;
}

// Finds answered batches that have no record yet and writes them as documents. Returns the paths written.
// Files are handled in name order (they start with a time stamp), so an earlier batch is recorded before one that supersedes it.
export function writePending(cwd) {
  const dir = join(cwd, DATA_DIR, "answers");
  if (!existsSync(dir)) return [];
  const written = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const file = join(dir, f);
    const s = readSession(file);
    if (!s || s.recordedAt || !s.questions || !Array.isArray(s.questions.decisions) || !s.state) continue;
    // One broken answer file must not stop the others from being recorded.
    try {
      const t = makeT(pickLang(s.questions.lang));
      const out = recordDir(cwd);
      mkdirSync(out, { recursive: true });
      const path = recordPathFor(cwd, s);
      const earlier = {};
      for (const id of supersededIds(s.questions)) {
        const old = recordOf(cwd, dir, id);
        if (old) earlier[id] = old;
      }
      const links = Object.fromEntries(Object.entries(earlier).map(([id, p]) => [id, relative(dirname(path), p)]));
      writeFileSync(path, buildRecord(s.questions, s.state, s.answeredAt, links));
      // The earlier record points forward to this one, so reading either shows the chain.
      for (const old of Object.values(earlier)) {
        appendFileSync(old, `\n> ${t("rec.supersededBy", { link: `[${s.id} · ${day(s.answeredAt)}](${relative(dirname(old), path)})` })}\n`);
      }
      const index = join(out, "README.md");
      if (!existsSync(index)) writeFileSync(index, `# ${t("rec.idx.title")}\n\n${t("rec.idx.intro")}\n\n`);
      appendFileSync(index, `- ${day(s.answeredAt)} · [${strip(s.questions.title || s.id)}](${relative(out, path)}) · ${t("rec.idx.line", { n: s.questions.decisions.length })}\n`);
      s.recordedAt = new Date().toISOString();
      s.recordPath = relative(cwd, path);
      writeFileSync(file, JSON.stringify(s, null, 1));
      written.push(s.recordPath);
    } catch (e) {
      console.error(`[hus-visual-decision] Could not record ${f}: ${e.message}`);
    }
  }
  return written;
}
