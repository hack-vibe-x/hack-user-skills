"""Tests for diary_auto. Fake records, a fake AI command, a fake HOME and a fake launchd only.
Nothing here registers a real launchd job or touches the real home folder.
Run: cd skills/session-diary/scripts && python3 -m unittest -v test_diary_auto
"""
import contextlib
import datetime
import io
import json
import os
import plistlib
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from collections import Counter
from pathlib import Path
from unittest import mock

import diary_auto as da
import i18n

TODAY = datetime.date(2026, 10, 4)
D1, D2, D3 = (datetime.date(2026, 10, n) for n in (1, 2, 3))
MESSAGE = "filter the sources"
GOOD = "---\ndate: x\n---\n\n# Diary\n\n“filter the sources”(10:00)\n"
KO = json.loads((Path(__file__).parent / "test_samples.ko.json").read_text(encoding="utf-8"))
REAL_SEND_NOTIFICATION = da.send_notification
ENV_KEYS = ("TZ", "HOME", "HUS_SESSION_COACH_HOME", "HUS_SESSION_COACH_CLAUDE_DIR", "HUS_SESSION_COACH_CODEX_DIR",
            "HUS_SESSION_COACH_LABEL")


def user_row(day, text=MESSAGE, sid="s1", cwd="/home/a/proj"):
    return {"type": "user", "sessionId": sid, "cwd": cwd, "timestamp": "%sT10:00:00+09:00" % day.isoformat(),
            "entrypoint": "cli", "message": {"role": "user", "content": text}}


def done(code=0, err=""):
    return subprocess.CompletedProcess([], code, "", err)


class Base(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in ENV_KEYS}
        self.tmp = tempfile.TemporaryDirectory(prefix="hus-session-coach-test-")
        self.root = Path(self.tmp.name)
        self.fake_home = self.root / "home"
        self.data = self.root / "data"
        self.claude = self.root / "claude"
        os.environ.update(TZ="Asia/Seoul", HOME=str(self.fake_home), HUS_SESSION_COACH_HOME=str(self.data),
                          HUS_SESSION_COACH_CLAUDE_DIR=str(self.claude), HUS_SESSION_COACH_CODEX_DIR=str(self.root / "codex"),
                          HUS_SESSION_COACH_LABEL="test.label")
        time.tzset()
        Path(da.home()).mkdir(parents=True)
        # No real notification and no real launchd call in any test. By default no job is loaded.
        for name in ("send_notification", "run_launchd"):
            patcher = mock.patch.object(da, name)
            started = patcher.start()
            self.addCleanup(patcher.stop)
            setattr(self, name, started)
        self.run_launchd.return_value = done(1)
        self.notifications = self.send_notification

    def tearDown(self):
        self.tmp.cleanup()
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        time.tzset()

    def session(self, day, **kw):
        path = self.claude / "proj" / ("%s-%s.jsonl" % (day.isoformat(), kw.get("sid", "s")))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(user_row(day, **kw), ensure_ascii=False) + "\n", encoding="utf-8")

    def fake_cli(self, replies):
        """A fake claude that answers each call with the next reply and records its arguments and input."""
        (self.root / "replies.json").write_text(json.dumps(replies), encoding="utf-8")
        script = self.root / "fake-cli"
        script.write_text("""#!/usr/bin/env python3
import json, sys, os
root = %r
replies = json.load(open(root + "/replies.json"))
calls_path = root + "/calls.json"
calls = json.load(open(calls_path)) if os.path.exists(calls_path) else []
calls.append({"argv": sys.argv[1:], "stdin": sys.stdin.read(), "env": sorted(k for k in os.environ if k.startswith("CLAUDE"))})
json.dump(calls, open(calls_path, "w"))
reply = replies[min(len(calls) - 1, len(replies) - 1)]
if reply == "ERROR":
    print(json.dumps({"is_error": True, "result": "limit reached"}))
    sys.exit(1)
print(json.dumps({"is_error": False, "result": reply, "usage": {"input_tokens": 1, "output_tokens": 1}, "total_cost_usd": 0.01}))
""" % str(self.root), encoding="utf-8")
        script.chmod(script.stat().st_mode | stat.S_IEXEC)
        return str(script)

    def calls(self):
        path = self.root / "calls.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    def state(self, since=D1, replies=None, **extra):
        da.save_state(dict({"since": since.isoformat(), "runner": self.fake_cli(replies or [GOOD]), "runner_kind": "claude"}, **extra))

    def diary(self, day):
        return Path(da.diary_path(day)).read_text(encoding="utf-8")


