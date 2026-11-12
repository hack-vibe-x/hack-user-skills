"""Tests for criteria_index. Run: cd skills/criteria/scripts && python3 -m unittest -v test_criteria_index

Every test works in a temporary folder.
"""
import contextlib
import datetime
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

import criteria_index as ci

TODAY = "2026-11-12"
HOOKS = Path(__file__).resolve().parents[3] / "hooks"


def criterion(cid, area, decision, body="Primary sources only", status="confirmed", source="user",
              confirmed_at="2026-10-01", review_after="", supersedes=""):
    return (f"---\nid: {cid}\narea: {area}\ndecision: {decision}\nstatus: {status}\nsource: {source}\n"
            f"confirmed_at: {confirmed_at}\nreview_after: {review_after}\nsupersedes: {supersedes}\n"
            f"evidence:\n---\n\n{body}\n")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hus-criteria-gap-index-test-")
        self.dir = Path(self.tmp.name) / ".hus-criteria-gap"
        self.dir.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, cid, *args, name=None, **kw):
        (self.dir / (name or f"{cid}.md")).write_text(criterion(cid, *args, **kw), encoding="utf-8")

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = ci.main([*argv, "--dir", str(self.dir), "--today", TODAY])
        return code, out.getvalue()


class RebuildTest(Base):
    def test_rebuild_lists_every_file_sorted_with_source_and_review(self):
        self.add("magazine-source-filter-2", "magazine", "source-filter", body="From 2025 on\nsecond line",
                 supersedes="magazine-source-filter-1")
        self.add("magazine-source-filter-1", "magazine", "source-filter", status="superseded")
        self.add("blog-tone-1", "blog", "tone", status="draft", source="ai-inferred", confirmed_at="")
        code, _ = self.run_cli("rebuild")
        self.assertEqual(code, 0)
        lines = [l for l in (self.dir / "INDEX.md").read_text(encoding="utf-8").splitlines() if l.startswith("- ")]
        self.assertEqual(lines, [
            "- [blog-tone-1](blog-tone-1.md) · blog/tone · draft · ai-inferred · review - · Primary sources only",
            "- [magazine-source-filter-2](magazine-source-filter-2.md) · magazine/source-filter · confirmed · user"
            " · review 2026-12-30 · From 2025 on",
            "- [magazine-source-filter-1](magazine-source-filter-1.md) · magazine/source-filter · superseded · user"
            " · review - · Primary sources only",
        ])

    def test_rebuilt_index_passes_check(self):
        self.add("magazine-source-filter-1", "magazine", "source-filter")
        self.run_cli("rebuild")
        code, out = self.run_cli("check")
        self.assertEqual(code, 0, out)
        self.assertIn("0 errors", out)

    def test_empty_folder(self):
        (self.dir / "config.json").write_text("{}", encoding="utf-8")
        code, out = self.run_cli("check")
        self.assertEqual(code, 0, out)  # no criterion yet: no index needed
        self.run_cli("rebuild")
        self.assertIn("(no criteria yet)", (self.dir / "INDEX.md").read_text(encoding="utf-8"))


