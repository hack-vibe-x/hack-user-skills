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

function checkVisual(v, at, p, cwd) {
  if (v == null) return;
  if (typeof v !== "object") return p.push(`${at} visual must be an object`);
  if (v.type === "steps" && (!Array.isArray(v.steps) || !v.steps.length)) p.push(`${at} a steps visual needs a steps array`);
  if (v.type === "grid" && !(+v.cols > 0)) p.push(`${at} a grid visual needs cols (a number above 0)`);
  if (v.type === "image" && !v.src) p.push(`${at} an image visual needs src`);
  else if (v.type === "image" && cwd && !imageFile(cwd, v.src))
    p.push(`${at} image "${v.src}" cannot be shown: it must be a ${Object.keys(IMAGE_TYPES).join(" ")} file inside the working directory or /tmp (a relative path starts at the working directory)`);
  if (v.type === "steps" && v.reach != null && !Number.isFinite(+v.reach)) p.push(`${at} steps reach must be a number`);
  if (v.type === "html" && typeof v.html !== "string") p.push(`${at} an html visual needs html (a string)`);
  if (!["screen", "button", "grid", "steps", "image", "html"].includes(v.type)) p.push(`${at} visual type must be one of screen, button, grid, steps, image, html`);
}

// cwd (optional) also checks that image files can be served from there.
export function check(q, { cwd } = {}) {
  const p = [];
  if (!q || typeof q !== "object") return ["the file must hold a JSON object"];
  if (q.lang != null && pickLang(q.lang) === "en" && !/^en\b/i.test(String(q.lang)))
    p.push(`lang "${q.lang}" has no locales file; use one of ${languages().join(", ")}, or leave lang out`);
  if (!Array.isArray(q.decisions) || !q.decisions.length) return [...p, "decisions is empty"];
  const ids = new Set();
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
    if (d.type === "preview" && d.preview != null) {
      if (typeof d.preview !== "object" || (d.preview.html != null && typeof d.preview.html !== "string")) p.push(`${at} preview must be an object whose html is a string`);
      else if (d.preview.height != null && !(+d.preview.height > 0)) p.push(`${at} preview height must be a number above 0`);
    }
    if (d.type === "pick" || d.type === "preview") {
      if (!Array.isArray(d.options) || !d.options.length || d.options.some((o) => !text(o?.key) || !o.label)) p.push(`${at} every option needs a key (text) and a label`);
      else {
        if (dupes(d.options.map((o) => o.key)).length) p.push(`${at} option keys must be unique`);
        if (d.options.filter((o) => o.rec).length > 1) p.push(`${at} only one option can be rec`);
        if (d.type === "pick" && d.dims != null && !Array.isArray(d.dims)) p.push(`${at} dims must be a list of row names`);
        else if (d.type === "pick" && d.options.some((o) => (o.d || []).length !== (d.dims || []).length)) p.push(`${at} an option has a different number of d cells than dims`);
        else if (d.type === "pick" && d.options.some((o) => (o.d || []).some((c) => !Array.isArray(c) || !["good", "bad", "", undefined].includes(c[1]))))
          p.push(`${at} each d cell must be [value, "good" | "bad" | ""]`);
        d.options.forEach((o) => checkVisual(o.visual, `${at}[${o.key}]`, p, cwd));
      }
    } else if (d.type === "multi") {
      if (!Array.isArray(d.items) || !d.items.length || d.items.some((i) => !text(i?.id) || !i.label)) p.push(`${at} every item needs an id (text) and a label`);
      else if (dupes(d.items.map((i) => i.id)).length) p.push(`${at} item ids must be unique`);
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
    } else p.push(`${at} type must be one of pick, preview, multi, batch, value`);
  }
  return p;
}

// Ids of questions a submitted state leaves unsettled. The page only enables submit when this is empty.
export function unanswered(q, state) {
  const S = cleanState(q, state);
  return q.decisions.filter((d) => !isDone(d, S[d.id])).map((d) => d.id);
}
