// Checks a question file before the page opens, so a missing value is reported with where to fix it
// instead of a blank page or a crash after the person has answered.
import { cleanState, isDone } from "./record.mjs";

// The id becomes part of file names, so it may hold only letters, digits, ".", "_" and "-".
export const ID_RE = /^(?!\.{1,2}$)[\p{L}\p{N}_.-]+$/u;
export const safeId = (s) => String(s).replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/g, "") || "decisions";

const dupes = (list) => list.filter((x, i) => x != null && list.indexOf(x) !== i);

function checkVisual(v, at, p) {
  if (v == null) return;
  if (typeof v !== "object") return p.push(`${at} visual must be an object`);
  if (v.type === "steps" && (!Array.isArray(v.steps) || !v.steps.length)) p.push(`${at} a steps visual needs a steps array`);
  if (v.type === "grid" && !(+v.cols > 0)) p.push(`${at} a grid visual needs cols (a number above 0)`);
  if (v.type === "image" && !v.src) p.push(`${at} an image visual needs src`);
  if (v.type === "html" && typeof v.html !== "string") p.push(`${at} an html visual needs html (a string)`);
  if (!["screen", "button", "grid", "steps", "image", "html"].includes(v.type)) p.push(`${at} visual type must be one of screen, button, grid, steps, image, html`);
}

export function check(q) {
  const p = [];
  if (!q || typeof q !== "object") return ["the file must hold a JSON object"];
  if (q.id != null && !ID_RE.test(String(q.id))) p.push(`id "${q.id}" may hold only letters, digits, ".", "_" and "-"`);
  if (q.supersedes != null) {
    const list = [].concat(q.supersedes);
    if (!list.length || list.some((x) => typeof x !== "string" || !ID_RE.test(x))) p.push(`supersedes must be the id of an earlier batch (or a list of them)`);
    else if (q.id != null && list.includes(String(q.id))) p.push(`supersedes cannot name this batch's own id`);
  }
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
    if (d.type === "preview" && d.preview != null) {
      if (typeof d.preview !== "object" || (d.preview.html != null && typeof d.preview.html !== "string")) p.push(`${at} preview must be an object whose html is a string`);
      else if (d.preview.height != null && !(+d.preview.height > 0)) p.push(`${at} preview height must be a number above 0`);
    }
    if (d.type === "pick" || d.type === "preview") {
      if (!Array.isArray(d.options) || !d.options.length || d.options.some((o) => !o?.key || !o.label)) p.push(`${at} every option needs a key and a label`);
      else {
        if (dupes(d.options.map((o) => o.key)).length) p.push(`${at} option keys must be unique`);
        if (d.options.filter((o) => o.rec).length > 1) p.push(`${at} only one option can be rec`);
        if (d.type === "pick" && d.options.some((o) => (o.d || []).length !== (d.dims || []).length)) p.push(`${at} an option has a different number of d cells than dims`);
        d.options.forEach((o) => checkVisual(o.visual, `${at}[${o.key}]`, p));
      }
    } else if (d.type === "multi") {
      if (!Array.isArray(d.items) || !d.items.length || d.items.some((i) => !i?.id || !i.label)) p.push(`${at} every item needs an id and a label`);
      else if (dupes(d.items.map((i) => i.id)).length) p.push(`${at} item ids must be unique`);
    } else if (d.type === "batch") {
      if (!Array.isArray(d.items) || !d.items.length || d.items.some((i) => !i?.id || !i.q || !Array.isArray(i.options) || !i.options.length)) p.push(`${at} every item needs an id, a q and options`);
      else {
        if (dupes(d.items.map((i) => i.id)).length) p.push(`${at} item ids must be unique`);
        for (const i of d.items) {
          if (i.options.some((o) => !o?.key || !o.label)) p.push(`${at}[${i.id}] every option needs a key and a label`);
          else if (dupes(i.options.map((o) => o.key)).length) p.push(`${at}[${i.id}] option keys must be unique`);
        }
      }
    } else if (d.type === "value") {
      if (!Array.isArray(d.stops) || !d.stops.length || d.stops.some((s) => s?.v == null)) p.push(`${at} every stop needs a v`);
      else if (dupes(d.stops.map((s) => s.v)).length) p.push(`${at} stop values must be unique`);
    } else p.push(`${at} type must be one of pick, preview, multi, batch, value`);
  }
  return p;
}

// Ids of questions a submitted state leaves unsettled. The page only enables submit when this is empty.
export function unanswered(q, state) {
  const S = cleanState(q, state);
  return q.decisions.filter((d) => !isDone(d, S[d.id])).map((d) => d.id);
}
