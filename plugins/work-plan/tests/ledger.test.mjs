// Run: node --test plugins/work-plan/tests/
// Tests skills/work-plan/scripts/ledger.mjs on material made in a temp folder. Nothing outside it is touched.
// Korean text for the Korean cases is in samples.ko.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contains, extract, normalize, sourcesSection, withSources } from "../skills/work-plan/scripts/ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "skills", "work-plan", "scripts", "ledger.mjs");
const KO = JSON.parse(readFileSync(join(here, "samples.ko.json"), "utf8"));
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

function project() {
  const root = mkdtempSync(join(tmpdir(), "hus-work-plan-test-"));
  mkdirSync(join(root, "material"));
  writeFileSync(join(root, "material", "request.md"), "Look into competitor prices.\nWe will use it to decide\nnext month's price rise.\n");
  writeFileSync(join(root, "material", "mail.txt"), "From the team lead: please send it by 5 December. Look at A, B and C.");
  writeFileSync(join(root, "material", "page.html"), "<html><body><p>Price list</p><p>Basic &amp; Pro plans</p><script>var x=1</script></body></html>");
  writeFileSync(join(root, "material", "photo.png"), "not really an image");
  return root;
}

const baseLedger = (root, extra = {}) => ({
  lang: "en",
  root,
  materials: [
    { id: "M0", path: "material/request.md", what: "Task description", read: "full" },
    { id: "M1", path: "material/mail.txt", what: "Request mail", read: "full" },
  ],
  entries: [
    { id: "1", kind: "material", material: "M0", quote: "We will use it to decide next month's price rise" },
    { id: "2", kind: "material", material: "M1", where: "body", quote: "please send it by 5 December" },
    { id: "3", kind: "inference", from: ["1"], text: "The report must let them decide on the rise.", why: "It feeds that decision." },
    { id: "4", kind: "assumption", text: "Only three competitors are looked at.", why: "No answer on widening it." },
  ],
  ...extra,
});

const planBody = "# Competitor prices: work plan\n\n## 1. What this work is\n\n- For: the price rise decision [1], [3]\n- Due: 5 December [2]\n- Scope: three competitors [4]\n\n```text\nThe 3 numbers inside a prompt are not checked\n```\n";

function write(root, ledger, plan = planBody, { sources = true } = {}) {
  const lp = join(root, "ledger.json");
  const pp = join(root, "plan.md");
  writeFileSync(lp, JSON.stringify(ledger));
  writeFileSync(pp, sources ? withSources(plan, sourcesSection(ledger)) : plan);
  return { lp, pp };
}

const check = (pp, lp) => {
  const r = spawnSync(process.execPath, [SCRIPT, "check", pp, lp, "--json"], { encoding: "utf8" });
  return { status: r.status, ...JSON.parse(r.stdout || "{}"), stderr: r.stderr };
};
const messages = (r, level) => r.found.filter((f) => f.level === level).map((f) => f.message);

test("a plan whose quotes are all in the material passes", () => {
  const root = project();
  const { lp, pp } = write(root, baseLedger(root));
  const r = check(pp, lp);
  assert.equal(r.status, 0, JSON.stringify(r.found));
  assert.equal(r.fails, 0);
  assert.deepEqual(messages(r, "WARN"), []);
});

test("a quote that is not in the material word for word fails", () => {
  const root = project();
  const ledger = baseLedger(root);
  ledger.entries[1].quote = "please send it by 6 December";
  const { lp, pp } = write(root, ledger);
  const r = check(pp, lp);
  assert.equal(r.status, 1);
  assert.match(messages(r, "FAIL").join("\n"), /entry 2: the quote is not in material\/mail.txt/);
});

test("line breaks, curly quotes and words split across lines do not count as differences", () => {
  assert.ok(contains("decide\nnext month", "decide next month"));
  assert.ok(contains("he said “yes”", 'he said "yes"'));
  assert.ok(contains(KO.request, KO.requestQuote));
  assert.ok(contains(KO.brokenWord, KO.brokenWordQuote));
  assert.ok(!contains("by 5 December", "by 6 December"));
  assert.equal(normalize("a​ b\n\nc"), "a b c");
});

test("a citation of an entry that is not in the ledger fails, and an uncited entry is reported", () => {
  const root = project();
  const ledger = baseLedger(root);
  ledger.entries.push({ id: "5", kind: "assumption", text: "Nobody cites this" });
  const { lp, pp } = write(root, ledger, planBody + "\n- Owner: the team lead [9]\n");
  const r = check(pp, lp);
  assert.equal(r.status, 1);
  assert.match(messages(r, "FAIL").join("\n"), /cites \[9\]/);
  assert.match(messages(r, "WARN").join("\n"), /entry 5 is in the ledger but the plan never cites it/);
});

test("a line with a number and no source is reported; step labels, list numbers and prompts are not", () => {
  const root = project();
  const plan = planBody + "\n## 5. The path\n\n1. Step 1: collect the price lists\n- Attach the result of step 2\n- [ ] All 3 companies are there [4]\n- The budget is 3 million won\n";
  const { lp, pp } = write(root, baseLedger(root), plan);
  const warns = messages(check(pp, lp), "WARN");
  assert.equal(warns.length, 1, warns.join("\n"));
  assert.match(warns[0], /has a number but no source: - The budget is 3 million won/);
});