class FootprintTest(Base):
    def test_diaries_live_in_the_skill_sub_folder_of_the_plugin_home_folder(self):
        self.assertEqual(da.diary_path(D1), str(self.data / "session-diary" / "2026-10-01.md"))
        self.assertTrue(da.logs_dir().startswith(da.home()))

    def test_default_folder_and_label_use_the_short_name(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("HUS_SESSION_COACH_HOME")
            os.environ.pop("HUS_SESSION_COACH_LABEL")
            self.assertEqual(da.home(), str(self.fake_home / ".hus-session-coach" / "session-diary"))
            self.assertEqual(da.label(), "io.github.hack-vibe-x.hus-session-coach.session-diary")
            self.assertEqual(da.plist_path(), str(self.fake_home / "Library" / "LaunchAgents" /
                                                  "io.github.hack-vibe-x.hus-session-coach.session-diary.plist"))


class MissingDatesTest(Base):
    def test_lists_from_since_to_yesterday_oldest_first(self):
        self.assertEqual(da.missing_dates({"since": "2026-10-01"}, TODAY), [D1, D2, D3])

    def test_existing_diary_is_skipped_and_today_is_not_included(self):
        Path(da.diary_path(D2)).write_text("x", encoding="utf-8")
        self.assertEqual(da.missing_dates({"since": "2026-10-01"}, TODAY), [D1, D3])

    def test_not_turned_on_means_nothing(self):
        self.assertEqual(da.missing_dates({}, TODAY), [])


class TickTest(Base):
    def test_day_without_conversation_is_written_without_calling_ai(self):
        self.state(since=D3)
        self.assertEqual(da.tick(TODAY), 0)
        self.assertIn("There were no session conversations this day.", self.diary(D3))
        self.assertIn("# 2026-10-03 (Saturday) session diary", self.diary(D3))
        self.assertEqual(self.calls(), [])

    def test_day_with_only_automated_runs_counts_as_no_conversation(self):
        self.session(D3, cwd="/tmp/usersim-x")
        self.state(since=D3)
        da.tick(TODAY)
        text = self.diary(D3)
        self.assertIn("There were no session conversations", text)
        self.assertIn("1 automated runs left out", text)

    def test_computer_off_for_days_writes_each_missing_day_when_it_comes_back(self):
        self.session(D1)
        self.session(D3)
        self.state(since=D1)
        self.assertEqual(da.tick(TODAY), 0)
        self.assertIn("“filter the sources”", self.diary(D1))
        self.assertIn("There were no session conversations", self.diary(D2))
        self.assertIn("“filter the sources”", self.diary(D3))
        self.assertEqual(len(self.calls()), 2)

    def test_second_tick_does_nothing(self):
        self.session(D3)
        self.state(since=D3)
        da.tick(TODAY)
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)

    def test_ai_gets_no_tools_and_no_settings_and_leaves_no_session(self):
        self.session(D3)
        self.state(since=D3)
        os.environ["CLAUDE_CODE_SESSION_ID"] = "parent"
        self.addCleanup(os.environ.pop, "CLAUDE_CODE_SESSION_ID", None)
        da.tick(TODAY)
        call = self.calls()[0]
        argv = call["argv"]
        self.assertEqual(argv[argv.index("--tools") + 1], "")
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")
        self.assertIn("--no-session-persistence", argv)
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", call["env"])

    def test_material_and_previous_diaries_are_in_the_prompt_and_rules_in_the_system(self):
        self.session(D3)
        Path(da.diary_path(D1)).write_text("---\ndate: 1\n---\nearlier diary text\n", encoding="utf-8")
        Path(da.diary_path(D2)).write_text("---\ndate: 2\nfailed: true\n---\ncould not write\n", encoding="utf-8")
        self.state(since=D3)
        da.tick(TODAY)
        call = self.calls()[0]
        self.assertIn(MESSAGE, call["stdin"])
        self.assertIn("earlier diary text", call["stdin"])
        self.assertNotIn("could not write", call["stdin"])
        self.assertIn("Write all diary text in English (`en`).", call["stdin"])
        system = call["argv"][call["argv"].index("--system-prompt") + 1]
        self.assertIn("is a record only", system)
        self.assertIn("What to observe", system)

    def test_failure_writes_nothing_and_retries_next_time(self):
        self.session(D3)
        self.state(since=D3, replies=["ERROR", GOOD])
        self.assertEqual(da.tick(TODAY), 1)
        self.assertFalse(os.path.exists(da.diary_path(D3)))
        self.assertEqual(da.tick(TODAY), 0)
        self.assertIn("Diary", self.diary(D3))
        self.assertEqual(da.load_state().get("attempts"), {})

    def test_failure_stops_the_run_so_later_days_wait(self):
        self.session(D2)
        self.session(D3)
        self.state(since=D2, replies=["ERROR"])
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)

    def test_after_max_attempts_a_visible_failure_diary_is_left(self):
        self.session(D3)
        self.state(since=D3, replies=["ERROR"])
        for _ in range(da.MAX_ATTEMPTS):
            da.tick(TODAY)
        self.assertIn("could not be written", self.diary(D3))
        self.assertEqual(da.failed_dates(), [D3.isoformat()])
        before = len(self.calls())
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), before)

    def test_citation_is_repaired_without_calling_ai_again(self):
        self.session(D3)
        self.state(since=D3, replies=["---\ndate: x\n---\n\n# Diary\n\n“filter the sources”\n"])
        da.tick(TODAY)
        self.assertIn("“filter the sources”(10:00)", self.diary(D3))
        self.assertEqual(len(self.calls()), 1)

    def test_quote_from_yesterdays_diary_does_not_trigger_a_fix(self):
        Path(da.diary_path(D2)).write_text("---\ndate: 2\n---\n“said yesterday”(09:00)\n", encoding="utf-8")
        self.session(D3)
        reply = "---\ndate: x\n---\n\n# Diary\n\nYesterday I said “said yesterday”.\n"
        self.state(since=D3, replies=[reply])
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)

    def test_section_notes_follow_the_diaries_not_the_model(self):
        empty = "# Diary\n\n## My notes\n(Yours to fill in: what went well today)\n\n---\nSessions left out: 0\n"
        written = "# Diary\n\n## My notes\nI think this judgement is wrong\n\n---\nSessions left out: 0\n"
        self.assertIn("first one", da.section_notes([]))
        self.assertIn("Do not write", da.section_notes([empty]))
        self.assertEqual(da.last_memo([written]), "I think this judgement is wrong")
        self.assertIn("Write the 'Answering my notes' section", da.section_notes([written]))

    def test_notes_are_found_in_a_korean_diary_too(self):
        ko = i18n.T("ko")
        heading = "## " + ko("diary.h.memo")
        self.assertEqual(da.last_memo(["# x\n\n%s\n%s\n" % (heading, KO["memo"])]), KO["memo"])
        self.assertEqual(da.last_memo(["# x\n\n%s\n%s\n" % (heading, ko("diary.memo_placeholder"))]), "")

    def test_bad_quote_is_fixed_without_resending_material(self):
        self.session(D3)
        bad = "---\ndate: x\n---\n\n# Diary\n\n“made-up words”(10:00)\n"
        self.state(since=D3, replies=[bad, GOOD])
        da.tick(TODAY)
        self.assertIn("“filter the sources”(10:00)", self.diary(D3))
        self.assertNotIn("made-up words", self.diary(D3))
        self.assertIn("made-up words", self.calls()[1]["stdin"])
        self.assertNotIn("<material>", self.calls()[1]["stdin"])

    def test_quote_still_bad_after_fix_is_flagged_in_the_diary(self):
        self.session(D3)
        bad = "---\ndate: x\n---\n\n# Diary\n\n“made-up words”(10:00)\n"
        self.state(since=D3, replies=[bad, bad])
        da.tick(TODAY)
        self.assertIn("1 quotes did not pass the quote check", self.diary(D3))

    def test_reply_that_is_not_a_diary_counts_as_failure(self):
        self.session(D3)
        self.state(since=D3, replies=["Sorry"])
        self.assertEqual(da.tick(TODAY), 1)
        self.assertFalse(os.path.exists(da.diary_path(D3)))

    def test_code_fence_around_the_diary_is_removed(self):
        self.assertEqual(da.clean_output("```markdown\n" + GOOD + "```"), GOOD)

    def test_another_run_holding_the_lock_is_left_alone(self):
        self.session(D3)
        self.state(since=D3)
        with da.Lock():
            self.assertEqual(da.tick(TODAY), 0)
        self.assertEqual(self.calls(), [])

    def test_stale_lock_is_cleared(self):
        self.session(D3)
        self.state(since=D3)
        lock = Path(da.auto_dir()) / "lock"
        lock.mkdir(parents=True)
        os.utime(lock, (time.time() - da.STALE_LOCK_SECONDS - 10,) * 2)
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)


