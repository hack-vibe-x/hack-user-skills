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
            args = argparse.Namespace(claude_dir=t, days=3650, limit=5)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                sp.cmd_list(args)
                sp.cmd_show(argparse.Namespace(refs=["1"], budget=5000))
            self.assertIn("1. ", out.getvalue())
            self.assertIn("[me] start the work", out.getvalue())
            self.assertIn("[hus-session-coach]", out.getvalue())

    def test_data_folder_is_a_sub_folder_of_the_plugin_home_folder(self):
        self.assertEqual(sp.STATE_DIR, os.path.join(sp.DATA_ROOT, "session-playbook"))
        if not os.environ.get("HUS_SESSION_COACH_HOME"):
            self.assertEqual(sp.DATA_ROOT, os.path.expanduser("~/.hus-session-coach"))


if __name__ == "__main__":
    unittest.main()
