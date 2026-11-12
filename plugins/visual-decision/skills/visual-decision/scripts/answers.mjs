// Turns what the page sends into answers: keeps only answers that match the questions, and says which questions are settled.
export const REASON_KEYS = ["info", "options", "delegate"];

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
      // A pick question also takes the person's own typed answer, unless it says "ownAnswer": false.
      else if (d.type === "pick" && d.ownAnswer !== false && str(a.own?.trim?.())) c.own = a.own.trim();
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
  if (d.type === "pick" && a.own) return true;
  return a.choice != null;
}

// The recommended answer of a decision, in the shape its answer takes, or null when there is none.
export function recommended(d) {
  const rec = (list) => (list || []).find((x) => x.rec);
  if (d.type === "pick" || d.type === "preview") return rec(d.options)?.key ?? null;
  if (d.type === "value") return rec(d.stops)?.v ?? null;
  if (d.type === "multi") return (d.items || []).some((i) => i.rec) ? d.items.filter((i) => i.rec).map((i) => i.id) : null;
  if (d.type === "batch") {
    const all = (d.items || []).map((i) => [i.id, rec(i.options)?.key]);
    return all.every(([, k]) => k != null) ? Object.fromEntries(all) : null;
  }
  return null;
}

// Per question id: the chosen value, or why it was sent back, and any comment.
export function answersFor(q, state) {
  const S = cleanState(q, state);
  const out = {};
  for (const d of q.decisions) {
    const a = S[d.id] || {};
    out[d.id] = a.defer
      ? { choice: null, handBack: a.defer, ...(a.why ? { why: a.why } : {}), ...(a.note ? { note: a.note } : {}) }
      : { choice: a.choices ?? a.choice ?? null, ...(a.own ? { own: a.own } : {}), ...(a.note ? { note: a.note } : {}) };
  }
  return out;
}