class LanguageTest(Base):
    def korean_reply(self):
        ko = i18n.T("ko")
        return "---\ndate: x\n---\n\n# x\n\n%s%s%s(10:00)\n" % (ko("quote.open"), KO["message"], ko("quote.close"))

    def test_korean_sessions_get_a_korean_diary_with_korean_labels(self):
        ko = i18n.T("ko")
        self.session(D3, text=KO["message"])
        self.state(since=D3, replies=[self.korean_reply()])
        da.tick(TODAY)
        prompt = self.calls()[0]["stdin"]
        self.assertIn("(`ko`)", prompt)
        self.assertIn("- My notes -> " + ko("diary.h.memo"), prompt)
        self.assertIn(ko("diary.title", date=D3.isoformat(), weekday=ko("weekday.5")), prompt)
        text = self.diary(D3)
        self.assertIn("## " + ko("diary.h.stats"), text)
        self.assertIn(ko("quote.open") + KO["message"] + ko("quote.close") + "(10:00)", text)
        title, body = self.notifications.call_args.args
        self.assertEqual(title, ko("notify.title"))
        self.assertIn(ko("date.month_day", month=10, day=3), body)

    def test_a_chosen_language_wins_over_the_sessions(self):
        self.session(D3, text=KO["message"])
        self.state(since=D3, lang="en")
        da.tick(TODAY)
        self.assertIn("(`en`)", self.calls()[0]["stdin"])
        self.assertIn("## Statistics", self.diary(D3))

    def test_empty_day_follows_the_chosen_language(self):
        ko = i18n.T("ko")
        self.state(since=D3, lang="ko")
        da.tick(TODAY)
        self.assertIn(ko("diary.empty"), self.diary(D3))

    def test_unknown_language_is_refused(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(da.write_one(D3.isoformat(), False, "../x"), 2)
        self.assertIn("Unknown language", out.getvalue())

    def test_write_keeps_the_language_for_later_diaries(self):
        self.state(since=D3)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(da.write_one(D3.isoformat(), False, "ko"), 0)
        self.assertEqual(da.load_state()["lang"], "ko")

    def test_format_headings_in_write_md_match_the_english_language_file(self):
        en = i18n.T("en")
        write_md = da.read_reference("write.md")
        for key in da.PROMPT_KEYS:
            if key.startswith("diary.h."):
                self.assertIn("\n## " + en(key), write_md, key)
        for key in ("diary.today", "diary.range"):
            self.assertIn("**%s:**" % en(key), write_md, key)
        self.assertIn(en("diary.memo_placeholder"), write_md)
        self.assertIn(en("diary.footer", sessions="N", points="N"), write_md)


class StatisticsTest(Base):
    def assistant(self, day, msg_id, out, sid="s1", cwd="/home/a/proj"):
        return {"type": "assistant", "sessionId": sid, "cwd": cwd, "requestId": "r" + msg_id,
                "timestamp": "%sT10:01:00+09:00" % day.isoformat(),
                "message": {"id": msg_id, "model": "claude-x", "content": [{"type": "text", "text": "answer"}],
                            "usage": {"input_tokens": 1, "cache_creation_input_tokens": 9, "cache_read_input_tokens": 100, "output_tokens": out}}}

    def write_rows(self, relative, rows):
        path = self.claude / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")

    def test_tokens_are_split_by_who_and_counted_once(self):
        self.write_rows("proj/s1.jsonl", [user_row(D3), self.assistant(D3, "m1", 5), self.assistant(D3, "m1", 5), self.assistant(D3, "m2", 7)])
        self.write_rows("proj/s1/subagents/agent-1.jsonl", [self.assistant(D3, "m3", 11, sid="s1")])
        self.write_rows("proj/auto.jsonl", [user_row(D3, sid="auto", cwd="/tmp/x"), self.assistant(D3, "m4", 13, sid="auto", cwd="/tmp/x")])
        _, info = da.build_material(D3)
        u = info["usage"]
        self.assertEqual((u["mine"]["new"], u["mine"]["cache"], u["mine"]["out"]), (20, 200, 12))
        self.assertEqual(u["sub"]["out"], 11)
        self.assertEqual(u["auto"]["out"], 13)
        self.assertEqual(u["models"]["claude-x"], 20 + 12 + 10 + 11 + 10 + 13)

    def test_other_days_and_resumed_copies_are_not_counted(self):
        self.write_rows("proj/s1.jsonl", [user_row(D3), self.assistant(D2, "old", 50), self.assistant(D3, "m1", 5)])
        self.write_rows("proj/s2.jsonl", [user_row(D3, sid="s2"), self.assistant(D3, "m1", 5, sid="s2")])
        _, info = da.build_material(D3)
        self.assertEqual(info["usage"]["mine"]["out"], 5)

    def test_codex_counts_only_what_grew_that_day(self):
        def token(when, total_in, cached, out):
            return {"type": "event_msg", "timestamp": "%sT10:00:00+09:00" % when.isoformat(),
                    "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": total_in, "cached_input_tokens": cached, "output_tokens": out}}}}

        path = self.root / "codex" / "sessions" / "r.jsonl"
        path.parent.mkdir(parents=True)
        rows = [{"type": "session_meta", "timestamp": "%sT09:00:00+09:00" % D2.isoformat(), "payload": {"id": "c1", "cwd": "/home/a/p", "source": "cli"}},
                token(D2, 100, 40, 10), token(D3, 300, 140, 30),
                {"type": "event_msg", "timestamp": "%sT10:00:00+09:00" % D3.isoformat(), "payload": {"type": "user_message", "message": "codex question"}}]
        path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
        _, info = da.build_material(D3)
        self.assertEqual((info["usage"]["mine"]["new"], info["usage"]["mine"]["cache"], info["usage"]["mine"]["out"]), (100, 100, 20))

    def test_diary_gets_statistics_before_my_notes_and_numbers_in_the_header(self):
        self.write_rows("proj/s1.jsonl", [user_row(D3), self.assistant(D3, "m1", 5)])
        reply = "---\ndate: x\nseen: []\n---\n\n# Diary\n\n“filter the sources”(10:00)\n\n## My notes\n(Yours to fill in.)\n"
        self.state(since=D3, replies=[reply])
        da.tick(TODAY)
        text = self.diary(D3)
        self.assertIn("## Statistics", text)
        self.assertLess(text.index("tokens_out: 5"), text.index("# Diary"))
        self.assertIn("Writing this diary", text)
        self.assertIn("about $0.01", text)
        self.assertEqual(text.count("---\n"), 2)

    def test_statistics_go_after_evidence_and_before_the_footer(self):
        self.write_rows("proj/s1.jsonl", [user_row(D3), self.assistant(D3, "m1", 5)])
        reply = ("---\ndate: x\n---\n\n# Diary\n\nI handed over the filter[1].\n\n## My notes\n(Yours to fill in.)\n\n"
                 "## Evidence\n[1] handed over: “filter the sources”(10:00)\n\n---\nSessions left out: 0\n")
        self.state(since=D3, replies=[reply])
        da.tick(TODAY)
        text = self.diary(D3)
        self.assertLess(text.index("## My notes"), text.index("## Evidence"))
        self.assertLess(text.index("## Evidence"), text.index("## Statistics"))
        self.assertLess(text.index("## Statistics"), text.index("Sessions left out"))
        self.assertIn("I handed over the filter[1]", text)

    def test_memo_ends_at_the_next_heading(self):
        diary = "# Diary\n\n## My notes\nthis judgement is wrong\n\n## Evidence\n[1] task: “words”(10:00)\n"
        self.assertEqual(da.last_memo([diary]), "this judgement is wrong")

    def test_written_diary_notifies_with_the_plan(self):
        self.session(D3)
        reply = '---\ndate: x\nplan: "When told it is done, open it myself"\n---\n\n# Diary\n'
        self.state(since=D3, replies=[reply])
        da.tick(TODAY)
        title, body = self.notifications.call_args.args
        self.assertEqual(title, "hack-user-skills-session-coach: Session diary")
        self.assertIn("Wrote the diary for 10/3", body)
        self.assertIn("When told it is done, open it myself", body)

    def test_day_without_conversation_does_not_notify(self):
        self.state(since=D3)
        da.tick(TODAY)
        self.notifications.assert_not_called()

    def test_a_run_that_will_retry_does_not_notify_but_giving_up_does(self):
        self.session(D3)
        self.state(since=D3, replies=["ERROR"])
        da.tick(TODAY)
        self.notifications.assert_not_called()
        for _ in range(da.MAX_ATTEMPTS - 1):
            da.tick(TODAY)
        self.assertIn("Could not write the diary", self.notifications.call_args.args[1])

    def test_notification_text_is_passed_as_an_argument_not_as_code(self):
        evil = 'x" & (do shell script "touch /tmp/pwn") & "'
        with mock.patch.object(da.sys, "platform", "darwin"), mock.patch.object(da.subprocess, "run") as run:
            REAL_SEND_NOTIFICATION("Session diary", evil)
        cmd = run.call_args.args[0]
        code = [cmd[i + 1] for i, part in enumerate(cmd) if part == "-e"]
        self.assertFalse(any("pwn" in line for line in code))
        self.assertEqual(cmd[-1], evil)

    def test_day_without_conversation_still_reports_automated_tokens_and_no_ai_cost(self):
        self.write_rows("proj/auto.jsonl", [user_row(D3, sid="auto", cwd="/tmp/x"), self.assistant(D3, "m4", 13, sid="auto", cwd="/tmp/x")])
        self.state(since=D3)
        da.tick(TODAY)
        text = self.diary(D3)
        self.assertIn("There were no session conversations", text)
        self.assertIn("tokens_auto_out: 13", text)
        self.assertNotIn("Writing this diary", text)

    def test_previous_header_numbers_reach_the_next_diary(self):
        Path(da.diary_path(D2)).write_text("---\ndate: 2\ntokens_out: 777\n---\ndiary\n", encoding="utf-8")
        self.session(D3)
        self.state(since=D3)
        da.tick(TODAY)
        self.assertIn("tokens_out: 777", self.calls()[0]["stdin"])