test("Korean step labels are not numbers either", () => {
  const root = project();
  writeFileSync(join(root, "material", "request.md"), KO.request);
  const ledger = {
    lang: "ko",
    root,
    materials: [{ id: "M0", path: "material/request.md", what: KO.what, read: "full" }],
    entries: [
      { id: "1", kind: "material", material: "M0", quote: KO.requestQuote },
      { id: "2", kind: "assumption", text: KO.assumption },
    ],
  };
  const { lp, pp } = write(root, ledger, KO.plan);
  const r = check(pp, lp);
  const warns = messages(r, "WARN");
  assert.equal(warns.length, 1, warns.join("\n"));
  assert.ok(warns[0].endsWith(KO.unsourcedLine), warns[0]);
  const text = readFileSync(pp, "utf8");
  assert.ok(text.includes(KO.heading));
  assert.ok(text.includes(KO.materialLine), text);
  assert.ok(text.includes(KO.assumptionLine), text);
});

test("the sources section must match the ledger", () => {
  const root = project();
  const ledger = baseLedger(root);
  const { lp, pp } = write(root, ledger, planBody, { sources: false });
  assert.match(messages(check(pp, lp), "FAIL").join("\n"), /has no "## Sources" section/);
  writeFileSync(pp, withSources(planBody, sourcesSection(ledger)).replace("by 5 December", "by 7 December"));
  assert.match(messages(check(pp, lp), "FAIL").join("\n"), /differs from the ledger/);
});

test("sources --into writes the section once and replaces it on the next run", () => {
  const root = project();
  const ledger = baseLedger(root);
  const { lp, pp } = write(root, ledger, planBody, { sources: false });
  for (let i = 0; i < 2; i++) assert.equal(spawnSync(process.execPath, [SCRIPT, "sources", lp, "--into", pp]).status, 0);
  const text = readFileSync(pp, "utf8");
  assert.equal(text.split("## Sources").length, 2);
  assert.match(text, /\[2\] Request mail, material\/mail.txt, body: "please send it by 5 December"/);
  assert.match(text, /\[3\] Inferred: The report must let them decide on the rise\. From \[1\]\. It feeds that decision\./);
  assert.match(text, /\[4\] Assumption \(not confirmed\): Only three competitors are looked at\./);
  assert.equal(check(pp, lp).status, 0);
});

test("a language with no language file, or a code that is not a language, falls back to English", () => {
  const root = project();
  for (const lang of ["xx", "not a code!", "e/x"]) {
    const s = sourcesSection(baseLedger(root, { lang })).text;
    assert.match(s, /^## Sources/);
  }
});

test("material a program cannot read is reported, and it may not be quoted once marked unreadable", () => {
  const root = project();
  const ledger = baseLedger(root);
  ledger.materials.push({ id: "M2", path: "material/photo.png", what: "Photo" });
  let { lp, pp } = write(root, ledger);
  assert.match(messages(check(pp, lp), "WARN").join("\n"), /material M2 \(material\/photo.png\): no reader for \.png/);

  ledger.materials[2].read = "unreadable";
  ledger.entries.push({ id: "5", kind: "material", material: "M2", quote: "words in the photo" });
  ({ lp, pp } = write(root, ledger, planBody + "\n- What the photo shows [5]\n"));
  const r = check(pp, lp);
  assert.match(messages(r, "FAIL").join("\n"), /entry 5 quotes material M2, which is marked unreadable/);
  assert.match(readFileSync(pp, "utf8"), /Material that could not be read in full[\s\S]*Photo, material\/photo.png: could not be read/);
});

test("a missing file, an unknown material and a bad inference fail", () => {
  const root = project();
  const ledger = baseLedger(root);
  ledger.materials.push({ id: "M3", path: "material/gone.txt" });
  ledger.entries.push({ id: "5", kind: "material", material: "M9", quote: "x" });
  ledger.entries.push({ id: "6", kind: "inference", from: ["8"], text: "y" });
  ledger.entries.push({ id: "6", kind: "guess", text: "z" });
  const { lp, pp } = write(root, ledger, planBody + "\n- [5] [6]\n");
  const fails = messages(check(pp, lp), "FAIL").join("\n");
  assert.match(fails, /material M3: material\/gone.txt is not there/);
  assert.match(fails, /entry 5 points to material "M9"/);
  assert.match(fails, /inference 6 is inferred from entry 8/);
  assert.match(fails, /entry 6 is listed twice/);
  assert.match(fails, /kind "guess"/);
});

test("HTML is read without its tags and scripts", () => {
  const root = project();
  const got = extract(join(root, "material", "page.html"));
  assert.ok(contains(got.text, "Basic & Pro plans"));
  assert.ok(!got.text.includes("var x"));
});

test("a Word file is read from its XML, with paragraphs kept apart", { skip: !has("zip") || !has("unzip") }, () => {
  const root = project();
  const dir = join(root, "docx");
  mkdirSync(join(dir, "word"), { recursive: true });
  writeFileSync(join(dir, "word", "document.xml"), "<w:document><w:body><w:p><w:r><w:t>The budget is </w:t></w:r><w:r><w:t>3 million</w:t></w:r></w:p><w:p><w:r><w:t>End</w:t></w:r></w:p></w:body></w:document>");
  writeFileSync(join(dir, "[Content_Types].xml"), "<Types/>");
  assert.equal(spawnSync("zip", ["-qr", join(root, "material", "brief.docx"), "."], { cwd: dir }).status, 0);
  const got = extract(join(root, "material", "brief.docx"));
  assert.ok(contains(got.text, "The budget is 3 million"), got.text);
  assert.ok(contains(got.text, "3 million End"));
  assert.ok(!got.text.includes("millionEnd"));
});

test("text prints what the script reads, and bad commands exit 2", () => {
  const root = project();
  const r = spawnSync(process.execPath, [SCRIPT, "text", join(root, "material", "mail.txt")], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /by 5 December/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "nope"]).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "check", "a.md"]).status, 2);
  const bad = join(root, "bad.json");
  writeFileSync(bad, "{");
  assert.equal(spawnSync(process.execPath, [SCRIPT, "check", join(root, "plan.md"), bad]).status, 2);
});
