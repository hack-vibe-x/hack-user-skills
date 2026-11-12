#!/usr/bin/env python3
"""Criteria check before delegation (UserPromptSubmit hook). Standard library only.

Only when it is turned on and the prompt looks like a delegation does it look up the criteria
records and add context. When it is off, or there is nothing to say, it prints nothing.
No error may block the user's input.
Settings and lookup rules: skills/criteria/references/format.md, skills/criteria-init/SKILL.md.
Words it looks for in prompts live in patterns.json (English) and patterns.<lang>.json.
"""
import datetime
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

NAME = "hus-criteria-gap"
DATA_DIR = "." + NAME            # project and home criteria folder: .hus-criteria-gap/, ~/.hus-criteria-gap/
TEMP_DIR = NAME + "-hook"        # session counters when CLAUDE_PLUGIN_DATA is not set: $TMPDIR/hus-criteria-gap-hook/
TAG = f"[{NAME}]"
SKILL_GAP = "hack-user-skills-criteria-gap:criteria-gap"

DEFAULTS = {"enabled": False, "intensity": "light", "max_per_session": 3, "cooldown_turns": 3}
REVIEW_DAYS = 90
MAX_LISTED = 8
# How the one question is asked. Without it Claude tended to list its own candidates and a recommendation first,
# or ask two things at once, when confirmed criteria covered part of the request.
ASK_RULE = ("How to ask: one question in the message and nothing else (whether to save or confirm a criterion is "
            "asked later, on its own). Let the user state the criterion in their own words first: do not show "
            "candidates, a recommendation, or the criterion you would use until they say they don't know. "
            "After 'I don't know', show 2-3 candidates with a short example each and let them pick or rewrite one; "
            "do not pick one yourself and do the work, unless they say 'go ahead for now'.")
MAX_TEXT = 160
STATE_KEEP_DAYS = 7
HERE = Path(__file__).resolve().parent
PATTERN_KEYS = ("delegation", "request_form", "direction", "long_output", "count_units", "criteria_words",
                "ask_endings", "unit_particles", "verb_fillers", "verb_endings")


# ---------- prompt patterns (patterns*.json) ----------

def load_patterns(folder=HERE):
    """Merge patterns.json with every patterns.<lang>.json. Missing or broken files add nothing."""
    merged = {k: [] for k in PATTERN_KEYS}
    files = [folder / "patterns.json"] + sorted(
        p for p in folder.glob("patterns.*.json") if re.fullmatch(r"patterns\.[a-z]{2,3}\.json", p.name))
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        for key in PATTERN_KEYS:
            values = data.get(key)
            if isinstance(values, list):
                merged[key] += [v.lower() for v in values if isinstance(v, str) and v]
    units = sorted(merged["count_units"], key=len, reverse=True)
    # After a count unit, only the end of a word or a listed particle may follow,
    # so a unit that is the first letter of a longer word (a month, an improvement) does not count.
    particles = "|".join(map(re.escape, merged["unit_particles"]))
    tail = r"(?=$|[\W\d_]" + (f"|(?:{particles})" if particles else "") + ")"
    merged["count_re"] = re.compile(r"\d+\s*(?:" + "|".join(map(re.escape, units)) + r")" + tail) if units else None
    for key in PATTERN_KEYS:
        merged[key + "_re"] = word_re(merged[key], merged)
    return merged


def word_re(words, pat):
    """One regex for a word list. A word in Latin letters must start a word ("plan" matches "planning",
    not "explanation"). A word ending in "~" is a noun that becomes a verb only with an ending from
    verb_endings (optionally after a word from verb_fillers): it matches the verb, not the bare noun."""
    fillers = "|".join(map(re.escape, pat.get("verb_fillers", [])))
    endings = "|".join(map(re.escape, pat.get("verb_endings", [])))
    verb = (r"\s?" + (rf"(?:(?:{fillers})\s?)?" if fillers else "") + rf"(?:{endings})") if endings else None
    parts = []
    for w in words:
        if w.endswith("~"):
            if verb:
                parts.append(re.escape(w[:-1]) + verb)
        elif re.match(r"[a-z]", w):
            parts.append(r"(?<![a-z])" + re.escape(w))
        else:
            parts.append(re.escape(w))
    return re.compile("|".join(parts)) if parts else None