class WriteOneTest(Base):
    def quiet(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            return da.write_one(*args)

    def test_future_date_is_refused(self):
        tomorrow = datetime.date.today() + datetime.timedelta(days=1)
        self.assertEqual(self.quiet(tomorrow.isoformat(), False), 2)

    def test_today_is_written_from_midnight_to_now_and_says_so(self):
        self.session(datetime.date.today())
        self.state(since=datetime.date.today(), replies=[GOOD])
        self.assertEqual(self.quiet(None, False), 0)
        self.assertTrue(os.path.exists(da.diary_path(datetime.date.today())))
        self.assertIn("written during the day", self.calls()[0]["stdin"])

    def test_after_writing_today_the_midnight_run_does_not_write_it_again(self):
        today = datetime.date.today()
        self.session(today)
        self.state(since=today, replies=[GOOD])
        self.quiet(None, False)
        calls = len(self.calls())
        self.assertEqual(da.tick(today + datetime.timedelta(days=1)), 0)
        self.assertEqual(len(self.calls()), calls)

    def test_forced_rewrite_replaces_the_earlier_diary(self):
        today = datetime.date.today()
        self.session(today)
        self.state(since=today, replies=[GOOD, GOOD.replace("# Diary", "# Later diary")])
        self.quiet(None, False)
        self.assertEqual(self.quiet(None, False), 2)
        self.assertEqual(self.quiet(None, True), 0)
        self.assertIn("Later diary", self.diary(today))

    def test_failed_rewrite_keeps_the_earlier_diary(self):
        today = datetime.date.today()
        self.session(today)
        self.state(since=today, replies=[GOOD, "ERROR"])
        self.quiet(None, False)
        before = self.diary(today)
        self.assertEqual(self.quiet(None, True), 1)
        self.assertEqual(self.diary(today), before)

    def test_the_open_session_is_included(self):
        self.session(D3, sid="now")
        os.environ["CLAUDE_CODE_SESSION_ID"] = "now"
        self.addCleanup(os.environ.pop, "CLAUDE_CODE_SESSION_ID", None)
        self.state(since=D3)
        self.quiet(D3.isoformat(), False)
        self.assertIn(MESSAGE, self.calls()[0]["stdin"])

    def test_existing_needs_force(self):
        Path(da.diary_path(D3)).write_text("there", encoding="utf-8")
        self.state(since=D3)
        self.assertEqual(self.quiet(D3.isoformat(), False), 2)
        self.assertEqual(self.diary(D3), "there")
        self.assertEqual(self.quiet(D3.isoformat(), True), 0)
        self.assertIn("There were no session conversations", self.diary(D3))

    def test_output_lines_carry_the_short_name(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            da.write_one((datetime.date.today() + datetime.timedelta(days=1)).isoformat(), False)
        self.assertTrue(out.getvalue().startswith("[hus-session-coach] "))


class FixesTest(Base):
    """Cases that used to stop the diary or write something wrong."""

    def quiet(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            return da.write_one(*args)

    def test_lock_left_by_a_killed_process_is_taken_over(self):
        self.session(D3)
        self.state(since=D3)
        lock = Path(da.auto_dir()) / "lock"
        lock.mkdir(parents=True)
        dead = subprocess.Popen(["true"])
        dead.wait()
        (lock / "pid").write_text(str(dead.pid))
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)
        self.assertFalse(lock.exists())

    def test_lock_of_a_live_process_is_respected(self):
        self.session(D3)
        self.state(since=D3)
        lock = Path(da.auto_dir()) / "lock"
        lock.mkdir(parents=True)
        (lock / "pid").write_text(str(os.getpid()))
        self.assertEqual(da.tick(TODAY), 0)
        self.assertEqual(self.calls(), [])

    def test_unexpected_error_counts_as_an_attempt(self):
        self.session(D3)
        self.state(since=D3)
        with mock.patch.object(da, "make_diary", side_effect=AttributeError("'str' object has no attribute 'get'")):
            self.assertEqual(da.tick(TODAY), 1)
        self.assertEqual(da.load_state()["attempts"], {D3.isoformat(): 1})

    def test_today_without_conversations_is_not_written(self):
        self.state(since=datetime.date.today())
        self.assertEqual(self.quiet(None, False), da.NOTHING_TO_WRITE)
        self.assertFalse(os.path.exists(da.diary_path(datetime.date.today())))

    def test_counted_front_matter_comes_from_the_script(self):
        self.session(D3)
        wrong = GOOD.replace("date: x\n", "date: x\nsessions: 9\nuser_turns: 40\n")
        self.state(since=D3, replies=[wrong])
        da.tick(TODAY)
        head = self.diary(D3).split("\n---", 1)[0]
        self.assertIn("sessions: 1\n", head)
        self.assertIn("user_turns: 1\n", head)
        self.assertIn("short_turns: ", head)
        self.assertNotIn("sessions: 9", head)

    def test_material_too_long_even_when_thinned_is_cut_with_a_note(self):
        self.session(D3, text=MESSAGE + " " + "x" * 3000)
        with mock.patch.object(da, "MAX_MATERIAL_CHARS", 800):
            material, info = da.build_material(D3)
        self.assertLessEqual(len(material), 800 + 100)
        self.assertIn("material cut here", material)
        self.assertGreater(info["cut"], 0)


class MaskTest(unittest.TestCase):
    def test_more_key_formats_are_masked(self):
        import day_sessions
        for key in ("sk_live_" + "a" * 24, "AIza" + "b" * 35, "eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl"):
            self.assertNotIn(key, day_sessions.mask("key " + key + " end"), key)

    def test_keys_are_masked_before_clipping(self):
        import day_sessions
        key = "sk-" + "z" * 40
        text = "a" * 60 + key + "b" * 200
        out = day_sessions.clip(day_sessions.mask(text), 80)
        self.assertNotIn("zzzzzzzzzz", out)


class SwitchTest(Base):
    def turn_on(self, *args):
        out = io.StringIO()
        with mock.patch.object(da.sys, "platform", "darwin"), contextlib.redirect_stdout(out), \
                mock.patch.object(da, "find_runner", return_value={"runner": "/opt/x/bin/claude", "runner_kind": "claude"}):
            code = da.turn_on(None, *args)
        return code, out.getvalue()

    def launchd_calls(self, verb):
        return [c.args for c in self.run_launchd.call_args_list if c.args[0] == verb]

    def test_old_diary_job_loaded_blocks_turning_on(self):
        self.run_launchd.side_effect = lambda *a: done(0 if a[0] == "print" and a[1].endswith(da.OLD_LABEL) else 1)
        code, out = self.turn_on()
        self.assertEqual(code, 2)
        self.assertIn(da.OLD_LABEL, out)
        self.assertIn(da.OLD_OFF_COMMAND, out)
        self.assertEqual(self.launchd_calls("bootstrap"), [])
        self.assertFalse(os.path.exists(da.plist_path()))
        self.assertEqual(da.load_state(), {})

    def test_old_diary_plist_left_behind_blocks_turning_on(self):
        old = Path(da.launch_agent(da.OLD_LABEL))
        self.assertTrue(str(old).startswith(str(self.fake_home)))
        old.parent.mkdir(parents=True)
        old.write_bytes(b"")
        code, out = self.turn_on()
        self.assertEqual(code, 2)
        self.assertIn("launchctl bootout", out)
        self.assertEqual(self.launchd_calls("bootstrap"), [])

    def test_without_the_old_diary_it_registers_its_own_job(self):
        self.run_launchd.side_effect = lambda *a: done(0 if a[0] == "bootstrap" else 1)
        code, out = self.turn_on("ko")
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.launchd_calls("bootstrap")), 1)
        data = plistlib.loads(Path(da.plist_path()).read_bytes())
        self.assertEqual(data["Label"], "test.label")
        self.assertEqual(data["EnvironmentVariables"]["HUS_SESSION_COACH_HOME"], str(self.data))
        self.assertTrue(data["StandardOutPath"].startswith(da.logs_dir()))
        self.assertTrue(data["ProgramArguments"][1].startswith(da.auto_dir()))
        self.assertEqual(da.load_state()["lang"], "ko")
        self.assertIn("[hus-session-coach] Turned on", out)

    def test_unknown_language_does_not_turn_on(self):
        code, out = self.turn_on("zz")
        self.assertEqual(code, 2)
        self.assertEqual(self.launchd_calls("bootstrap"), [])

    def test_status_reports_the_old_diary(self):
        self.run_launchd.side_effect = lambda *a: done(0 if a[1].endswith(da.OLD_LABEL) else 1)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            da.status(as_json=True)
        self.assertEqual(json.loads(out.getvalue()), {"on": False, "today_written": False, "old_diary_on": True})

    def test_plist_runs_on_the_hour_and_at_login_with_runner_on_path(self):
        data = da.plist_data("/py", "/app/diary_auto.py", "/opt/x/bin/claude")
        plistlib.dumps(data)
        self.assertEqual(data["StartCalendarInterval"], [{"Minute": 0}])
        self.assertTrue(data["RunAtLoad"])
        self.assertEqual(data["ProgramArguments"], ["/py", "/app/diary_auto.py", "tick"])
        self.assertTrue(data["EnvironmentVariables"]["PATH"].startswith("/opt/x/bin:"))
        self.assertTrue(data["EnvironmentVariables"]["USER"])

    def test_runner_link_is_kept_so_a_cli_update_does_not_break_it(self):
        version = self.root / "versions" / "2.1.312"
        version.parent.mkdir()
        version.write_text("", encoding="utf-8")
        link = self.root / "claude"
        link.symlink_to(version)
        self.assertEqual(da.stable_path(str(link)), str(link))

    def test_only_claude_can_write_even_if_codex_is_installed(self):
        (self.root / "bin").mkdir()
        codex = self.root / "bin" / "codex"
        codex.write_text("#!/bin/sh\n", encoding="utf-8")
        codex.chmod(0o755)
        with mock.patch.dict(os.environ, {"PATH": str(self.root / "bin")}):
            with self.assertRaises(SystemExit):
                da.find_runner()

    def make_extension(self, version, folder=".vscode"):
        program = Path(os.path.expanduser("~")) / folder / "extensions" / ("anthropic.claude-code-%s-darwin-arm64" % version) / "resources" / "native-binary" / "claude"
        program.parent.mkdir(parents=True)
        program.write_text("#!/bin/sh\n", encoding="utf-8")
        program.chmod(0o755)
        return str(program)

    def test_claude_inside_an_editor_extension_is_found_when_not_on_path(self):
        old = self.make_extension("2.1.9")
        new = self.make_extension("2.1.322")
        self.make_extension("2.1.316", folder=".vscode-insiders")
        with mock.patch.dict(os.environ, {"PATH": str(self.root / "empty")}):
            self.assertEqual(da.find_runner(), {"runner": new, "runner_kind": "claude"})  # 2.1.322 beats 2.1.9 (numbers, not text)
        self.assertNotEqual(old, new)

    def test_claude_on_path_wins_over_the_extension(self):
        self.make_extension("2.1.322")
        (self.root / "bin").mkdir()
        cli = self.root / "bin" / "claude"
        cli.write_text("#!/bin/sh\n", encoding="utf-8")
        cli.chmod(0o755)
        with mock.patch.dict(os.environ, {"PATH": str(self.root / "bin")}):
            self.assertEqual(da.find_runner()["runner"], str(cli))

    def test_a_stored_runner_that_an_extension_update_removed_is_searched_again(self):
        gone = self.make_extension("2.1.316")
        os.remove(gone)
        current = self.make_extension("2.1.322")
        state = {"runner": gone}
        with mock.patch.dict(os.environ, {"PATH": str(self.root / "empty")}):
            self.assertEqual(da.live_runner(state), current)
        self.assertEqual(state["runner"], current)

    def test_a_stored_runner_that_still_exists_is_kept(self):
        here = self.make_extension("2.1.316")
        self.make_extension("2.1.322")
        self.assertEqual(da.live_runner({"runner": here}), here)

    def test_no_claude_anywhere_is_a_readable_error(self):
        with mock.patch.dict(os.environ, {"PATH": str(self.root / "empty")}):
            with self.assertRaises(RuntimeError) as caught:
                da.live_runner({"runner": "/gone/claude"})
        self.assertIn("claude command was not found", str(caught.exception))

    def test_shell_scoped_runner_path_is_resolved(self):
        real = self.root / "node" / "codex"
        real.parent.mkdir()
        real.write_text("", encoding="utf-8")
        shell = self.root / "fnm_multishells" / "1" / "codex"
        shell.parent.mkdir(parents=True)
        shell.symlink_to(real)
        self.assertEqual(da.stable_path(str(shell)), os.path.realpath(real))

    def test_app_copy_leaves_tests_out_and_can_find_its_references_and_languages(self):
        script = da.copy_app()
        app = Path(script).parents[1]
        self.assertTrue(str(app).startswith(da.home()))
        self.assertTrue((app / "references" / "write.md").exists())
        self.assertTrue((app / "locales" / "ko.json").exists())
        self.assertFalse((app / "scripts" / "test_diary_auto.py").exists())
        self.assertFalse((app / "scripts" / "test_samples.ko.json").exists())
        self.assertTrue((app / "scripts" / "day_sessions.py").exists())


