"""Tests for criteria_status. Run: cd skills/criteria-init/scripts && python3 -m unittest -v test_criteria_status

Every test works in a temporary HOME; the plugin data folder is found under $HOME/.claude.
"""
import contextlib
import datetime
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

import criteria_status as cs

SID = "11111111-2222-3333-4444-555555555555"
NOW = datetime.datetime.now(datetime.timezone.utc)


def at(days_ago=0):
    return (NOW - datetime.timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def q(kind, text, turn, quote="plan a magazine"):
    return {"kind": kind, "question": text, "options": [], "quote": quote, "why": "", "turn": turn}


def judge(turn, question=None, **extra):
    return {"at": at(), "event": "judge", "turn": turn, "model": "sonnet", "ok": True, "question": question,
            "tokens": {"input_tokens": 100, "output_tokens": 10}, **extra}


def done(event, question, **extra):
    return {"at": at(), "event": event, "kind": question["kind"], "question": question["question"],
            "turn": question["turn"], **extra}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hus-criteria-gap-status-test-")
        self.home = Path(self.tmp.name) / "home"
        self.proj = self.home / "proj"
        self.proj.mkdir(parents=True)
        self.env = {k: os.environ.get(k) for k in ("HOME", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID",
                                                   "CLAUDE_PLUGIN_DATA", "CLAUDE_CONFIG_DIR", "TMPDIR")}
        os.environ["HOME"] = str(self.home)
        os.environ["TMPDIR"] = str(Path(self.tmp.name) / "tmp")
        for k in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CLAUDE_PLUGIN_DATA", "CLAUDE_CONFIG_DIR"):
            os.environ.pop(k, None)
        cs.tempfile.tempdir = None
        self.cwd = os.getcwd()
        os.chdir(self.proj)

    def tearDown(self):
        os.chdir(self.cwd)
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        cs.tempfile.tempdir = None
        self.tmp.cleanup()

    def config(self, value, folder=None):
        folder = folder or self.proj / ".hus-criteria-gap"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "config.json").write_text(json.dumps(value), encoding="utf-8")

    def hook_state(self, sid, **state):
        d = self.home / ".claude" / "plugins" / "data" / f"{cs.PLUGIN}-hack-user-skills" / "sessions"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{sid}.json").write_text(json.dumps(state), encoding="utf-8")

    def log(self, sid, events, project=None):
        d = self.home / ".hus-criteria-gap" / "judge-log" / cs.log_key(str(project or self.proj.resolve()))
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{sid}.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cs.main(list(argv))
        self.assertEqual(code, 0)
        return out.getvalue()


class StatusTest(Base):
    def test_settings_and_counts_of_this_session(self):
        self.config({"card": True, "hook": {"enabled": True, "max_per_session": 4}})
        os.environ["CLAUDE_CODE_SESSION_ID"] = SID
        self.hook_state(SID, turn=9, delegations=5, injected=4, fires=2, last_fire=6)
        a, b = q("criterion", "Which sources count?", 1), q("distinction", "Users or customers?", 5)
        self.log(SID, [judge(1, a), done("question-answered", a, answer="I don't know", unknown=True),
                       judge(3, None, dropped="quote-not-in-prompt", rejected=q("premise", "x", 3)),
                       judge(5, b)])
        out = self.run_cli("status")
        self.assertIn(f"{self.proj.resolve()}/.hus-criteria-gap/config.json", out)
        self.assertIn("hook: on · intensity light · max_per_session 4", out)
        self.assertIn("card: on", out)
        self.assertIn(f"Session: {SID}\n", out)
        self.assertIn("9 requests seen · 5 delegating · criteria added 4 times · said criteria were missing 2/4 times, "
                      "last 3 requests ago", out)
        self.assertIn("judged 3 turns · 2/4 questions shown · answered 1 (don't know 1)", out)
        self.assertIn("dropped (quote not in the prompt) 1", out)
        self.assertIn("waiting above the prompt: Users or customers?", out)

    def test_json_and_explicit_session(self):
        self.hook_state("other", turn=1, delegations=1, injected=1, fires=0, last_fire=-999)
        data = json.loads(self.run_cli("status", "--session", "other", "--json"))
        self.assertEqual(data["session"], "other")
        self.assertEqual(data["hook"]["delegations"], 1)
        self.assertIsNone(data["hook"]["since_last"])
        self.assertIsNone(data["card"])
        self.assertFalse(data["settings"]["card"])

    def test_without_a_session_id_the_newest_session_of_this_project(self):
        self.log("old", [judge(1)])
        os.utime(next((self.home / ".hus-criteria-gap" / "judge-log").glob("*/old.jsonl")), (1, 1))
        self.log("new", [judge(1), judge(2)])
        self.log("elsewhere", [judge(1)], project="/somewhere/else")
        out = self.run_cli("status")
        self.assertIn("Session: new (the most recent one", out)
        self.assertIn("judged 2 turns", out)

    def test_nothing_recorded(self):
        out = self.run_cli("status")
        self.assertIn("no config.json (defaults)", out)
        self.assertIn("Session: unknown", out)

    def test_broken_config_counts_as_off(self):
        (self.proj / ".hus-criteria-gap").mkdir()
        (self.proj / ".hus-criteria-gap" / "config.json").write_text("{nope", encoding="utf-8")
        self.config({"card": True, "hook": {"enabled": True}}, folder=self.home / ".hus-criteria-gap")
        out = self.run_cli("status")
        self.assertIn("(broken: counts as off)", out)
        self.assertIn("hook: off", out)


