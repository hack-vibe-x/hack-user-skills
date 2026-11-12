// UI and record-document strings live in ../locales/<lang>.json. English is the base; other languages override it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const read = (lang) => JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8"));
export const languages = () => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
// Only language codes (with an optional region, "ko-KR") that have a locale file are accepted, so a question file
// cannot point outside the folder. A region falls back to its language: "ko-KR" uses ko.json unless ko-kr.json exists.
const codes = (l) => {
  if (typeof l !== "string") return [];
  const c = l.trim().toLowerCase().replace("_", "-");
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(c) ? [...new Set([c, c.split("-")[0]])] : [];
};
export const pickLang = (...candidates) => candidates.flatMap(codes).find((l) => existsSync(join(dir, `${l}.json`))) || "en";
export const strings = (lang) => (lang && lang !== "en" ? { ...read("en"), ...read(lang) } : read("en"));
export const fmt = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
export const makeT = (lang) => {
  const S = strings(lang);
  return (key, vars) => fmt(S[key] ?? key, vars);
};