class SourceTest(Base):
    """The job follows the plugin it was copied from: refreshed after an update, turned off once it is removed."""

    def plugin(self, version, where=None):
        """A copy of this plugin's diary skill at where (default: Claude Code's cache), with a plugin.json."""
        root = where or (self.fake_home / ".claude" / "plugins" / "cache" / "hus" / da.PLUGIN_NAME / version)
        skill = root / "skills" / "session-diary"
        shutil.copytree(da.skill_dir(), skill, ignore=shutil.ignore_patterns("__pycache__", "test_*"))
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".claude-plugin" / "plugin.json").write_text(json.dumps({"version": version}), encoding="utf-8")
        return root, skill

    def record(self, *roots):
        path = self.fake_home / ".claude" / "plugins" / "installed_plugins.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        plugins = {"%s@hus" % da.PLUGIN_NAME: [{"scope": "user", "installPath": str(r)} for r in roots]} if roots else {}
        path.write_text(json.dumps({"version": 2, "plugins": plugins}), encoding="utf-8")

    def turned_on_from(self, skill):
        self.state(since=D3)
        state = da.load_state()
        da.refresh_app(state, str(skill))
        da.save_state(state)

    def test_an_updated_plugin_refreshes_the_copy_before_writing(self):
        old_root, old_skill = self.plugin("0.4.0")
        self.record(old_root)
        self.turned_on_from(old_skill)
        self.assertEqual(da.load_state()["app_version"], "0.4.0")
        new_root, new_skill = self.plugin("0.5.0")
        (new_skill / "references" / "write.md").write_text("new rules", encoding="utf-8")
        shutil.rmtree(old_root)
        self.record(new_root)
        self.assertEqual(da.tick(TODAY), 0)
        state = da.load_state()
        self.assertEqual(state["app_version"], "0.5.0")
        self.assertEqual(state["source"], str(new_skill))
        self.assertEqual((Path(da.app_dir()) / "references" / "write.md").read_text(encoding="utf-8"), "new rules")

    def test_a_removed_plugin_writes_nothing_then_turns_the_diary_off(self):
        root, skill = self.plugin("0.4.0")
        self.record(root)
        self.turned_on_from(skill)
        Path(da.plist_path()).parent.mkdir(parents=True, exist_ok=True)
        Path(da.plist_path()).write_bytes(b"")
        self.session(D3)
        # Uninstalled: Claude Code's record no longer lists it, though the cache folder stays behind.
        self.record()
        self.assertEqual(da.tick(TODAY), 0)
        self.assertEqual(self.calls(), [])
        self.assertTrue(da.load_state().get("since"))
        self.assertTrue(os.path.exists(da.plist_path()))
        with mock.patch.object(da.time, "time", return_value=time.time() + da.GONE_AFTER_SECONDS + 1), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(da.tick(TODAY), 0)
        self.assertEqual(self.calls(), [])
        self.assertNotIn("since", da.load_state())
        self.assertFalse(os.path.exists(da.plist_path()))
        self.assertIn("no longer installed", self.notifications.call_args.args[1])

    def test_a_plugin_back_after_one_miss_carries_on(self):
        root, skill = self.plugin("0.4.0")
        self.record(root)
        self.turned_on_from(skill)
        self.record()
        da.tick(TODAY)
        self.record(root)
        self.session(D3)
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)
        self.assertNotIn("source_missing_since", da.load_state())

    def test_outside_claude_code_the_folder_itself_decides(self):
        _, skill = self.plugin("0.4.0", where=self.root / "codex-skills" / "hus")
        self.turned_on_from(skill)
        self.session(D3)
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)
        shutil.rmtree(skill)
        da.tick(TODAY + datetime.timedelta(days=1))
        self.assertIn("source_missing_since", da.load_state())

    def test_an_unreadable_install_record_falls_back_to_the_folder(self):
        root, skill = self.plugin("0.4.0")
        self.turned_on_from(skill)
        self.assertEqual(da.check_source(da.load_state()), "ok")

    def test_state_from_an_older_version_is_left_alone(self):
        self.state(since=D3)
        self.session(D3)
        da.tick(TODAY)
        self.assertEqual(len(self.calls()), 1)

    def test_sync_points_the_job_at_these_scripts(self):
        self.state(since=D3)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(da.sync(), 0)
        state = da.load_state()
        self.assertEqual(state["source"], da.skill_dir())
        self.assertEqual(state["app_version"], json.loads(
            (Path(da.skill_dir()).parents[1] / ".claude-plugin" / "plugin.json").read_text())["version"])
        self.assertTrue((Path(da.app_dir()) / "scripts" / "diary_auto.py").exists())

    def test_sync_does_nothing_while_off(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(da.sync(), 0)
        self.assertFalse(os.path.exists(da.app_dir()))

    def test_the_copy_is_never_recorded_as_its_own_source(self):
        state = {}
        da.copy_app()
        da.refresh_app(state, da.app_dir())
        self.assertNotIn("source", state)


class BootstrapTest(Base):
    def turn_on(self):
        out = io.StringIO()
        with mock.patch.object(da.sys, "platform", "darwin"), contextlib.redirect_stdout(out), \
                mock.patch.object(da, "pause"), \
                mock.patch.object(da, "find_runner", return_value={"runner": "/opt/x/bin/claude", "runner_kind": "claude"}):
            code = da.turn_on(None)
        return code, out.getvalue()

    def bootstraps(self):
        return [c for c in self.run_launchd.call_args_list if c.args[0] == "bootstrap"]

    def test_a_bootstrap_that_fails_once_is_tried_again(self):
        answers = iter([done(5, "Bootstrap failed: 5: Input/output error"), done(0)])
        self.run_launchd.side_effect = lambda *a: next(answers) if a[0] == "bootstrap" else done(1)
        code, out = self.turn_on()
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.bootstraps()), 2)
        self.assertTrue(os.path.exists(da.plist_path()))

    def test_a_bootstrap_that_keeps_failing_leaves_it_off_and_clean(self):
        self.run_launchd.side_effect = lambda *a: done(5, "Bootstrap failed: 5: Input/output error") if a[0] == "bootstrap" else done(1)
        code, out = self.turn_on()
        self.assertEqual(code, 1)
        self.assertEqual(len(self.bootstraps()), da.BOOTSTRAP_TRIES)
        self.assertFalse(os.path.exists(da.plist_path()))
        self.assertNotIn("since", da.load_state())
        self.assertIn("It is off", out)


