"""Tests for criteria_hook. Run: cd hooks && python3 -m unittest -v test_criteria_hook

Every test works in temporary folders. Korean prompts live in test_fixtures.ko.json.
"""
import datetime
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import criteria_hook as ch

TODAY = datetime.date(2026, 10, 20)
HERE = Path(__file__).resolve().parent
KO = json.loads((HERE / "test_fixtures.ko.json").read_text(encoding="utf-8"))
ASK = f"{ch.SKILL_GAP} skill"


def criterion(area, decision, body, status="confirmed", confirmed_at="2026-10-01", review_after=""):
    return (f"---\nid: x-1\narea: {area}\ndecision: {decision}\nstatus: {status}\nsource: user\n"
            f"confirmed_at: {confirmed_at}\nreview_after: {review_after}\nsupersedes:\nevidence:\n---\n\n{body}\n")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hus-criteria-gap-test-")
        self.home = Path(self.tmp.name) / "home"
        self.proj = Path(self.tmp.name) / "proj"
        self.data = Path(self.tmp.name) / "data"
        (self.home / ch.DATA_DIR).mkdir(parents=True)
        (self.proj / ch.DATA_DIR).mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def config(self, folder=None, **hook):
        folder = folder or self.proj / ch.DATA_DIR
        (folder / "config.json").write_text(json.dumps({"hook": hook}), encoding="utf-8")

    def add(self, name, text, folder=None):
        (folder or self.proj / ch.DATA_DIR).joinpath(name).write_text(text, encoding="utf-8")

    def run_hook(self, prompt, session="s1", transcript=None):
        event = {"prompt": prompt, "cwd": str(self.proj), "session_id": session}
        if transcript:
            event["transcript_path"] = str(transcript)
        return ch.build_context(event, home=self.home, data_dir=self.data, today=TODAY)