PATTERNS = load_patterns()


# ---------- file format (references/format.md) ----------

def parse_file(text):
    text = text.lstrip("﻿").replace("\r\n", "\n")
    meta, body = {}, text
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            for line in text[4:end].splitlines():
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                value = value.strip()
                if value.startswith('"'):
                    try:
                        value = json.loads(value)
                    except ValueError:
                        pass
                else:
                    value = re.split(r"\s+#", value)[0].strip()
                meta[key.strip()] = value
            body = text[end + 4:].lstrip("\n")
    return meta, body.strip()


def parse_date(value):
    try:
        return datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def is_stale(meta, today):
    due = parse_date(meta.get("review_after"))
    if due is None:
        confirmed = parse_date(meta.get("confirmed_at"))
        if confirmed is None:
            return True
        due = confirmed + datetime.timedelta(days=REVIEW_DAYS)
    return due < today


def one_line(text, limit=MAX_TEXT):
    text = " ".join(re.sub(r"[\x00-\x1f]", " ", str(text)).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


# ---------- settings and records ----------

def find_project_dir(cwd, home):
    start = Path(cwd).resolve()
    for d in [start, *start.parents]:
        candidate = d / DATA_DIR
        if candidate.is_dir():
            return candidate
        if d == home:
            break
    return None


def load_config(project_dir, global_dir):
    for folder in (project_dir, global_dir):
        if folder is None:
            continue
        path = folder / "config.json"
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8")).get("hook", {})
            except (ValueError, OSError, AttributeError):
                return dict(DEFAULTS)  # a broken config counts as off
            cfg = dict(DEFAULTS)
            if isinstance(raw, dict):
                cfg.update({k: raw[k] for k in DEFAULTS if k in raw})
            return cfg
    return dict(DEFAULTS)


def load_criteria(folders, today):
    """Return (confirmed, needs recheck). When the same area and decision is in both, the project wins."""
    seen, confirmed, recheck = set(), [], []
    for folder in folders:
        if folder is None or not folder.is_dir():
            continue
        for f in sorted(folder.glob("*.md")):
            if f.name == "INDEX.md":
                continue
            try:
                meta, body = parse_file(f.read_text(encoding="utf-8"))
            except OSError:
                continue
            status = meta.get("status")
            if status not in ("confirmed", "draft"):
                continue
            key = (meta.get("area", ""), meta.get("decision", ""))
            if key in seen:
                continue
            seen.add(key)
            item = {"area": one_line(key[0], 40), "decision": one_line(key[1], 40),
                    "keywords": [k.strip() for k in str(meta.get("keywords", "")).split(",") if k.strip()],
                    "body": one_line(body), "scope": "project" if folder == folders[0] else "global"}
            inferred = meta.get("source") == "ai-inferred"
            if status == "confirmed" and not inferred and not is_stale(meta, today):
                confirmed.append(item)
            else:
                item["why"] = ("draft" if status == "draft" else
                               "inferred by the AI, not confirmed by the user" if inferred else "past its review date")
                recheck.append(item)
    return confirmed, recheck


# ---------- session state ----------

# One file per session: turn (requests seen), delegations (detected), injected (times context was
# added), fires (times it said the needed criteria are missing; capped by max_per_session), last_fire.
# skills/criteria-init/scripts/criteria_status.py reads these.
def state_file(session_id, data_dir):
    sid = re.sub(r"[^A-Za-z0-9_-]", "-", session_id or "unknown")[:80]
    return Path(data_dir) / "sessions" / f"{sid}.json"


def load_state(path):
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(state, dict):
            return {"turn": int(state.get("turn", 0)), "delegations": int(state.get("delegations", 0)),
                    "injected": int(state.get("injected", 0)), "fires": int(state.get("fires", 0)),
                    "last_fire": int(state.get("last_fire", -999))}
    except (ValueError, OSError, TypeError):
        pass
    return {"turn": 0, "delegations": 0, "injected": 0, "fires": 0, "last_fire": -999}


def save_state(path, state):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, path)
        cutoff = time.time() - STATE_KEEP_DAYS * 86400
        for old in path.parent.glob("*.json"):
            if old.stat().st_mtime < cutoff:
                old.unlink()
    except OSError:
        pass