class MigrateTest(Base):
    def old(self):
        diary = self.fake_home / ".session-diary"
        (diary / ".auto").mkdir(parents=True)
        (diary / "2026-10-01.md").write_text("old diary 1", encoding="utf-8")
        (diary / "2026-10-02.md").write_text("old diary 2", encoding="utf-8")
        (diary / "notes.txt").write_text("not a diary", encoding="utf-8")
        (diary / ".auto" / "state.json").write_text(json.dumps({"lang": "ko", "model": "opus", "since": "2026-01-01"}),
                                                    encoding="utf-8")
        playbook = self.fake_home / ".session-playbook"
        playbook.mkdir()
        (playbook / "2026-10-03-copy.md").write_text("know-how", encoding="utf-8")
        (playbook / ".last-list.json").write_text("[]", encoding="utf-8")

    def migrate(self, dry_run=False):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = da.migrate(dry_run)
        return code, out.getvalue()

    def test_copies_diaries_playbook_files_and_settings_without_overwriting(self):
        self.old()
        Path(da.diary_path(D2)).write_text("mine already", encoding="utf-8")
        code, out = self.migrate()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.diary(D1), "old diary 1")
        self.assertEqual(self.diary(D2), "mine already")
        self.assertFalse(os.path.exists(os.path.join(da.home(), "notes.txt")))
        self.assertEqual((self.data / "session-playbook" / "2026-10-03-copy.md").read_text(encoding="utf-8"), "know-how")
        self.assertFalse((self.data / "session-playbook" / ".last-list.json").exists())
        state = da.load_state()
        self.assertEqual((state["lang"], state["model"]), ("ko", "opus"))
        self.assertNotIn("since", state)
        self.assertTrue((self.fake_home / ".session-diary" / "2026-10-01.md").exists())
        self.assertIn("2026-10-02.md", out)

    def test_a_dry_run_copies_nothing(self):
        self.old()
        code, out = self.migrate(dry_run=True)
        self.assertEqual(code, 0)
        self.assertIn("Would copy 3 files", out)
        self.assertFalse(os.path.exists(da.diary_path(D1)))
        self.assertEqual(da.load_state(), {})

    def test_the_old_diary_still_on_stops_it(self):
        self.old()
        self.run_launchd.side_effect = lambda *a: done(0 if a[0] == "print" and a[1].endswith(da.OLD_LABEL) else 1)
        code, out = self.migrate()
        self.assertEqual(code, 2)
        self.assertIn(da.OLD_OFF_COMMAND, out)
        self.assertFalse(os.path.exists(da.diary_path(D1)))

    def test_nothing_old_says_so(self):
        code, out = self.migrate()
        self.assertEqual(code, 0)
        self.assertIn("Nothing to copy", out)