class HookTest(Base):
    # --- names ---
    def test_folder_and_tag_use_the_short_name(self):
        self.assertEqual(ch.DATA_DIR, ".hus-criteria-gap")
        self.config(enabled=True, intensity="active")
        self.assertTrue(self.run_hook("Please filter the magazine sources").startswith("[hus-criteria-gap] "))

    def test_old_criteria_folder_is_not_read(self):
        old = self.proj / ".criteria"
        old.mkdir()
        self.config(folder=old, enabled=True, intensity="active")
        self.assertIsNone(self.run_hook("Please filter the magazine sources"))

    # --- switch ---
    def test_off_by_default(self):
        self.assertIsNone(self.run_hook("Please filter the magazine sources"))

    def test_off_when_explicitly_disabled(self):
        self.config(enabled=False)
        self.assertIsNone(self.run_hook("Please filter the magazine sources"))

    def test_broken_config_means_off(self):
        (self.proj / ch.DATA_DIR / "config.json").write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.run_hook("Please filter the magazine sources"))

    def test_global_config_applies_when_project_has_none(self):
        self.config(folder=self.home / ch.DATA_DIR, enabled=True, intensity="active")
        self.assertIsNotNone(self.run_hook("Please filter the sources"))

    def test_project_config_overrides_global(self):
        self.config(folder=self.home / ch.DATA_DIR, enabled=True, intensity="active")
        self.config(enabled=False)
        self.assertIsNone(self.run_hook("Please filter the sources"))

    # --- step 1: rule filter ---
    def test_ignores_non_delegation(self):
        self.config(enabled=True, intensity="active")
        self.assertIsNone(self.run_hook("Thanks, that looks good to me now"))
        self.assertIsNone(self.run_hook("What does this function return exactly?"))

    def test_ignores_slash_and_short(self):
        self.config(enabled=True, intensity="active")
        self.assertIsNone(self.run_hook("/criteria please filter the sources"))
        self.assertIsNone(self.run_hook("filter it"))

    def test_light_needs_a_signal_active_does_not(self):
        self.config(enabled=True, intensity="light")
        self.run_hook("Please filter the sources", session="a")                              # first delegation: a signal
        self.assertIsNone(self.run_hook("Please summarize the sources", session="a"))         # no signal
        self.assertIsNotNone(self.run_hook("Please plan the whole magazine", session="a"))    # long output

    def test_count_is_a_long_output_signal(self):
        self.assertIn("long output", ch.signals("Please write 10 slides for the deck", first=False))
        self.assertNotIn("long output", ch.signals("Please write it for 10 people", first=False))

    def test_direction_change_is_a_signal(self):
        self.config(enabled=True, intensity="light")
        self.run_hook("Please filter the sources", session="b")
        out = self.run_hook("Please plan it again, but pivot to parents instead", session="b")
        self.assertIn("a decision that changes direction", out)

    def test_does_not_interrupt_a_criteria_dialogue(self):
        self.config(enabled=True, intensity="active")
        t = Path(self.tmp.name) / "t.jsonl"
        t.write_text(json.dumps({"type": "assistant", "message": {"content": [
            {"type": "text", "text": "What are your criteria for picking sources?"}]}}) + "\n", encoding="utf-8")
        self.assertIsNone(self.run_hook("Primary sources only, no ads. Please plan it", transcript=t))
        t.write_text(json.dumps({"type": "assistant", "message": {"content": "What next?"}}) + "\n",
                     encoding="utf-8")
        self.assertIsNotNone(self.run_hook("Primary sources only, no ads. Please plan it", transcript=t))

    def test_unreadable_transcript_does_not_block(self):
        self.config(enabled=True, intensity="active")
        out = self.run_hook("Please filter the sources", transcript=Path(self.tmp.name) / "none")
        self.assertIsNotNone(out)

    # --- step 2: records ---
    def test_no_criteria_nudges_to_ask(self):
        self.config(enabled=True, intensity="active")
        out = self.run_hook("Please filter the magazine sources")
        self.assertIn("There are no confirmed criteria", out)
        self.assertIn(ASK, out)
        self.assertIn("go ahead for now", out)
        self.assertIn(ch.ASK_RULE, out)

    def test_matching_confirmed_criterion_is_injected_without_strong_nudge(self):
        self.config(enabled=True, intensity="active")
        self.add("a.md", criterion("magazine", "source-filter", "Primary sources from 2025 on only"))
        out = self.run_hook("Please filter the magazine sources")
        self.assertIn("Primary sources from 2025 on only", out)
        self.assertIn("Applied criteria", out)
        self.assertNotIn("There are no confirmed criteria", out)
        self.assertNotIn(ASK, out)
        # A criterion that covers part of the request: the open part is still asked the user's way, and a criterion
        # from another area is not taken as confirmed for this one.
        self.assertIn(ch.ASK_RULE, out)
        self.assertIn("holds only for its own area", out)

    def test_unrelated_criterion_is_listed_but_still_nudges(self):
        self.config(enabled=True, intensity="active")
        self.add("a.md", criterion("report", "tone", "Short and dry"))
        out = self.run_hook("Please filter the magazine sources")
        self.assertIn("Other confirmed criteria", out)
        self.assertIn(ASK, out)

    def test_draft_and_stale_are_not_treated_as_confirmed(self):
        self.config(enabled=True, intensity="active")
        self.add("d.md", criterion("magazine", "readers", "Parents in their 30s", status="draft"))
        self.add("s.md", criterion("magazine", "tone", "Warm", review_after="2026-01-01"))
        out = self.run_hook("Please filter the magazine sources")
        self.assertIn("need rechecking", out)
        self.assertIn("· draft", out)
        self.assertIn("· past its review date", out)
        self.assertIn("There are no confirmed criteria", out)

    def test_superseded_and_retired_are_ignored(self):
        self.config(enabled=True, intensity="active")
        self.add("x.md", criterion("magazine", "source-filter", "Old rule", status="superseded"))
        self.add("y.md", criterion("magazine", "tone", "Retired rule", status="retired"))
        out = self.run_hook("Please filter the magazine sources")
        self.assertNotIn("Old rule", out)
        self.assertNotIn("Retired rule", out)

    def test_project_wins_over_global_for_same_key(self):
        self.config(enabled=True, intensity="active")
        self.add("g.md", criterion("magazine", "source-filter", "Global rule"), folder=self.home / ch.DATA_DIR)
        self.add("p.md", criterion("magazine", "source-filter", "Project rule"))
        out = self.run_hook("Please filter the magazine sources")
        self.assertIn("Project rule", out)
        self.assertNotIn("Global rule", out)

    def test_criterion_text_is_one_line_and_truncated(self):
        self.config(enabled=True, intensity="active")
        self.add("a.md", criterion("magazine", "source-filter", "First line\nsecond line " + "x" * 500))
        out = self.run_hook("Please filter the magazine sources")
        line = [l for l in out.splitlines() if "source-filter" in l][0]
        self.assertNotIn("second line\n", out)
        self.assertLess(len(line), 260)

    # --- safeguards ---
    def test_max_per_session_and_cooldown(self):
        self.config(enabled=True, intensity="active", max_per_session=2, cooldown_turns=1)
        strong = lambda o: bool(o) and ASK in o
        self.assertTrue(strong(self.run_hook("Please filter the magazine sources", session="c")))     # turn 1 fires
        self.assertFalse(strong(self.run_hook("Please organize the magazine sources", session="c")))  # turn 2 cooldown
        self.assertTrue(strong(self.run_hook("Please compare the magazine sources", session="c")))    # turn 3 fires
        self.assertFalse(strong(self.run_hook("Please analyze the magazine sources", session="c")))   # turn 4 cooldown
        self.assertFalse(strong(self.run_hook("Please evaluate the magazine sources", session="c")))  # turn 5 over limit
        self.assertFalse(strong(self.run_hook("Please summarize the magazine sources", session="c")))

    def test_session_counters_for_the_status_script(self):
        self.config(enabled=True, intensity="active", max_per_session=1, cooldown_turns=0)
        self.run_hook("Please filter the magazine sources", session="n")   # added, and said criteria are missing
        self.run_hook("What do you think?", session="n")                   # seen, not a delegation
        self.run_hook("Please organize the magazine sources", session="n")  # added, past the cap
        state = json.loads((self.data / "sessions" / "n.json").read_text(encoding="utf-8"))
        self.assertEqual(state, {"turn": 3, "delegations": 2, "injected": 2, "fires": 1, "last_fire": 1})

    def test_sessions_are_independent(self):
        self.config(enabled=True, intensity="active", max_per_session=1, cooldown_turns=0)
        self.assertIn(ASK, self.run_hook("Please filter the sources", session="s1"))
        self.assertIn(ASK, self.run_hook("Please filter the sources", session="s2"))

    def test_weird_session_id_is_safe(self):
        self.config(enabled=True, intensity="active")
        self.run_hook("Please filter the sources", session=os.path.join(os.pardir, os.pardir, "etc", "x"))
        self.assertTrue(any((self.data / "sessions").glob("*.json")))
        self.assertFalse((Path(self.tmp.name) / "etc").exists())