# ---------- judgement ----------

def last_assistant_text(transcript_path):
    """The previous assistant message. Empty string when it cannot be read."""
    try:
        with open(transcript_path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 200_000))
            lines = fh.read().decode("utf-8", "ignore").splitlines()
    except (OSError, TypeError):
        return ""
    for line in reversed(lines):
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if not isinstance(obj, dict) or obj.get("type") != "assistant":
            continue
        content = (obj.get("message") or {}).get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = " ".join(p.get("text", "") for p in content
                            if isinstance(p, dict) and p.get("type") == "text")
        else:
            continue
        if text.strip():
            return text
    return ""


def has_any(text, pat, key):
    rx = pat.get(key + "_re")
    return bool(rx.search(text)) if rx else False


def is_delegation(prompt, pat=PATTERNS):
    p = prompt.lower()
    if not has_any(p, pat, "delegation"):
        return False
    asks_politely = has_any(p, pat, "request_form")
    # "What do you think of the plan?" is a question, not work handed over.
    if p.rstrip().endswith(("?", "？")) and not asks_politely:
        return False
    return asks_politely or len(prompt) >= 30


def last_paragraph(text):
    """The final paragraph without Markdown emphasis or a trailing parenthetical, where a question to the user sits."""
    for para in reversed(re.split(r"\n\s*\n", text.strip())):
        tail = re.sub(r"[*_`>]+", "", para).strip()
        tail = re.sub(r"\s*[(（][^()（）]*[)）]$", "", tail).strip()
        if tail:  # a paragraph that was only an aside is skipped
            return tail
    return ""


def is_asking_criteria(text, pat=PATTERNS):
    """True when the previous assistant message ends by asking the user about criteria,
    so the user's next prompt is an answer, not a new delegation."""
    tail = last_paragraph(text).lower()
    if not tail:
        return False
    asks = "?" in tail or "？" in tail or has_any(tail, pat, "ask_endings")
    return asks and has_any(tail, pat, "criteria_words")


def signals(prompt, first, pat=PATTERNS):
    p = prompt.lower()
    found = []
    if first:
        found.append("first delegation in this session")
    if has_any(p, pat, "direction"):
        found.append("a decision that changes direction")
    if has_any(p, pat, "long_output") or (pat["count_re"] and pat["count_re"].search(p)):
        found.append("long output")
    return found


def norm(s):
    return " ".join(re.sub(r"[-_/]+", " ", str(s).lower()).split())


def matches(item, prompt):
    """A criterion matches when its area, decision, or one of its keywords is in the prompt.
    Hyphens and underscores count as spaces, so the decision "source-filter" matches "source filter".
    A word in Latin letters needs two characters or more; one syllable of another script is enough."""
    p = norm(prompt)
    for v in (item["area"], item["decision"], *item.get("keywords", [])):
        v = norm(v)
        if v and (len(v) >= 2 or not v.isascii()) and v in p:
            return True
    return False


def fmt(item):
    return f"[{item['area']}/{item['decision']}] {item['body']} ({item['scope']})"