class CompassMaterialTest(Base):
    def log(self, sid, *events):
        path = self.data / "session-compass" / "judge-log" / "-home-a-proj" / ("%s.jsonl" % sid)
        path.parent.mkdir(parents=True, exist_ok=True)
        # 01:00 UTC is 10:00 in Seoul, the same day as the session.
        at = "%sT01:00:00.000Z" % D3.isoformat()
        path.write_text("".join(json.dumps(dict(e, at=at), ensure_ascii=False) + "\n" for e in events), encoding="utf-8")

    def test_goals_and_how_they_ended_go_into_the_material(self):
        self.session(D3, sid="s1")
        self.log("s1",
                 {"event": "goal-set", "destination": "Landing copy", "done": "CTA approved", "rows": 3},
                 {"event": "judge", "ok": True, "goal": "Landing copy", "kind": "up"},
                 {"event": "judge", "ok": True, "goal": "Landing copy", "kind": "flat"},
                 {"event": "judge", "ok": False, "goal": "Landing copy"},
                 {"event": "judge", "ok": True, "goal": "Landing copy", "kind": "arrive"},
                 {"event": "arrive-not-yet", "goal": "Landing copy"},
                 {"event": "arrive-finish", "goal": "Landing copy"})
        self.log("other", {"event": "goal-set", "destination": "Not in the material", "done": "-", "rows": 2})
        material, _ = da.build_material(D3)
        self.assertIn("## Goals I set with session-compass", material)
        self.assertIn("goal: Landing copy; done when: CTA approved", material)
        self.assertIn("judged turns: 3 (closer 1, standing still 1, further away 0)", material)
        self.assertIn("could not judge 1", material)
        self.assertIn("I answered 'not yet' 1 times", material)
        self.assertIn("end: I marked it finished", material)
        self.assertNotIn("Not in the material", material)
        self.assertLess(material.index("## Goals"), material.index("## Session "))

    def test_no_log_means_no_goals_section(self):
        self.session(D3)
        material, _ = da.build_material(D3)
        self.assertNotIn("## Goals", material)

    def test_each_record_file_is_read_once(self):
        self.session(D3, sid="s1")
        sub = self.claude / "proj" / "s1" / "subagents" / "agent-1.jsonl"
        sub.parent.mkdir(parents=True)
        sub.write_text(json.dumps(user_row(D3)) + "\n", encoding="utf-8")
        opened = Counter()
        real = da.day_sessions.read_jsonl

        def counting(path, stats):
            opened[path] += 1
            return real(path, stats)

        with mock.patch.object(da.day_sessions, "read_jsonl", side_effect=counting):
            da.build_material(D3)
        self.assertTrue(opened)
        self.assertEqual(max(opened.values()), 1, opened)


if __name__ == "__main__":
    unittest.main()
