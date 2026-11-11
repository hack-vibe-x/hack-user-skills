"""Tests for day_sessions and check_quotes. Fake records only, in temporary folders.
Run: cd skills/session-diary/scripts && python3 -m unittest -v test_day_sessions
"""
import argparse
import datetime
import json
import os
import subprocess
import tempfile
import time
import unittest
from collections import Counter
from pathlib import Path

import check_quotes as cq
import day_sessions as ds
import i18n

DAY = datetime.date(2026, 10, 1)
TMP = "hus-session-coach-test-"
KO = json.loads((Path(__file__).parent / "test_samples.ko.json").read_text(encoding="utf-8"))


def at(hour, minute=0, day=1):
    return "2026-10-%02dT%02d:%02d:00+09:00" % (day, hour, minute)


def c_user(text, when=None, **kw):
    row = {"type": "user", "sessionId": "s1", "cwd": "/home/a/proj", "timestamp": when or at(10),
           "entrypoint": "cli", "message": {"role": "user", "content": text}}
    row.update(kw)
    return row


def c_ai(text, when=None, **kw):
    row = {"type": "assistant", "sessionId": "s1", "cwd": "/home/a/proj", "timestamp": when or at(10, 1),
           "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "private"},
                                                         {"type": "text", "text": text}]}}
    row.update(kw)
    return row


def x_meta(sid="x1", cwd="/home/a/proj", source="cli", originator="codex-tui"):
    return {"type": "session_meta", "timestamp": at(9), "payload": {"id": sid, "cwd": cwd, "source": source, "originator": originator}}


def x_user(text, when=None):
    return {"type": "event_msg", "timestamp": when or at(9, 1), "payload": {"type": "user_message", "message": text}}


