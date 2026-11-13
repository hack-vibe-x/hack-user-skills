"""hooks/env-check.sh with a fake PATH. Nothing is installed.
Run: (cd hooks && python3 -m unittest -v test_env_check)"""
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = os.path.join(HERE, "env-check.sh")
PREFIX = "HUS_" + "SESSION_COACH_"


class EnvCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hus-session-coach-envcheck-")
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name

    def tools(self, **extra):
        """A PATH holding only the tools the script needs, so the python3 and brew of this computer are not found."""
        path = tempfile.mkdtemp(prefix="hus-session-coach-tools-", dir=self.root)
        for name in ("sh", "uname", "touch", "mkdir", "xcode-select"):
            found = shutil.which(name)
            if found:
                os.symlink(found, os.path.join(path, name))
        for name, body in extra.items():
            self.script(os.path.join(path, name), body)
        return path

    def script(self, path, body="exit 0"):
        with open(path, "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\n%s\n" % body)
        os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)

    def check(self, path, home=None, brew_paths="/nonexistent/brew"):
        home = home or tempfile.mkdtemp(prefix="hus-session-coach-home-", dir=self.root)
        env = {"PATH": path, "HOME": home, PREFIX + "BREW_PATHS": brew_paths, PREFIX + "PYTHON_PATHS": "/nonexistent/python3"}
        done = subprocess.run(["sh", CHECK], env=env, capture_output=True, text=True)
        return done, home

    def context(self, done):
        return json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]

    def test_silent_when_python_is_there(self):
        done, _ = self.check(self.tools(python3="exit 0"))
        self.assertEqual((done.returncode, done.stdout, done.stderr), (0, "", ""))

    def test_a_python_that_is_too_old_counts_as_missing(self):
        done, _ = self.check(self.tools(python3="exit 1"))
        self.assertIn("needs Python 3.9 or later", self.context(done))

    def test_with_homebrew_four_options_one_command_and_the_reassurances(self):
        brew = os.path.join(self.root, "brew")
        self.script(brew)
        done, _ = self.check(self.tools(), brew_paths=brew)
        out = json.loads(done.stdout)["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "SessionStart")
        c = out["additionalContext"]
        self.assertIn("AskUserQuestion", c)
        self.assertIn("exactly `%s install python`" % brew, c)
        for label in ("Install it for me", "Send me the command", "Not now", "Do not ask again"):
            self.assertIn(label, c)
        for phrase in ("nothing is installed until they choose", "no administrator password", "brew uninstall python", "Never use sudo"):
            self.assertIn(phrase, c)
        self.assertNotIn("\n", c)
        self.assertNotIn("node", c.lower())

    def test_without_homebrew_claude_installs_nothing_and_points_to_the_download_page(self):
        c = self.context(self.check(self.tools())[0])
        self.assertNotIn("Install it for me", c)
        self.assertIn("do not install anything yourself", c)
        self.assertIn("https://www.python.org/downloads/", c)

    def test_the_do_not_ask_again_command_really_silences_the_hook(self):
        path = self.tools()
        done, home = self.check(path)
        command = re.search(r"you run `(mkdir -p [^`]+)`", self.context(done)).group(1)
        self.assertEqual(subprocess.run(["sh", "-c", command], env={"PATH": path, "HOME": home}).returncode, 0)
        self.assertTrue(os.path.exists(os.path.join(home, ".hus-session-coach", "no-env-check")))
        done, _ = self.check(path, home=home)
        self.assertEqual((done.returncode, done.stdout), (0, ""))

    def test_a_python_kept_by_a_version_manager_is_found_even_when_path_does_not_list_it(self):
        home = tempfile.mkdtemp(prefix="hus-session-coach-home-", dir=self.root)
        folder = os.path.join(home, ".pyenv", "versions", "3.12.1", "bin")
        os.makedirs(folder)
        self.script(os.path.join(folder, "python3"))
        done, _ = self.check(self.tools(), home=home)
        self.assertEqual((done.returncode, done.stdout), (0, ""))

    def test_a_python_that_is_too_old_is_named_in_the_question_and_claude_is_told_what_to_do_if_it_still_comes_first(self):
        brew = os.path.join(self.root, "brew")
        self.script(brew)
        old = self.tools(python3='if [ "$1" = --version ]; then echo Python 3.8.2; else exit 1; fi')
        c = self.context(self.check(old, brew_paths=brew)[0])
        self.assertRegex(c, r"Python 3\.8\.2 is on this computer .*older than 3\.9")
        self.assertIn("older Python still comes first in their PATH", c)
        self.assertIn("do not edit any shell file", c)

    def test_hooks_json_runs_the_check_at_session_start(self):
        with open(os.path.join(HERE, "hooks.json"), encoding="utf-8") as f:
            data = json.load(f)
        hook = data["hooks"]["SessionStart"][0]["hooks"][0]
        self.assertEqual((hook["command"], hook["args"]), ("sh", ["${CLAUDE_PLUGIN_ROOT}/hooks/env-check.sh"]))
        self.assertEqual(data["modules"], ["./session-coach.tsx"])


if __name__ == "__main__":
    unittest.main()
