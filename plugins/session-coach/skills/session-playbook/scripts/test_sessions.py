"""Tests for sessions.py. Fake records only, in temporary folders.
Run: cd skills/session-playbook/scripts && python3 -m unittest -v test_sessions
"""
import argparse
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import sessions as sp

TMP = "hus-session-coach-test-"


def row(kind, content, **kw):
    r = {"type": kind, "cwd": "/home/a/proj", "timestamp": "2026-11-01T10:00:00+09:00",
         "entrypoint": "cli", "message": {"content": content}}
    r.update(kw)
    return r


def write(root, project, sid, rows):
    d = Path(root) / project
    d.mkdir(parents=True, exist_ok=True)
    p = d / (sid + ".jsonl")
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    return p


class ParseTest(unittest.TestCase):
    def test_human_turns_title_and_tools(self):
        with tempfile.TemporaryDirectory(prefix=TMP) as t:
            p = write(t, "p", "abc", [
                {"type": "ai-title", "aiTitle": "Title"},
                row("user", "<system-reminder>x</system-reminder>"),
                row("user", "first request token=abc123secret"),
                row("assistant", [{"type": "text", "text": "answer"},
                                  {"type": "tool_use", "name": "Edit", "input": {"file_path": "/a/b.md"}}]),
                row("user", [{"type": "tool_result", "content": "x"}]),
                row("user", "automatic", isMeta=True),
                row("user", "notice", origin={"kind": "task-notification"}),
                row("user", "side", isSidechain=True),
            ])
            s = sp.parse(str(p))
            self.assertEqual(s["title"], "Title")
            self.assertEqual([x["role"] for x in s["turns"]], ["user", "assistant"])
            self.assertEqual(s["tools"]["Edit"], 1)
            self.assertEqual(s["files"], ["/a/b.md"])
            self.assertNotIn("abc123secret", "\n".join(sp.render(s, 10000)))

    def test_is_mine_drops_headless_temp_and_current(self):
        base = {"turns": [{"role": "user", "text": "x", "at": None}], "headless": False, "cwd": "/home/a", "id": "i"}
        self.assertTrue(sp.is_mine(base, ""))
        self.assertFalse(sp.is_mine(dict(base, headless=True), ""))
        self.assertFalse(sp.is_mine(dict(base, cwd="/tmp/x"), ""))
        self.assertFalse(sp.is_mine(base, "i"))
        self.assertFalse(sp.is_mine(dict(base, turns=[]), ""))

    def test_render_trims_middle_and_keeps_ends(self):
        s = {"turns": [{"role": "user", "text": "turn%d " % i + "a" * 100, "at": None} for i in range(40)]}
        out = "\n".join(sp.render(s, 1500))
        self.assertIn("turn0 ", out)
        self.assertIn("turn39 ", out)
        self.assertIn("turns cut", out)

    def test_list_then_show_by_number(self):
        with tempfile.TemporaryDirectory(prefix=TMP) as t, tempfile.TemporaryDirectory(prefix=TMP) as state, \
                mock.patch.multiple(sp, STATE_DIR=state, LAST_LIST=os.path.join(state, "last.json")):
            write(t, "p", "aaa111", [row("user", "start the work"), row("assistant", [{"type": "text", "text": "ok"}])])
            args = argparse.Namespace(claude_dir=t, codex_dir=os.path.join(t, "none"), days=3650, limit=5)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                sp.cmd_list(args)
                sp.cmd_show(argparse.Namespace(refs=["1"], budget=5000, claude_dir=t, codex_dir=args.codex_dir))
            self.assertIn("1. ", out.getvalue())
            self.assertIn("id aaa111", out.getvalue())
            self.assertIn("[me] start the work", out.getvalue())
            self.assertIn("[hus-session-coach]", out.getvalue())

    def test_data_folder_is_a_sub_folder_of_the_plugin_home_folder(self):
        self.assertEqual(sp.STATE_DIR, os.path.join(sp.DATA_ROOT, "session-playbook"))
        if not os.environ.get("HUS_SESSION_COACH_HOME"):
            self.assertEqual(sp.DATA_ROOT, os.path.expanduser("~/.hus-session-coach"))


def codex_rows(sid, *rest, source="cli", cwd="/home/a/proj"):
    meta = {"type": "session_meta", "timestamp": "2026-11-01T09:00:00+09:00",
            "payload": {"id": sid, "cwd": cwd, "source": source}}
    return [meta] + [dict(r, timestamp=r.get("timestamp", "2026-11-01T10:00:00+09:00")) for r in rest]


def codex_user(text):
    return {"type": "event_msg", "payload": {"type": "user_message", "message": text}}


def codex_ai(text):
    return {"type": "response_item", "payload": {"type": "message", "role": "assistant",
                                                 "content": [{"type": "output_text", "text": text}]}}


def write_codex(root, sid, rows):
    d = Path(root) / "sessions" / "2026" / "11" / "01"
    d.mkdir(parents=True, exist_ok=True)
    p = d / ("rollout-2026-11-01T10-00-00-%s.jsonl" % sid)
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    return p


CODEX_ID = "01a1b0cb-3f5e-7ab3-b23f-481c03b1e2e9"