class FixesTest(Base):
    """Cases that used to misfire."""

    def test_card_answer_is_not_a_delegation(self):
        self.config(enabled=True, intensity="active")
        answer = ("[hus-criteria-gap answer]\nKind: missing criterion\nQuestion: How should the plan rank sources?\n"
                  "My answer: primary sources first. Please plan it that way")
        self.assertIsNone(self.run_hook(answer))

    def test_english_words_must_start_a_word(self):
        for prompt in ("I need an explanation of this error message today",
                       "Show me a preview of the page layout right now",
                       "Frankly this looks fine to me, thanks for the work"):
            self.assertFalse(ch.is_delegation(prompt), prompt)
        self.assertTrue(ch.is_delegation("Please plan the planning session"))

    def test_a_question_without_a_request_is_not_a_delegation(self):
        self.assertFalse(ch.is_delegation("What do you think about the plan for the next quarter?"))
        self.assertTrue(ch.is_delegation("Can you plan the next quarter?"))

    def test_more_delegation_verbs(self):
        for prompt in ("Please pick three sources", "Please prioritize these tasks", "Please brainstorm names"):
            self.assertTrue(ch.is_delegation(prompt), prompt)

    def test_criteria_question_forms_are_protected(self):
        for text in ("For this magazine, from what level does a statement count as 'fact'? You can say 'I don't know'.",
                     "**What are your criteria for sources?**\n\n(Say 'not sure' if you need candidates.)",
                     "Let me know the criteria you use for picking sources."):
            self.assertTrue(ch.is_asking_criteria(text), text)
        self.assertFalse(ch.is_asking_criteria("What next?"))
        self.assertFalse(ch.is_asking_criteria("Here are the criteria I used.\n\nAnything else?"))

    def test_bom_and_crlf_files_are_read(self):
        self.config(enabled=True, intensity="active")
        self.add("a.md", "﻿" + criterion("magazine", "sources", "Primary only").replace("\n", "\r\n"))
        self.assertIn("Primary only", self.run_hook("Please filter the magazine sources"))

    def test_ai_inferred_is_not_confirmed(self):
        self.config(enabled=True, intensity="active")
        self.add("a.md", criterion("magazine", "sources", "Guessed rule").replace("source: user", "source: ai-inferred"))
        out = self.run_hook("Please filter the magazine sources")
        self.assertIn("inferred by the AI", out)
        self.assertIn(ASK, out)

    def test_slug_decision_and_keywords_match(self):
        self.assertTrue(ch.matches({"area": "zine", "decision": "source-filter"}, "Please do the source filter"))
        self.assertTrue(ch.matches({"area": "zine", "decision": "x", "keywords": ["newsletter"]}, "Write the newsletter"))
        self.assertFalse(ch.matches({"area": "z", "decision": "q"}, "a z q prompt"))

    def test_keywords_come_from_the_file(self):
        self.config(enabled=True, intensity="active")
        self.add("a.md", criterion("zine", "picks", "Primary only").replace("status:", "keywords: newsletter, digest\nstatus:"))
        out = self.run_hook("Please write the weekly digest")
        self.assertIn("Confirmed criteria that look related", out)

    def test_global_folder_is_not_taken_for_a_project(self):
        # Working in a folder under HOME with no project folder: ~/.hus-criteria-gap is global, not project.
        self.config(folder=self.home / ch.DATA_DIR, enabled=True, intensity="active")
        self.add("a.md", criterion("magazine", "sources", "Primary only"), folder=self.home / ch.DATA_DIR)
        work = self.home / "work"
        work.mkdir()
        event = {"prompt": "Please filter the magazine sources", "cwd": str(work), "session_id": "g"}
        out = ch.build_context(event, home=self.home, data_dir=self.data, today=TODAY)
        self.assertIn("(global)", out)
        self.assertNotIn("(project)", out)


