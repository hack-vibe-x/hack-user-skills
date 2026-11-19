// Checks a question file before the page opens, so a missing value is reported with where to fix it
// instead of a blank page or a crash after the person has answered.
import { existsSync, realpathSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { languages, pickLang } from "./i18n.mjs";
import { cleanState, isDone } from "./answers.mjs";

// Image files the page can show: a known image type, inside the working directory or a temp directory.
// A relative path starts at the working directory.
export const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
export function imageFile(cwd, path) {
  if (typeof path !== "string" || !path) return null;
  const abs = resolve(cwd, path);
  if (!existsSync(abs) || !IMAGE_TYPES[extname(abs).toLowerCase()]) return null;
  const real = realpathSync(abs);
  const roots = [cwd, "/private/tmp", "/tmp"].filter(existsSync).map((r) => realpathSync(r));
  return roots.some((r) => real === r || real.startsWith(r + sep)) ? real : null;
}

const dupes = (list) => list.filter((x, i) => x != null && list.indexOf(x) !== i);
// Keys and ids go through the page as text, so they must be text here too ("1", not 1).
const text = (v) => typeof v === "string" && v !== "";
const pairs = (v) => Array.isArray(v) && v.every((x) => Array.isArray(x) && x.length >= 1 && x.length <= 2);

const VISUALS = ["screen", "button", "grid", "steps", "image", "html", "diff", "timeline", "impact", "story", "odds", "blast"];
const num = (v) => v != null && v !== "" && Number.isFinite(+v);
const LEVELS = ["easy", "costly", "none"];
const CONF = ["high", "mid", "low"];

function checkVisual(v, at, p, cwd, depth = 0) {
  if (v == null) return;
  if (typeof v !== "object") return p.push(`${at} visual must be an object`);
  if (v.type === "steps" && (!Array.isArray(v.steps) || !v.steps.length)) p.push(`${at} a steps visual needs a steps array`);
  if (v.type === "grid" && !(+v.cols > 0)) p.push(`${at} a grid visual needs cols (a number above 0)`);
  if (v.type === "image" && !v.src) p.push(`${at} an image visual needs src`);
  else if (v.type === "image" && cwd && !imageFile(cwd, v.src))
    p.push(`${at} image "${v.src}" cannot be shown: it must be a ${Object.keys(IMAGE_TYPES).join(" ")} file inside the working directory or /tmp (a relative path starts at the working directory)`);
  if (v.type === "steps" && v.reach != null && !Number.isFinite(+v.reach)) p.push(`${at} steps reach must be a number`);
  if (v.type === "html" && typeof v.html !== "string") p.push(`${at} an html visual needs html (a string)`);
  if (v.type === "diff") {
    if (!v.before || typeof v.before !== "object") p.push(`${at} a diff visual needs before (a visual)`);
    if (v.text != null && !(Array.isArray(v.text) && v.text.length === 2)) p.push(`${at} diff text must be [before, after]`);
    if (depth < 2) ["before", "after"].forEach((k) => checkVisual(v[k], `${at}.${k}`, p, cwd, depth + 1));
  }
  if (v.type === "timeline") {
    if (!(+v.max > 0)) p.push(`${at} a timeline needs max (the end of the axis, above 0)`);
    if (!Array.isArray(v.lanes) || !v.lanes.length || v.lanes.some((l) => !Array.isArray(l?.items) || l.items.some((i) => !num(i?.from) || !num(i?.to))))
      p.push(`${at} a timeline needs lanes, each with items that have from and to numbers`);
    if (v.pnr != null && !num(v.pnr)) p.push(`${at} timeline pnr must be a number`);
  }
  if (v.type === "impact" && (!v.center || !Array.isArray(v.rings) || v.rings.some((r) => !Array.isArray(r) || r.some((n) => !n?.l))))
    p.push(`${at} an impact visual needs center and rings (lists of { l, t })`);
  if (v.type === "story") {
    if (!Array.isArray(v.panels) || !v.panels.length || v.panels.some((x) => !x || typeof x !== "object")) p.push(`${at} a story visual needs panels ({ caption, visual })`);
    else if (depth < 2) v.panels.forEach((x, i) => checkVisual(x.visual, `${at}.panels[${i}]`, p, cwd, depth + 1));
  }
  if (v.type === "odds" && (!num(v.hit) || (v.of != null && !(+v.of > 0)) || (v.lo != null && !num(v.lo)) || (v.hi != null && !num(v.hi))))
    p.push(`${at} an odds visual needs hit (and of, lo, hi as numbers when given)`);
  if (v.type === "blast" && ["add", "change", "del"].some((k) => v[k] != null && !num(v[k]))) p.push(`${at} blast add, change and del must be numbers`);
  if (v.notes != null && (!Array.isArray(v.notes) || v.notes.some((n) => !n || !Array.isArray(n.at) || n.at.length !== 2 || !n.at.every(num) || (n.dim != null && !Number.isInteger(n.dim)))))
    p.push(`${at} notes must be a list of { at: [x%, y%], text, dim (row index) }`);
  if (v.focus != null && !(Array.isArray(v.focus) && v.focus.length === 4 && v.focus.every(num))) p.push(`${at} focus must be [x%, y%, width%, height%]`);
  if (!VISUALS.includes(v.type)) p.push(`${at} visual type must be one of ${VISUALS.join(", ")}`);
}
// undo is a level ("easy" | "costly" | "none") or { level, how }.
function checkUndo(u, at, p) {
  if (u == null) return;
  const level = typeof u === "string" ? u : u && typeof u === "object" ? u.level : undefined;
  if (!LEVELS.includes(level)) p.push(`${at} undo must be "easy", "costly" or "none" (or { level, how })`);
}
// A comparison cell: [value, mark] or { v, t, n, lo, hi, conf, why }.
function badCell(c) {
  if (Array.isArray(c)) return !["good", "bad", "", undefined].includes(c[1]);
  if (!c || typeof c !== "object" || c.v == null) return true;
  if (!["good", "bad", "", undefined].includes(c.t) || (c.conf != null && !CONF.includes(c.conf))) return true;
  return ["n", "lo", "hi"].some((k) => c[k] != null && !num(c[k]));
}

// cwd (optional) also checks that image files can be served from there.
export function check(q, { cwd } = {}) {
  const p = [];
  if (!q || typeof q !== "object") return ["the file must hold a JSON object"];
  if (q.lang != null && pickLang(q.lang) === "en" && !/^en\b/i.test(String(q.lang)))
    p.push(`lang "${q.lang}" has no locales file; use one of ${languages().join(", ")}, or leave lang out`);
  if (!Array.isArray(q.decisions) || !q.decisions.length) return [...p, "decisions is empty"];
  const ids = new Set();
  if (q.themes != null && (!Array.isArray(q.themes) || q.themes.some((x) => !text(x?.id) || !x.label))) p.push("themes must be a list of { id, label, desc }");
  const themeIds = new Set(Array.isArray(q.themes) ? q.themes.map((x) => x?.id) : []);
  for (const d of q.decisions) {
    const at = `[${d?.id ?? "no id"}]`;
    if (!d || typeof d !== "object") {
      p.push(`${at} each decision must be an object`);
      continue;
    }
    if (!d.id || ids.has(d.id)) p.push(`${at} id is missing or duplicated`);
    ids.add(d.id);
    if (!d.q) p.push(`${at} q (the one-line question) is missing`);
    if (d.noDelegate != null && typeof d.noDelegate !== "boolean") p.push(`${at} noDelegate must be true or false`);
    if (d.ownAnswer != null && typeof d.ownAnswer !== "boolean") p.push(`${at} ownAnswer must be true or false`);
    if (d.facts != null && !pairs(d.facts)) p.push(`${at} facts must be a list of [label, value] pairs`);
    if (d.terms != null && !pairs(d.terms)) p.push(`${at} terms must be a list of [word, meaning] pairs`);
    checkUndo(d.undo, at, p);
    if (d.recNote != null && (typeof d.recNote !== "object" || (d.recNote.conf != null && !CONF.includes(d.recNote.conf))))
      p.push(`${at} recNote must be { if, conf: "high" | "mid" | "low", why }`);
    if (d.panels != null) {
      if (!Array.isArray(d.panels) || d.panels.some((x) => !x || typeof x !== "object" || !x.title)) p.push(`${at} panels must be a list of { title, text or visual }`);
      else d.panels.forEach((x, i) => checkVisual(x.visual, `${at}.panels[${i}]`, p, cwd));
    }
    if (d.themes != null && (!Array.isArray(d.themes) || d.themes.some((id) => !themeIds.has(id)))) p.push(`${at} themes must list ids from the top-level themes`);
    if (d.type === "preview" && d.preview != null) {
      if (typeof d.preview !== "object" || (d.preview.html != null && typeof d.preview.html !== "string")) p.push(`${at} preview must be an object whose html is a string`);
      else if (d.preview.height != null && !(+d.preview.height > 0)) p.push(`${at} preview height must be a number above 0`);
    }
    if (d.type === "pick" || d.type === "preview") {
      if (!Array.isArray(d.options) || !d.options.length || d.options.some((o) => !text(o?.key) || !o.label)) p.push(`${at} every option needs a key (text) and a label`);
      else {
        if (dupes(d.options.map((o) => o.key)).length) p.push(`${at} option keys must be unique`);
        if (d.options.filter((o) => o.rec).length > 1) p.push(`${at} only one option can be rec`);
        if (d.type === "pick" && d.dims != null && (!Array.isArray(d.dims) || d.dims.some((x) => typeof x !== "string" && !(x && typeof x === "object" && x.q))))
          p.push(`${at} dims must be a list of row names (text, or { q, short, now, max })`);
        else if (d.type === "pick" && d.options.some((o) => (o.d || []).length !== (d.dims || []).length)) p.push(`${at} an option has a different number of d cells than dims`);
        else if (d.type === "pick" && d.options.some((o) => (o.d || []).some(badCell)))
          p.push(`${at} each d cell must be [value, "good" | "bad" | ""] or { v, t, n, lo, hi, conf: "high" | "mid" | "low", why }`);
        d.options.forEach((o) => {
          checkVisual(o.visual, `${at}[${o.key}]`, p, cwd);
          checkUndo(o.undo, `${at}[${o.key}]`, p);
          if (o.after != null && !(Array.isArray(o.after) && o.after.every((x) => typeof x === "string"))) p.push(`${at}[${o.key}] after must be a list of short texts`);
          if (o.detail != null) {
            if (typeof o.detail !== "object" || (o.detail.evidence != null && !pairs(o.detail.evidence))) p.push(`${at}[${o.key}] detail must be { evidence: [[kind, text]], prereq, confusion, visual }`);
            else checkVisual(o.detail.visual, `${at}[${o.key}].detail`, p, cwd);
          }
        });
      }
    } else if (d.type === "multi") {
      if (!Array.isArray(d.items) || !d.items.length || d.items.some((i) => !text(i?.id) || !i.label)) p.push(`${at} every item needs an id (text) and a label`);
      else if (dupes(d.items.map((i) => i.id)).length) p.push(`${at} item ids must be unique`);
      else d.items.forEach((i) => checkVisual(i.visual, `${at}[${i.id}]`, p, cwd));
    } else if (d.type === "batch") {
      if (!Array.isArray(d.items) || !d.items.length || d.items.some((i) => !text(i?.id) || !i.q || !Array.isArray(i.options) || !i.options.length)) p.push(`${at} every item needs an id (text), a q and options`);
      else {
        if (dupes(d.items.map((i) => i.id)).length) p.push(`${at} item ids must be unique`);
        for (const i of d.items) {
          if (i.options.some((o) => !text(o?.key) || !o.label)) p.push(`${at}[${i.id}] every option needs a key (text) and a label`);
          else if (dupes(i.options.map((o) => o.key)).length) p.push(`${at}[${i.id}] option keys must be unique`);
        }
      }
    } else if (d.type === "value") {
      if (!Array.isArray(d.stops) || !d.stops.length || d.stops.some((s) => s?.v == null)) p.push(`${at} every stop needs a v`);
      else if (dupes(d.stops.map((s) => s.v)).length) p.push(`${at} stop values must be unique`);
      else if (d.stops.some((s) => s.outs != null && (!Array.isArray(s.outs) || s.outs.some((o) => !o || typeof o !== "object")))) p.push(`${at} outs must be a list of { k, v } objects`);
      else d.stops.forEach((s) => (s.outs || []).forEach((o) => o.odds != null && checkVisual({ ...o.odds, type: "odds" }, `${at}[${s.v}].${o.k}`, p, cwd)));
      const v = d.values;
      if (v != null && (typeof v !== "object" || !Array.isArray(v.labels) || !Array.isArray(v.map) || v.labels.length !== v.map.length || v.map.some((i) => !Number.isInteger(i) || i < 0 || i >= (d.stops || []).length)))
        p.push(`${at} values must be { q, left, right, labels, map } with one stop index in map per label`);
    } else p.push(`${at} type must be one of pick, preview, multi, batch, value`);
  }
  return p;
}

// Ids of questions a submitted state leaves unsettled. The page only enables submit when this is empty.
export function unanswered(q, state) {
  const S = cleanState(q, state);
  return q.decisions.filter((d) => !isDone(d, S[d.id])).map((d) => d.id);
}
