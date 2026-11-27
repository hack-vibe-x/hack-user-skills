#!/usr/bin/env node
// Keeps the copies listed in bundles.json up to date, and the table of them in README.md.
// A plugin installs only its own folder, so a plugin that uses another plugin's files carries a copy of them.
// The copy is made here and never edited by hand; BUNDLED.json in it says which plugin and version it is a copy of.
//
//   node scripts/bundle.mjs          copy every source over its copy, then rewrite the README table
//   node scripts/bundle.mjs --check  change nothing; exit 1 and say what is out of date when a copy or the table is
//   node scripts/bundle.mjs --hook   PostToolUse hook (.claude/settings.json): copy, and tell Claude what changed
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = "BUNDLED.json";
const SKIP = new Set([".DS_Store", "__pycache__", "node_modules"]);
const at = (p) => join(root, p);
const json = (p) => JSON.parse(readFileSync(at(p), "utf8"));
const pluginOf = (p) => p.match(/^plugins\/([^/]+)\//)?.[1] ?? fail(`${p} is not inside plugins/<name>/`);
const manifest = (name) => json(`plugins/${name}/.claude-plugin/plugin.json`);
function fail(msg) {
  console.error(`[bundle] ${msg}`);
  process.exit(2);
}

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name))
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name))]))
    .sort();
}

// What the copy should hold: every source file (renamed where asked) and BUNDLED.json.
function wanted(b) {
  const files = new Map();
  for (const f of walk(at(b.from))) {
    let buf = readFileSync(at(join(b.from, f)));
    // A SKILL.md renamed in the copy is no longer a skill, so its front matter (name, description, triggers) is left out.
    if (basename(f) === "SKILL.md" && b.rename?.[f]) buf = Buffer.from(buf.toString("utf8").replace(/^---\n[\s\S]*?\n---\n+/, ""));
    files.set(b.rename?.[f] ?? f, buf);
  }
  const src = manifest(pluginOf(b.from));
  const mark = {
    from: src.name,
    version: src.version,
    source: b.from,
    note: "A copy made by scripts/bundle.mjs in the hack-user-skills repository. Edit the source; changes made here are overwritten.",
  };
  files.set(MARK, Buffer.from(JSON.stringify(mark, null, 2) + "\n"));
  return files;
}

function changes(b) {
  const want = wanted(b);
  const dir = at(b.into);
  const write = [...want].filter(([p, buf]) => !existsSync(join(dir, p)) || !readFileSync(join(dir, p)).equals(buf)).map(([p]) => p);
  const remove = walk(dir).filter((p) => !want.has(p));
  return { want, write, remove };
}

function apply(b, { want, write, remove }) {
  for (const p of write) {
    mkdirSync(dirname(join(at(b.into), p)), { recursive: true });
    writeFileSync(join(at(b.into), p), want.get(p));
  }
  for (const p of remove) rmSync(join(at(b.into), p));
}

// The README table, one per language, between <!-- bundles:en --> and <!-- /bundles:en --> (and ko).
function rows() {
  return json("bundles.json").bundles.map((b) => {
    const host = manifest(pluginOf(b.into));
    const src = manifest(pluginOf(b.from));
    const mark = existsSync(at(join(b.into, MARK))) ? json(join(b.into, MARK)) : {};
    return { host, src, inside: mark.version ?? "-", path: relative(`plugins/${pluginOf(b.into)}`, b.into) };
  });
}
// The header row and the |---| row are written in README.md in each language; only the rows under them are written here.
function readme() {
  let text = readFileSync(at("README.md"), "utf8");
  const body = rows().map((r) => `| ${r.host.name} ${r.host.version} | \`${r.path}/\` | ${r.src.name} | ${r.inside} | ${r.src.version} |`);
  for (const lang of ["en", "ko"]) {
    const re = new RegExp(`(<!-- bundles:${lang} -->\\n)([\\s\\S]*?)(<!-- /bundles:${lang} -->)`);
    const m = text.match(re);
    const head = m?.[2].split("\n").slice(0, 2);
    if (!m || head.length < 2 || !/^\|[-| ]+\|$/.test(head[1])) fail(`README.md needs a <!-- bundles:${lang} --> block that starts with a table header and its |---| row`);
    text = text.replace(re, (_, open, __, close) => `${open}${[...head, ...body].join("\n")}\n${close}`);
  }
  return text;
}

const mode = process.argv[2];
const bundles = json("bundles.json").bundles;

if (mode === "--check") {
  const late = [];
  for (const b of bundles) {
    const { write, remove } = changes(b);
    if (write.length || remove.length) late.push(`${b.into} is not a copy of ${b.from} (differs: ${[...write, ...remove].join(", ")})`);
  }
  if (readme() !== readFileSync(at("README.md"), "utf8")) late.push("README.md: the table of copies is out of date");
  if (late.length) {
    console.error(`[bundle] Out of date. Run: node scripts/bundle.mjs\n- ${late.join("\n- ")}`);
    process.exit(1);
  }
  console.error(`[bundle] ${bundles.length} cop${bundles.length === 1 ? "y is" : "ies are"} up to date.`);
  process.exit(0);
}

// --hook reads which file the tool touched, to say so when it was the copy itself.
let touched = "";
if (mode === "--hook") {
  try {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const input = JSON.parse(text).tool_input || {};
    touched = input.file_path ? relative(root, resolve(input.file_path)) : "";
  } catch {}
}

const said = [];
for (const b of bundles) {
  const c = changes(b);
  if (!c.write.length && !c.remove.length) continue;
  apply(b, c);
  const src = manifest(pluginOf(b.from));
  const host = manifest(pluginOf(b.into));
  const hand = touched.startsWith(b.into + "/") ? ` ${touched} is the copy: that edit was overwritten from the source. Make it in ${b.from} instead.` : "";
  said.push(
    `Copied ${b.from} (${src.name} ${src.version}) into ${b.into}: ${c.write.length} written, ${c.remove.length} removed.${hand} ` +
      `Before committing, bump ${host.name}'s version too (it is ${host.version}), since its skill changed.`,
  );
}
const text = readme();
if (text !== readFileSync(at("README.md"), "utf8")) writeFileSync(at("README.md"), text);

if (mode === "--hook") {
  if (said.length) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: said.join("\n") } }));
} else console.error(said.length ? `[bundle] ${said.join("\n[bundle] ")}` : "[bundle] Nothing to copy.");