class SummaryTest(Base):
    def test_outcomes_kinds_and_missed(self):
        a = q("criterion", "Which sources count?", 1)
        b = q("distinction", "Users or customers?", 4)
        c = q("premise", "For which readers?", 8)
        d = q("criterion", "What is long enough?", 12)
        e = q("principle", "Why cache here?", 16)
        self.log("s1", [judge(1, a), done("question-answered", a, answer="primary only"),
                        judge(2), judge(4, b), done("question-skipped", b),
                        judge(8, c), done("question-expired", c)])
        self.log("s2", [judge(12, d, forced=True), done("question-answered", d, answer="I don't know", unknown=True),
                        {"at": at(), "event": "judge", "turn": 14, "ok": False, "why": "unparsed", "question": None},
                        judge(15, None, dropped="quote-not-in-prompt"), judge(16, e)])
        self.hook_state("s1", turn=6, delegations=3, injected=2, fires=1, last_fire=2)
        out = self.run_cli("summary")
        self.assertIn("sessions 2 · turns judged 8 (by /criteria-check 1) · questions shown 5 (62% of judged turns)", out)
        self.assertIn("dropped because the quote was not in the prompt 1 · judgements that failed 1", out)
        self.assertIn("answered 1 · unknown 1 · skipped 1 · expired 1 · withdrawn 0 · open 1", out)
        self.assertIn("criterion: shown 2 · answered 1 · unknown 1", out)
        missed = out.split("missed")[1]
        for text in ("What is long enough?", "Users or customers?", "For which readers?"):
            self.assertIn(text, missed)
        self.assertNotIn("Which sources count?", missed)
        self.assertIn("Hook, last 7 days (all projects): sessions 1 · requests 6 · delegating 3 · criteria added 2", out)

    def test_older_lines_without_a_turn_close_the_question_they_name(self):
        a = q("criterion", "Which sources count?", 3)
        old_answer = {"at": at(), "event": "question-answered", "kind": "criterion", "question": "Which sources count?"}
        self.log("s1", [judge(3, a), old_answer])
        data = json.loads(self.run_cli("summary", "--json"))
        self.assertEqual(data["card"]["shown"], 1)
        self.assertEqual(data["card"]["answered"], 1)
        self.assertNotIn("open", data["card"])

    def test_this_project_only_unless_all_and_days(self):
        a = q("criterion", "Here?", 1)
        self.log("s1", [judge(1, a)])
        self.log("s9", [judge(1, q("premise", "Elsewhere?", 1))], project="/somewhere/else")
        old = q("premise", "Long ago?", 1)
        self.log("s0", [{**judge(1, old), "at": at(days_ago=60)}])
        data = json.loads(self.run_cli("summary", "--json"))
        self.assertEqual([x["question"] for x in data["recent"]], ["Here?"])
        data = json.loads(self.run_cli("summary", "--json", "--days", "0"))
        self.assertEqual(sorted(x["question"] for x in data["recent"]), ["Here?", "Long ago?"])
        data = json.loads(self.run_cli("summary", "--json", "--all"))
        self.assertEqual(sorted(x["question"] for x in data["recent"]), ["Elsewhere?", "Here?"])

    def test_works_from_a_subfolder_and_with_no_log(self):
        out = self.run_cli("summary")
        self.assertIn("Judge log: none for this folder", out)
        self.assertIn("Judge log: none under", self.run_cli("summary", "--all"))
        self.log("s1", [judge(1)])
        sub = self.proj / "src"
        sub.mkdir()
        os.chdir(sub)
        self.assertIn("turns judged 1", self.run_cli("summary"))


if __name__ == "__main__":
    unittest.main()