class PatternTest(unittest.TestCase):
    """The prompt words come from patterns.json and patterns.<lang>.json."""

    def test_broken_or_missing_pattern_files_detect_nothing(self):
        with tempfile.TemporaryDirectory(prefix="hus-criteria-gap-test-") as tmp:
            (Path(tmp) / "patterns.json").write_text("{broken", encoding="utf-8")
            pat = ch.load_patterns(Path(tmp))
            self.assertFalse(ch.is_delegation("Please filter the sources", pat))
            self.assertEqual(ch.signals("Please plan the whole report", first=False, pat=pat), [])

    def test_language_files_are_merged(self):
        with tempfile.TemporaryDirectory(prefix="hus-criteria-gap-test-") as tmp:
            (Path(tmp) / "patterns.json").write_text(json.dumps({"delegation": ["filter"], "request_form": ["please"]}),
                                                     encoding="utf-8")
            (Path(tmp) / "patterns.xx.json").write_text(json.dumps({"delegation": ["zorb"]}), encoding="utf-8")
            (Path(tmp) / "patterns.bad-name.json").write_text(json.dumps({"delegation": ["blip"]}), encoding="utf-8")
            pat = ch.load_patterns(Path(tmp))
            self.assertTrue(ch.is_delegation("please zorb these", pat))
            self.assertFalse(ch.is_delegation("please blip these", pat))