def build_context(event, home=None, data_dir=None, today=None):
    """Return the text to inject, or None to stay out."""
    home = Path(home or os.path.expanduser("~")).resolve()
    today = today or datetime.date.today()
    data_dir = data_dir or os.environ.get("CLAUDE_PLUGIN_DATA") or str(Path(tempfile.gettempdir()) / TEMP_DIR)
    prompt = str(event.get("prompt") or event.get("user_prompt") or "").strip()

    global_dir = home / DATA_DIR
    project_dir = find_project_dir(event.get("cwd") or os.getcwd(), home)
    if project_dir is not None and project_dir.resolve() == global_dir.resolve():
        project_dir = None  # walking up from a folder under HOME reached the global folder; it is not a project
    cfg = load_config(project_dir, global_dir if global_dir.is_dir() else None)
    if cfg["enabled"] is not True:
        return None
    # Slash commands and this plugin's own messages (card answers start with "[hus-criteria-gap") are not delegations.
    if len(prompt) < 10 or prompt.startswith(("/", TAG[:-1])):
        return None

    spath = state_file(event.get("session_id"), data_dir)
    state = load_state(spath)
    state["turn"] += 1
    try:
        # Do not cut in when the user is answering a question about criteria.
        if is_asking_criteria(last_assistant_text(event.get("transcript_path"))) or not is_delegation(prompt):
            return None

        first = state["delegations"] == 0
        state["delegations"] += 1
        found = signals(prompt, first)
        if cfg["intensity"] != "active" and not found:
            return None

        folders = [project_dir, global_dir if global_dir != project_dir else None]
        confirmed, recheck = load_criteria(folders, today)
        hit = [c for c in confirmed if matches(c, prompt)]
        rest = [c for c in confirmed if c not in hit]

        strong = False
        if not hit:
            room = state["fires"] < int(cfg["max_per_session"])
            cooled = state["turn"] - state["last_fire"] > int(cfg["cooldown_turns"])
            strong = room and cooled
            if strong:
                state["fires"] += 1
                state["last_fire"] = state["turn"]

        lines = [f"{TAG} The criteria check before delegation is on here. "
                 f"This prompt was detected as a delegation (signals: {', '.join(found) or 'a delegation verb'})."]
        if hit:
            lines.append("Confirmed criteria that look related to this prompt:")
            lines += [f"  - {fmt(c)}" for c in hit[:MAX_LISTED]]
        if rest and len(hit) < MAX_LISTED:
            lines.append("Other confirmed criteria:")
            lines += [f"  - {fmt(c)}" for c in rest[:MAX_LISTED - len(hit)]]
        if not confirmed:
            lines.append("There are no confirmed criteria in the records.")
        if recheck:
            lines.append("Criteria that need rechecking (draft or past their review date; not confirmed):")
            lines += [f"  - {fmt(c)} · {c['why']}" for c in recheck[:3]]
        lines.append("This project's rule: when a confirmed criterion is applied, the first line of the answer "
                     "says so as 'Applied criteria: ...'.")
        if strong:
            lines.append(f"The judgement criteria this prompt needs are not listed above. This project's rule is to "
                         f"follow the {SKILL_GAP} skill and ask the user only the one criterion that blocks the work, "
                         f"before starting. If the user chooses 'go ahead for now', the work goes on with a temporary "
                         f"criterion that is named as temporary and not saved.")
            lines.append(ASK_RULE)
        elif hit:
            lines.append("This project's rule: each criterion above holds only for its own area (the part before '/'). "
                         "One whose area differs from what this prompt is for is not confirmed for it: ask whether it "
                         "applies before using it.")
            lines.append("This project's rule: if the criteria above do not cover every judgement in this prompt, "
                         "the missing one is checked with the user before the work.")
            lines.append(ASK_RULE)
        state["injected"] += 1
        return "\n".join(lines)[:4000]
    finally:
        save_state(spath, state)


def main():
    try:
        event = json.loads(sys.stdin.read() or "{}")
        text = build_context(event if isinstance(event, dict) else {})
    except Exception:  # a hook error must never block the user's input
        return 0
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
                                                 "additionalContext": text}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