class CodexTest(unittest.TestCase):
    def test_codex_session_turns_tools_and_patched_files(self):
        with tempfile.TemporaryDirectory(prefix=TMP) as t:
            patch = "*** Begin Patch\n*** Update File: src/app.py\n@@\n*** Add File: docs/new.md\n*** End Patch"
            p = write_codex(t, CODEX_ID, codex_rows(
                CODEX_ID,
                {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
                    {"type": "input_text", "text": "<environment_context>x</environment_context>"}]}},
                codex_user("fix the slug tool"),
                {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "apply_patch", "input": patch}},
                {"type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "arguments": "{}"}},
                codex_ai("fixed it")))
            s = sp.parse(str(p))
            self.assertEqual(s["tool"], "Codex")
            self.assertEqual(s["id"], CODEX_ID)
            self.assertEqual([(x["role"], x["text"]) for x in s["turns"]], [("user", "fix the slug tool"), ("assistant", "fixed it")])
            self.assertEqual(s["tools"]["apply_patch"], 1)
            self.assertEqual(s["files"], ["src/app.py", "docs/new.md"])
            self.assertTrue(sp.is_mine(s, ""))

    def test_programs_subagents_and_imported_copies_are_left_out(self):
        with tempfile.TemporaryDirectory(prefix=TMP) as t:
            exec_run = write_codex(t, "aaaaaaaa-0000-0000-0000-000000000001",
                                   codex_rows("aaaaaaaa-0000-0000-0000-000000000001", codex_user("x"), source="exec"))
            sub = write_codex(t, "aaaaaaaa-0000-0000-0000-000000000002",
                              codex_rows("aaaaaaaa-0000-0000-0000-000000000002", codex_user("x"), source={"subagent": {}}))
            self.assertFalse(sp.is_mine(sp.parse(str(exec_run)), ""))
            self.assertFalse(sp.is_mine(sp.parse(str(sub)), ""))
            copy = sp.parse(str(write_codex(t, CODEX_ID, codex_rows(CODEX_ID, codex_user("x")))), frozenset([CODEX_ID]))
            self.assertFalse(sp.is_mine(copy, ""))

    def test_both_tools_are_listed_together_newest_first_without_this_conversation(self):
        with tempfile.TemporaryDirectory(prefix=TMP) as claude, tempfile.TemporaryDirectory(prefix=TMP) as codex:
            old = write(claude, "p", "c1aude00", [row("user", "claude work")])
            os.utime(old, (1_700_000_000,) * 2)
            write_codex(codex, CODEX_ID, codex_rows(CODEX_ID, codex_user("codex work"), codex_ai("ok")))
            write(claude, "p", "now-session", [row("user", "this conversation")])
            found = sp.recent_sessions(claude, codex, 3650, 10, {"now-session"})
            self.assertEqual([s["tool"] for s in found], ["Codex", "Claude Code"])


class ListNumbersTest(unittest.TestCase):
    """Numbers belong to the list this conversation made; ids work from anywhere."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix=TMP)
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.claude, self.codex = str(root / "claude"), str(root / "codex")
        patcher = mock.patch.multiple(sp, STATE_DIR=str(root / "state"), LAST_LIST=str(root / "state" / "last.json"))
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        for k in ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"):
            os.environ.pop(k, None)
        a = write(self.claude, "p", "aaaa1111", [row("user", "first project")])
        b = write(self.claude, "p", "bbbb2222", [row("user", "second project")])
        os.utime(a, (1_700_000_000,) * 2)
        os.utime(b, (1_700_000_100,) * 2)

    def args(self, **kw):
        return argparse.Namespace(claude_dir=self.claude, codex_dir=self.codex, days=36500, limit=kw.get("limit", 5))

    def listed(self, conversation, limit=5):
        os.environ["CLAUDE_CODE_SESSION_ID"] = conversation
        with contextlib.redirect_stdout(io.StringIO()):
            sp.cmd_list(self.args(limit=limit))

    def resolve(self, conversation, *refs):
        os.environ["CLAUDE_CODE_SESSION_ID"] = conversation
        with contextlib.redirect_stderr(io.StringIO()) as err:
            hits = sp.resolve(list(refs), self.claude, self.codex)
        return [h["id"] for h in hits], err.getvalue()

    def test_a_list_made_in_another_conversation_does_not_change_the_numbers_here(self):
        self.listed("conversation-a")
        self.listed("conversation-b", limit=1)
        self.assertEqual(self.resolve("conversation-a", "1", "2")[0], ["bbbb2222", "aaaa1111"])
        self.assertEqual(self.resolve("conversation-b", "1")[0], ["bbbb2222"])

    def test_a_number_without_a_list_here_is_refused_not_guessed(self):
        self.listed("conversation-a")
        ids, err = self.resolve("conversation-c", "1")
        self.assertEqual(ids, [])
        self.assertIn("not in this conversation's last list", err)

    def test_an_id_works_without_any_list(self):
        self.assertEqual(self.resolve("anywhere", "aaaa11")[0], ["aaaa1111"])
        write_codex(self.codex, CODEX_ID, codex_rows(CODEX_ID, codex_user("x")))
        self.assertEqual(self.resolve("anywhere", CODEX_ID[:8])[0], [CODEX_ID])

    def test_an_ambiguous_or_short_id_is_refused(self):
        write(self.claude, "q", "aaaa1199", [row("user", "x")])
        ids, err = self.resolve("anywhere", "aaaa11")
        self.assertEqual(ids, [])
        self.assertIn("matches 2 sessions", err)
        self.assertIn("Not an id", self.resolve("anywhere", "a*")[1])

    def test_the_older_shared_list_is_ignored(self):
        os.makedirs(sp.STATE_DIR)
        Path(sp.LAST_LIST).write_text(json.dumps([{"n": 1, "id": "bbbb2222", "path": "x"}]), encoding="utf-8")
        self.assertEqual(self.resolve("conversation-a", "1")[0], [])


if __name__ == "__main__":
    unittest.main()