class KoreanPromptTest(unittest.TestCase):
    """Korean prompts from test_fixtures.ko.json, matched by patterns.ko.json."""

    def test_delegation(self):
        for prompt in KO["delegation"]:
            self.assertTrue(ch.is_delegation(prompt), prompt)
        for prompt in KO["not_delegation"]:
            self.assertFalse(ch.is_delegation(prompt), prompt)

    def test_signals(self):
        self.assertEqual(ch.signals(KO["no_signal"], first=False), [])
        self.assertIn("a decision that changes direction", ch.signals(KO["direction"], first=False))
        for prompt in KO["long_output"]:
            self.assertIn("long output", ch.signals(prompt, first=False), prompt)

    def test_asking_criteria(self):
        self.assertTrue(ch.is_asking_criteria(KO["asking_criteria"]))
        for text in KO["asking_criteria_more"]:
            self.assertTrue(ch.is_asking_criteria(text), text)
        self.assertFalse(ch.is_asking_criteria(KO["not_asking_criteria"]))

    def test_count_units_need_an_ending_or_particle(self):
        for prompt in KO["not_long_output"]:
            self.assertNotIn("long output", ch.signals(prompt, first=False), prompt)

    def test_one_syllable_area_matches(self):
        c = KO["one_syllable_area"]
        self.assertTrue(ch.matches({"area": c["area"], "decision": c["decision"]}, c["prompt"]))

    def test_korean_criterion_is_matched_and_kept_as_written(self):
        with tempfile.TemporaryDirectory(prefix="hus-criteria-gap-test-") as tmp:
            proj = Path(tmp) / "proj" / ch.DATA_DIR
            proj.mkdir(parents=True)
            (proj / "config.json").write_text(json.dumps({"hook": {"enabled": True, "intensity": "active"}}),
                                              encoding="utf-8")
            c = KO["criterion"]
            (proj / "a.md").write_text(criterion(c["area"], c["decision"], c["body"]), encoding="utf-8")
            event = {"prompt": KO["matching_prompt"], "cwd": str(proj.parent), "session_id": "ko"}
            out = ch.build_context(event, home=Path(tmp) / "home", data_dir=Path(tmp) / "data", today=TODAY)
            self.assertIn(c["body"], out)
            self.assertIn("Confirmed criteria that look related", out)


class ProcessTest(unittest.TestCase):
    """End to end through the real sh wrapper, with HOME and the data folder in a temporary folder."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hus-criteria-gap-test-")
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_sh(self, stdin):
        env = {**os.environ, "HOME": str(self.root / "home"), "CLAUDE_PLUGIN_DATA": str(self.root / "data")}
        return subprocess.run(["sh", str(HERE / "criteria-hook.sh")], input=stdin, text=True, cwd=self.root,
                              capture_output=True, env=env, timeout=20)

    def test_garbage_stdin_exits_zero_silently(self):
        for stdin in ("", "not json", "[]", "null", '{"prompt": 5}'):
            r = self.run_sh(stdin)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, ""), stdin)

    def test_end_to_end_output_is_valid_hook_json(self):
        proj = self.root / "proj"
        (proj / ch.DATA_DIR).mkdir(parents=True)
        (proj / ch.DATA_DIR / "config.json").write_text(
            json.dumps({"hook": {"enabled": True, "intensity": "active"}}), encoding="utf-8")
        event = {"prompt": "Please filter the magazine sources", "cwd": str(proj), "session_id": "e2e"}
        r = self.run_sh(json.dumps(event))
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "UserPromptSubmit")
        self.assertIn(ch.SKILL_GAP, out["additionalContext"])
        self.assertTrue((self.root / "data" / "sessions" / "e2e.json").is_file())

    def test_hooks_json_is_wellformed(self):
        data = json.loads((HERE / "hooks.json").read_text(encoding="utf-8"))
        hook = data["hooks"]["UserPromptSubmit"][0]["hooks"][0]
        self.assertEqual(hook["type"], "command")
        self.assertTrue(hook["args"][0].endswith("hooks/criteria-hook.sh"))
        self.assertLessEqual(hook["timeout"], 30)


if __name__ == "__main__":
    unittest.main()