class CheckTest(Base):
    def errors(self):
        code, out = self.run_cli("check")
        return code, [l.strip() for l in out.splitlines() if "ERROR" in l], [l.strip() for l in out.splitlines() if "WARN" in l]

    def test_missing_or_outdated_index_is_an_error(self):
        self.add("a-b-1", "a", "b")
        code, errors, _ = self.errors()
        self.assertEqual(code, 1)
        self.assertTrue(any("INDEX.md: missing" in e for e in errors))
        self.run_cli("rebuild")
        self.add("a-c-1", "a", "c")
        code, errors, _ = self.errors()
        self.assertTrue(any("INDEX.md: differs" in e for e in errors))

    def test_broken_files_are_errors(self):
        (self.dir / "loose.md").write_text("no front matter", encoding="utf-8")
        self.add("Bad_ID", "a", "b", name="other.md", status="final", source="me", confirmed_at="Oct 1")
        self.add("a-c-1", "a", "c", body="", supersedes="nowhere-1")
        self.run_cli("rebuild")
        code, errors, _ = self.errors()
        self.assertEqual(code, 1)
        text = "\n".join(errors)
        for needle in ("loose.md: no front matter", "does not match the file name", "not lowercase ASCII",
                       "status 'final'", "source 'me'", "confirmed_at 'Oct 1' is not a date",
                       "supersedes 'nowhere-1'", "a-c-1.md: no criterion text"):
            self.assertIn(needle, text)

    def test_two_confirmed_for_one_decision(self):
        self.add("a-b-1", "a", "b")
        self.add("a-b-2", "a", "b")
        self.run_cli("rebuild")
        _, errors, _ = self.errors()
        self.assertTrue(any("second confirmed criterion for a/b" in e for e in errors))

    def test_inferred_and_stale_are_warnings_not_errors(self):
        self.add("a-b-1", "a", "b", source="ai-inferred")
        self.add("a-c-1", "a", "c", confirmed_at="2026-01-01")
        self.add("a-d-1", "a", "d", confirmed_at="2026-01-01", review_after="2027-01-01")
        self.add("a-e-1", "a", "e", status="superseded")
        self.run_cli("rebuild")
        code, errors, warnings = self.errors()
        self.assertEqual(code, 0, errors)
        text = "\n".join(warnings)
        self.assertIn("a-b-1.md: confirmed but ai-inferred", text)
        self.assertIn("a-c-1.md: past its review date (2026-04-01)", text)
        self.assertNotIn("a-d-1.md", text)
        self.assertIn("a-e-1.md: superseded, but no criterion names it", text)

    def test_bom_and_crlf_are_read(self):
        (self.dir / "a-b-1.md").write_bytes(("﻿" + criterion("a-b-1", "a", "b")).replace("\n", "\r\n").encode())
        self.run_cli("rebuild")
        code, errors, _ = self.errors()
        self.assertEqual(code, 0, errors)


class DefaultFoldersTest(Base):
    def test_project_then_global_and_global_is_not_a_project(self):
        home = Path(self.tmp.name) / "home"
        (home / ".hus-criteria-gap").mkdir(parents=True)
        sub = home / "work" / "deep"
        sub.mkdir(parents=True)
        old_home, old_cwd = os.environ.get("HOME"), os.getcwd()
        try:
            os.environ["HOME"] = str(home)
            os.chdir(sub)
            self.assertEqual(ci.default_folders(), [(home / ".hus-criteria-gap").resolve()])
            (home / "work" / ".hus-criteria-gap").mkdir()
            self.assertEqual([p.resolve() for p in ci.default_folders()],
                             [(home / "work" / ".hus-criteria-gap").resolve(), (home / ".hus-criteria-gap").resolve()])
        finally:
            os.chdir(old_cwd)
            if old_home is None:
                del os.environ["HOME"]
            else:
                os.environ["HOME"] = old_home


class SameRulesAsTheHookTest(Base):
    """INDEX.md, the hook and the card read the same files; what counts as confirmed must agree."""

    def test_hook_and_index_agree_on_confirmed(self):
        sys.path.insert(0, str(HOOKS))
        try:
            import criteria_hook as ch
        finally:
            sys.path.remove(str(HOOKS))
        self.add("a-ok-1", "a", "ok")
        self.add("a-inferred-1", "a", "inferred", source="ai-inferred")
        self.add("a-stale-1", "a", "stale", confirmed_at="2026-01-01")
        self.add("a-later-1", "a", "later", confirmed_at="2026-01-01", review_after="2027-01-01")
        self.add("a-draft-1", "a", "draft", status="draft")
        self.add("a-old-1", "a", "old", status="retired")
        today = datetime.date.fromisoformat(TODAY)
        confirmed, _ = ch.load_criteria([self.dir], today)
        from_hook = sorted(c["decision"] for c in confirmed)
        from_index = sorted(m["decision"] for _, m, _ in ci.read_folder(self.dir)
                            if m["status"] == "confirmed" and m["source"] != "ai-inferred"
                            and ci.review_date(m) and ci.review_date(m) >= today)
        self.assertEqual(from_hook, ["later", "ok"])
        self.assertEqual(from_index, from_hook)


if __name__ == "__main__":
    unittest.main()