def x_ai(text, when=None):
    return {"type": "response_item", "timestamp": when or at(9, 2),
            "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tz = os.environ.get("TZ")
        os.environ["TZ"] = "Asia/Seoul"
        time.tzset()
        self.tmp = tempfile.TemporaryDirectory(prefix=TMP)
        self.root = Path(self.tmp.name)
        self.claude = self.root / "claude"
        self.codex = self.root / "codex"
        self.n = 0

    def tearDown(self):
        self.tmp.cleanup()
        if self.tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self.tz
        time.tzset()

    def write(self, path, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")

    def claude_session(self, rows, name=None):
        self.n += 1
        self.write(self.claude / "proj" / ("%s.jsonl" % (name or self.n)), rows)

    def collect(self, exclude=()):
        args = argparse.Namespace(claude_dir=str(self.claude), codex_dir=str(self.codex), exclude_session=list(exclude))
        self.stats = Counter()
        return ds.collect(args, DAY, self.stats)


class DayFilterTest(Base):
    def test_turns_are_cut_by_local_date_not_session_start(self):
        self.claude_session([c_user("said yesterday", "2026-09-30T23:50:00+09:00"),
                             c_user("said today", at(0, 10)),
                             c_user("said tomorrow", "2026-10-02T00:10:00+09:00")])
        turns = self.collect()[0]["turns"]
        self.assertEqual([t["text"] for t in turns], ["said today"])

    def test_utc_timestamp_is_read_in_local_time(self):
        self.claude_session([c_user("early on the 1st in Seoul", "2026-09-30T16:00:00Z")])
        self.assertEqual(len(self.collect()), 1)

    def test_session_without_user_turn_that_day_is_dropped(self):
        self.claude_session([c_ai("only the AI spoke")])
        self.assertEqual(self.collect(), [])


class HumanOnlyTest(Base):
    def test_user_rows_with_no_reply_between_count_as_one_turn(self):
        self.claude_session([c_user("first"), c_user("second", at(10, 1))])
        self.assertEqual(ds.facts(self.collect())["user_turns"], 1)

    def test_machine_rows_are_dropped(self):
        self.claude_session([
            c_user("a person speaking"),
            c_user("meta", isMeta=True),
            c_user("summary", isCompactSummary=True),
            c_user("notice", origin={"kind": "task-notification"}),
            c_user("side branch", isSidechain=True),
            c_user("<command-name>/x</command-name>"),
            c_user([{"type": "tool_result", "content": "result"}]),
        ])
        turns = self.collect()[0]["turns"]
        self.assertEqual([t["text"] for t in turns], ["a person speaking"])

    def test_ai_keeps_text_blocks_only(self):
        self.claude_session([c_user("question"), c_ai("answer")])
        self.assertEqual(self.collect()[0]["turns"][1]["text"], "answer")

    def test_ide_block_is_stripped_and_typed_text_kept(self):
        self.assertEqual(ds.clean_user_text("<ide_selection>code</ide_selection>\ntidy this up"), "tidy this up")

    def test_pasted_content_is_shortened(self):
        out = ds.clean_user_text('<pasted_content id="a">%s</pasted_content id="a">\nsummarise this' % ("x" * 1000))
        self.assertIn("[pasted]", out)
        self.assertIn("summarise this", out)
        self.assertLess(len(out), 400)

    def test_korean_text_is_kept_as_typed(self):
        self.claude_session([c_user(KO["message"])])
        self.assertEqual(self.collect()[0]["turns"][0]["text"], KO["message"])


class AutomationTest(Base):
    def test_sdk_entrypoint_is_dropped(self):
        self.claude_session([c_user("automatic", entrypoint="sdk-cli")])
        self.assertEqual(self.collect(), [])
        self.assertEqual(self.stats["left out: launched by a program"], 1)

    def test_temp_folder_is_dropped_but_similar_name_is_not(self):
        self.claude_session([c_user("temporary", cwd="/private/var/folders/ab/T/usersim-x", sessionId="a")])
        self.claude_session([c_user("real", cwd="/home/a/tmp-notes", sessionId="b")])
        self.assertEqual([s["id"] for s in self.collect()], ["b"])

    def test_current_session_is_dropped(self):
        self.claude_session([c_user("write the diary", sessionId="now")])
        self.assertEqual(self.collect(exclude=["now"]), [])

    def test_templated_short_sessions_are_dropped(self):
        for i in range(3):
            self.claude_session([c_user("You are reviewing code %d" % i, sessionId="t%d" % i)])
        rows = [c_user("You are reviewing code 9", at(10), sessionId="long")]
        for i in range(3):
            rows += [c_ai("answer %d" % i, at(11, i * 2), sessionId="long"), c_user("more %d" % i, at(11, i * 2 + 1), sessionId="long")]
        self.claude_session(rows)
        self.assertEqual([s["id"] for s in self.collect()], ["long"])

    def test_two_sessions_with_same_opening_are_kept(self):
        for i in range(2):
            self.claude_session([c_user("please sort out today's to-do list", sessionId="t%d" % i)])
        self.assertEqual(len(self.collect()), 2)


class CodexTest(Base):
    def codex_session(self, rows, name="r"):
        self.write(self.codex / "sessions" / "2026" / "10" / "01" / ("%s.jsonl" % name), rows)

    def test_reads_turns(self):
        self.codex_session([x_meta(), x_user("codex question"), x_ai("codex answer")])
        s = self.collect()[0]
        self.assertEqual(s["tool"], "Codex")
        self.assertEqual([t["text"] for t in s["turns"]], ["codex question", "codex answer"])

    def test_exec_is_dropped(self):
        self.codex_session([x_meta(source="exec", originator="codex_exec"), x_user("automatic instruction")])
        self.assertEqual(self.collect(), [])

    def test_subagent_is_dropped(self):
        self.codex_session([x_meta(source={"subagent": "x"}), x_user("sub-task")])
        self.assertEqual(self.collect(), [])

    def test_imported_copy_is_dropped(self):
        self.codex_session([x_meta(sid="copy"), x_user("imported copy")])
        self.codex.mkdir(parents=True, exist_ok=True)
        (self.codex / "external_agent_session_imports.json").write_text(
            json.dumps({"records": [{"imported_thread_id": "copy"}]}), encoding="utf-8")
        self.assertEqual(self.collect(), [])


class RenderTest(Base):
    def test_secrets_are_masked(self):
        for leak in ("sk-abcdefghijklmnopqrstuvwx", "ghp_abcdefghijklmnopqrstuvwx", "AKIAABCDEFGHIJKLMNOP"):
            self.assertNotIn(leak, ds.mask("the key is %s ok" % leak))
        out = ds.mask("password=hunter2 and plain words")
        self.assertNotIn("hunter2", out)
        self.assertIn("plain words", out)
        self.assertIn("[redacted]", out)

    def test_facts_count_short_turns_and_skip_idle_gaps(self):
        self.claude_session([c_user("a first question, written out at length", at(9)), c_ai("answer", at(9, 5)), c_user("yes", at(9, 10)),
                             c_ai("answer", at(9, 11)), c_user("started again two hours later", at(11, 10))])
        f = ds.facts(self.collect())
        self.assertEqual((f["user_turns"], f["short_turns"]), (3, 1))
        self.assertEqual((f["first"], f["last"]), ("09:00", "11:10"))
        self.assertEqual(f["active_minutes"], 10)

    def test_clip_keeps_head_and_tail(self):
        out = ds.clip("h" * 500 + "t" * 500, 300)
        self.assertTrue(out.startswith("h"))
        self.assertTrue(out.endswith("t"))
        self.assertIn("chars cut", out)

    def test_worktree_groups_under_repo_and_only_folder_name_is_printed(self):
        self.claude_session([c_user("work", cwd="/home/a/proj/.claude/worktrees/x")])
        text = ds.render(DAY, self.collect(), {}, Counter())
        self.assertIn("## Session proj ", text)
        self.assertNotIn("/home/a", text)

    def test_material_is_english_around_the_person_s_words(self):
        self.claude_session([c_user(KO["message"]), c_ai("ok")])
        text = ds.render(DAY, self.collect(), {}, Counter())
        self.assertIn("[10:00 me] " + KO["message"], text)
        self.assertIn("## Facts", text)

    def test_commits_come_from_git_and_repeats_collapse(self):
        repo = self.root / "proj"
        repo.mkdir()
        env = {**os.environ, "GIT_AUTHOR_DATE": at(10), "GIT_COMMITTER_DATE": at(10)}

        def git(*a):
            subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, env=env)

        git("init")
        git("config", "user.email", "me@example.com")
        git("config", "user.name", "me")
        for subject in ("auto snapshot", "auto snapshot", "add feature"):
            git("commit", "--allow-empty", "-m", subject)
        result = ds.commits([{"cwd": str(repo)}], DAY, Counter())
        total, lines = result["proj"]
        self.assertEqual((total, len(lines)), (3, 2))
        self.assertIn("2 with the same subject", lines[0])

    def test_repo_one_level_down_is_found(self):
        parent = self.root / "studio"
        repo = parent / "studio-dev"
        repo.mkdir(parents=True)
        (parent / "notes").mkdir()
        env = {**os.environ, "GIT_AUTHOR_DATE": at(10), "GIT_COMMITTER_DATE": at(10)}
        for args in (("init",), ("config", "user.email", "me@example.com"), ("config", "user.name", "me"),
                     ("commit", "--allow-empty", "-m", "feature")):
            subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)
        stats = Counter()
        self.assertEqual(ds.commits([{"cwd": str(parent)}], DAY, stats)["studio-dev"][0], 1)
        self.assertEqual(sum(stats.values()), 0)

    def test_same_commit_in_two_copies_is_listed_once(self):
        parent = self.root / "studio"
        first = parent / "dev"
        first.mkdir(parents=True)
        env = {**os.environ, "GIT_AUTHOR_DATE": at(10), "GIT_COMMITTER_DATE": at(10)}

        def git(repo, *a):
            subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, env=env)

        git(first, "init")
        git(first, "config", "user.email", "me@example.com")
        git(first, "config", "user.name", "me")
        git(first, "commit", "--allow-empty", "-m", "feature")
        subprocess.run(["git", "clone", "-q", str(first), str(parent / "use")], check=True, capture_output=True)
        git(parent / "use", "config", "user.email", "me@example.com")
        self.assertEqual(sum(t for t, _ in ds.commits([{"cwd": str(parent)}], DAY, Counter()).values()), 1)

    def test_is_question(self):
        for text in ["what is #2?", "is this right?"] + KO["questions"]:
            self.assertTrue(ds.is_question(text), text)
        for text in ["the reason is clear, just carry on", "this long sentence ends with a question mark but is over forty characters?"] + KO["not_questions"]:
            self.assertFalse(ds.is_question(text), text)

    def test_ai_reply_before_a_short_question_is_kept_longer(self):
        long = "explaining " * 400
        self.claude_session([c_user("the first request", at(9)), c_ai(long, at(9, 1)), c_user("what is #2?", at(9, 2)),
                             c_ai(long, at(9, 3)), c_user("good, carry on as it is please", at(9, 4)), c_ai("done", at(9, 5))])
        text = ds.render(DAY, self.collect(), {}, Counter())
        first, second = text.split("[09:01 AI]")[1], text.split("[09:03 AI]")[1]
        self.assertGreater(len(first.split("[09:02")[0]), ds.AI_KEEP + 200)
        self.assertLess(len(second.split("[09:04")[0]), ds.AI_KEEP + 60)

    def test_folder_that_is_not_git_is_counted_not_fatal(self):
        stats = Counter()
        self.assertEqual(ds.commits([{"cwd": str(self.root)}], DAY, stats), {})
        self.assertEqual(stats["could not read commits in folder " + self.root.name], 1)

    def test_empty_day_writes_a_file_and_exits_zero(self):
        out = self.root / "out.md"
        code = ds.main(["--date", "2026-10-01", "--claude-dir", str(self.claude), "--codex-dir", str(self.codex),
                        "--exclude-session", "", "--out", str(out)])
        self.assertEqual(code, 0)
        self.assertIn("Sessions: 0", out.read_text(encoding="utf-8"))


