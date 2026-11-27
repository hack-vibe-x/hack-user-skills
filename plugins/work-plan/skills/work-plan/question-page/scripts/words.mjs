// The words on the page. Two jobs:
//   wording(q)  checks what a machine can check about readability, before the page opens.
//   readout(q)  prints every word the person will see and nothing else, so a reader who has not seen the project can say what they cannot follow.
// What no program can check is a made-up phrase that looks like Korean or English (a label from the writer's own notes, said as if everyone knew it).
// That is what the readout is for; see "Read it cold" in SKILL.md.

// Fields whose values are not words a person reads: ids, keys, kinds, colours, paths, flags and levels.
const NOT_TEXT = new Set(["id", "key", "type", "lang", "src", "layout", "color", "vars", "t", "conf", "level", "mark", "dim", "rec", "themes", "hash", "unit", "mode"]);
const MARKS = new Set(["good", "bad", ""]);
// Fields written as sentences to be read. A sentence over the limit is split.
const PROSE = new Set(["plain", "ctx", "more", "gist", "means", "give", "flaw", "when", "cap", "why", "desc", "example", "sub", "caption", "stake", "depends", "same", "assume", "text", "check", "next", "how", "q", "lens", "prereq", "confusion"]);
const LIMIT = { ko: 90, en: 170, other: 140 };
// Letters-only words most readers know. Anything else in capitals, or written like a name in code, needs a line in terms.
const KNOWN = new Set(["AI", "UI", "OK", "URL", "ID", "PDF", "CSV", "FAQ", "USB", "PC", "TV", "SMS", "GPS"]);
const MAX_TERMS = 5;

const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
// The words inside a piece of html, in order, one line per block. Style, script and tags are not words.
export const htmlText = (h) =>
  decode(
    String(h)
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(div|p|li|tr|h[1-6]|ul|ol|table|section|figure)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

// Every piece of visible text in a decision, with where it is: [{ at, key, text }]. `at` reads like a path; `key` is the field name.
export function textsOf(node, at = "", key = "") {
  if (typeof node === "string") {
    if (!node.trim()) return [];
    // A picture drawn in html is read line by line, as the person sees it.
    return key === "html" ? htmlText(node).split("\n").map((text) => ({ at, key, text })) : [{ at, key, text: node }];
  }
  if (Array.isArray(node)) {
    // A cell is [value, "good" | "bad" | ""]: the mark is not a word.
    const items = node.length === 2 && MARKS.has(node[1]) ? [node[0]] : node;
    return items.flatMap((x, i) => textsOf(x, `${at}[${i}]`, key));
  }
  if (node && typeof node === "object")
    return Object.entries(node).flatMap(([k, v]) => (NOT_TEXT.has(k) || (k === "undo" && typeof v === "string") ? [] : textsOf(v, at ? `${at}.${k}` : k, k)));
  return [];
}

const termWords = (d, q) => [...(Array.isArray(q.terms) ? q.terms : []), ...(Array.isArray(d.terms) ? d.terms : [])].map((t) => String(t?.[0] ?? "").toLowerCase()).filter(Boolean);

// A word written like code or an abbreviation: DM, API, session_relay, pendingFile, notes.md.
function codeWords(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b[A-Z]{2,}[A-Za-z]*\b|\b[a-z]+(?:_[a-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z]*\b|\b[\w-]+\.(?:json|md|mjs|js|ts|tsx|py|html|css|sh|yml|yaml)\b/g)) {
    if (!KNOWN.has(m[0])) found.add(m[0]);
  }
  return [...found];
}

const sentences = (s) => String(s).split(/(?<=[.!?。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

// Problems with the words, as lines for the writer to fix. Empty when there is nothing a machine can find.
export function wording(q) {
  const p = [];
  const lang = typeof q.lang === "string" ? q.lang.toLowerCase().split(/[-_]/)[0] : "en";
  const limit = LIMIT[lang] ?? LIMIT.other;
  if (q.terms != null && !(Array.isArray(q.terms) && q.terms.every((t) => Array.isArray(t) && t.length === 2))) p.push("terms (top level) must be a list of [word, meaning] pairs");
  for (const d of q.decisions || []) {
    const at = `[${d?.id ?? "no id"}]`;
    if (!d || typeof d !== "object") continue;
    if (!String(d.plain ?? "").trim()) p.push(`${at} plain is missing: write two or three plain sentences on what this decision is, for someone who has not seen this project`);
    const texts = textsOf({ ...d, terms: undefined });
    const terms = termWords(d, q);
    const own = Array.isArray(d.terms) ? d.terms : [];
    if (own.length > MAX_TERMS) p.push(`${at} ${own.length} terms: more than ${MAX_TERMS} words needing an explanation means the text is too hard. Say it in everyday words and keep only the few that cannot be replaced`);
    for (const t of own) {
      if (!Array.isArray(t) || !String(t[0] ?? "").trim() || !String(t[1] ?? "").trim()) p.push(`${at} each term needs a word and a meaning`);
      else if (String(t[1]).trim().length < 6 || (String(t[1]).toLowerCase().includes(String(t[0]).toLowerCase()) && String(t[1]).length < String(t[0]).length * 3))
        p.push(`${at} the meaning of "${t[0]}" must explain it in other words, not repeat it`);
      else if (!texts.some((x) => x.text.toLowerCase().includes(String(t[0]).toLowerCase()))) p.push(`${at} the term "${t[0]}" is not used on this question; remove it`);
    }
    const flagged = new Map();
    for (const { at: where, key, text } of texts) {
      for (const w of codeWords(text)) {
        const lw = w.toLowerCase();
        if (terms.some((t) => t.length > 1 && (t === lw || lw.startsWith(t) || t.includes(lw)))) continue;
        if (!flagged.has(w)) flagged.set(w, where);
      }
      if (PROSE.has(key)) {
        const long = sentences(text).find((s) => s.length > limit);
        if (long) p.push(`${at} ${where}: a sentence of ${long.length} characters ("${long.slice(0, 28)}…"). Split it so each sentence says one thing (at most ${limit} characters)`);
      }
    }
    for (const [w, where] of flagged) p.push(`${at} "${w}" (${where}) is written like code or an abbreviation. Say it in everyday words, or add it to terms with a meaning`);
    const plainSentences = sentences(d.plain ?? "").length;
    if (plainSentences > 4) p.push(`${at} plain has ${plainSentences} sentences: keep it to two or three`);
  }
  return p;
}

// All the words a person will see, in the order of the page, numbered, one line each. Nothing else is in it: no field names,
// no ids, no markup, no project context. That is what a reader who knows nothing gets. readoutMap says where each number is in the
// file, for the writer who has to fix it; the reader never needs it, and field names such as "ctx" or "facts[0][0]" only confuse them.
function lines(q) {
  const rows = [];
  if (q.title) rows.push({ at: "title", text: String(q.title) });
  for (const [w, m] of q.terms || []) rows.push({ at: "terms", text: `${w} \u2014 ${m}` });
  for (const d of q.decisions || []) {
    rows.push({ at: `[${d.id}]`, text: String(d.q ?? d.id), heading: true });
    for (const { at, text } of textsOf({ ...d, q: undefined })) rows.push({ at: `[${d.id}] ${at}`, text });
  }
  let n = 0;
  return rows.map((r) => (r.heading ? r : { ...r, n: ++n }));
}
export const readout = (q) => lines(q).map((r) => (r.heading ? `\n== ${r.text}` : `${r.n}. ${r.text}`)).join("\n").trim();
export const readoutMap = (q) => lines(q).filter((r) => !r.heading).map((r) => `${r.n}\t${r.at}`).join("\n");