class QuoteTest(unittest.TestCase):
    MATERIAL = """## Facts
- Sessions: 1

## Session proj · Claude Code · 10:00~10:05 · 1 messages from me
[10:00 me] let us check more so
we said
[10:01 AI] understood, I will fix it
"""

    def check(self, diary):
        return cq.problems(diary, self.MATERIAL)

    def test_quote_with_right_time_and_speaker(self):
        self.assertEqual(self.check("“let us check more”(10:00), “so we said”(10:00), “I will fix it”(10:01 AI)"), (3, []))

    def test_made_up_quote_is_reported(self):
        self.assertEqual(self.check("“never said this”(10:00)")[1], [(cq.NOT_IN_MATERIAL, "never said this")])

    def test_ai_words_given_as_mine_are_reported(self):
        self.assertEqual(self.check("“I will fix it”(10:01)")[1][0][0], cq.WRONG_PLACE)

    def test_wrong_time_is_reported(self):
        self.assertEqual(self.check("“let us check more”(11:00)")[1][0][0], cq.WRONG_PLACE)

    def test_quote_without_time_is_reported(self):
        self.assertEqual(self.check("“let us check more”")[1][0][0], cq.NO_TIME)

    def test_facts_section_is_not_quotable(self):
        self.assertEqual(self.check("“Sessions: 1”(10:01 AI)")[1][0][0], cq.NOT_IN_MATERIAL)

    def test_repair_fills_a_missing_or_wrong_citation_when_the_place_is_unique(self):
        fixed = cq.repair("“let us check more”, “I will fix it”(10:00)", self.MATERIAL)
        self.assertEqual(fixed, "“let us check more”(10:00), “I will fix it”(10:01 AI)")
        self.assertEqual(cq.problems(fixed, self.MATERIAL)[1], [])

    def test_repair_leaves_made_up_and_ambiguous_quotes(self):
        material = "[10:00 me] good\n[10:01 AI] answer\n[10:02 me] good\n"
        self.assertEqual(cq.repair("“not said”, “good”", material), "“not said”, “good”")

    def test_quote_from_an_earlier_diary_is_not_wrong(self):
        self.assertEqual(cq.problems("“said yesterday”", "[10:00 me] today\n", "earlier diary: “said yesterday”(09:00)")[1], [])

    def test_broken_reference_numbers_are_removed_from_the_body(self):
        diary = "The body[1] and also[2].\n\n## Evidence\n[1] task: “words”(10:00)\n"
        self.assertEqual(cq.drop_broken_refs(diary), "The body[1] and also.\n\n## Evidence\n[1] task: “words”(10:00)\n")

    def test_references_are_renumbered_in_reading_order(self):
        diary = "front[6] back[2][6].\n\n## Evidence\n[2] later: “two”(10:01)\n[6] first: “one”(10:00)\n[9] unused: “three”(10:02)\n\n---\nend\n"
        self.assertEqual(cq.renumber_refs(diary),
                         "front[1] back[2][1].\n\n## Evidence\n[1] first: “one”(10:00)\n[2] later: “two”(10:01)\n[3] unused: “three”(10:02)\n\n---\nend\n")

    def test_without_an_evidence_section_all_numbers_go(self):
        self.assertEqual(cq.drop_broken_refs("The body [1]."), "The body.")

    def test_heading_inside_a_turn_does_not_cut_it(self):
        material = "## Session p · C · 10:00~10:05 · 1 messages from me\n[10:00 AI] before\n## A sub-heading\nthe sentence after\n"
        self.assertEqual(cq.problems("“the sentence after”(10:00 AI)", material), (1, []))

    def test_no_quotes(self):
        self.assertEqual(self.check("no quotes"), (0, []))

    def test_korean_diary_uses_its_own_quote_marks_and_evidence_heading(self):
        ko = i18n.T("ko")
        left, right = ko("quote.open"), ko("quote.close")
        material = "[10:00 me] %s\n" % KO["message"]
        quote = left + KO["message"] + right
        self.assertEqual(cq.repair(quote, material, "ko"), quote + "(10:00)")
        self.assertEqual(cq.problems(quote + "(10:00)", material, lang="ko"), (1, []))
        diary = "x[1] y[2].\n\n## %s\n[1] a: %s(10:00)\n" % (ko("diary.h.evidence"), quote)
        self.assertEqual(cq.drop_broken_refs(diary, "ko"), diary.replace(" y[2]", " y"))
        # English quote marks are plain text in a Korean diary.
        self.assertEqual(cq.problems("“anything”", material, lang="ko"), (0, []))


class LocaleTest(unittest.TestCase):
    def test_unknown_or_unsafe_codes_fall_back_to_english(self):
        for code in ("../x", "xx", "KO", "", None, 3):
            self.assertEqual(i18n.pick(code), "en", code)
        self.assertEqual(i18n.pick("ko"), "ko")

    def test_every_language_file_has_the_english_keys_and_placeholders(self):
        en = i18n.T("en").strings
        for code in i18n.languages():
            other = json.loads(Path(i18n.LOCALES, code + ".json").read_text(encoding="utf-8"))
            for key, value in other.items():
                self.assertIn(key, en, (code, key))
                self.assertEqual(sorted(i18n.re.findall(r"\{(\w+)\}", value)), sorted(i18n.re.findall(r"\{(\w+)\}", en[key])), (code, key))

    def test_missing_key_shows_its_name(self):
        self.assertEqual(i18n.T("ko")("no.such.key"), "no.such.key")


if __name__ == "__main__":
    unittest.main()
