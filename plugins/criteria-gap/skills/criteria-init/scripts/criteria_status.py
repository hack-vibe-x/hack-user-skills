#!/usr/bin/env python3
"""Status of the criteria check hook and the question card, and a summary of their records.
Standard library only. Reads; never writes.

  python3 criteria_status.py status  [--session ID] [--json]
  python3 criteria_status.py summary [--days N] [--all] [--json]

status   the settings that apply in the working folder (and which file they came from), and how
         many times the hook and the card stepped in during one session: --session, else
         $CLAUDE_CODE_SESSION_ID, else the most recent session.
summary  over the judge log (~/.hus-criteria-gap/judge-log/<project>/<session>.jsonl): how often the
         card judged and asked, what became of each question (answered, "don't know", skipped,
         expired, withdrawn, open), by kind, and the questions the user missed. Also the hook's
         session counters (kept 7 days, not split by project). This project only unless --all.

What the files hold: hooks/criteria_hook.py (session counters), hooks/criteria-card.tsx (judge log).
"""
import argparse
import datetime
import json
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

DATA_DIR = ".hus-criteria-gap"
PLUGIN = "hack-user-skills-criteria-gap"
HOOK_TEMP = "hus-criteria-gap-hook"
LIMITS = {"enabled": False, "intensity": "light", "max_per_session": 3, "cooldown_turns": 3}
KINDS = ("premise", "distinction", "principle", "criterion")
OUTCOMES = ("answered", "unknown", "skipped", "expired", "withdrawn", "open")
DONE_EVENTS = {"question-answered": "answered", "question-skipped": "skipped",
               "question-expired": "expired", "question-withdrawn": "withdrawn"}


def home():
    return Path(os.environ.get("HOME") or os.path.expanduser("~")).resolve()


def log_key(text):
    """How the card names a project or session folder in the judge log."""
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text)


# ---------- settings (same lookup as the hook and the card) ----------

def find_dirs(cwd):
    global_dir = home() / DATA_DIR
    project = None
    for d in [cwd, *cwd.parents]:
        if (d / DATA_DIR).is_dir():
            project = d / DATA_DIR
            break
        if d == home():
            break
    if project is not None and project.resolve() == global_dir.resolve():
        project = None
    return project, global_dir if global_dir.is_dir() else None


def load_settings(cwd):
    project, global_dir = find_dirs(cwd)
    for folder in (project, global_dir):
        if folder is None or not (folder / "config.json").is_file():
            continue
        path = folder / "config.json"
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError
        except (ValueError, OSError):
            return {"file": str(path), "broken": True, "card": False, "lang": None, "hook": dict(LIMITS)}
        hook = dict(LIMITS)
        if isinstance(raw.get("hook"), dict):
            hook.update({k: raw["hook"][k] for k in LIMITS if k in raw["hook"]})
        return {"file": str(path), "broken": False, "card": raw.get("card") is True,
                "lang": raw.get("lang") if isinstance(raw.get("lang"), str) else None, "hook": hook}
    return {"file": None, "broken": False, "card": False, "lang": None, "hook": dict(LIMITS)}


# ---------- the hook's session counters ----------

def hook_state_dirs():
    dirs = []
    if os.environ.get("CLAUDE_PLUGIN_DATA"):
        dirs.append(Path(os.environ["CLAUDE_PLUGIN_DATA"]) / "sessions")
    config = Path(os.environ.get("CLAUDE_CONFIG_DIR") or home() / ".claude")
    dirs += sorted((config / "plugins" / "data").glob(f"{PLUGIN}-*/sessions"))
    dirs.append(Path(tempfile.gettempdir()) / HOOK_TEMP / "sessions")
    seen, out = set(), []
    for d in dirs:
        if d.is_dir() and d.resolve() not in seen:
            seen.add(d.resolve())
            out.append(d)
    return out


def read_json(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (ValueError, OSError):
        return None


def hook_counts(state):
    def num(key, default=0):
        try:
            return int(state.get(key, default))
        except (TypeError, ValueError):
            return default
    return {"requests": num("turn"), "delegations": num("delegations"), "injected": num("injected"),
            "asked_to_check": num("fires"), "last_fire": num("last_fire", -999)}


def hook_files():
    return [f for d in hook_state_dirs() for f in d.glob("*.json")]


# ---------- the judge log ----------

def log_root():
    return home() / DATA_DIR / "judge-log"


def read_log(path):
    events = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return events
    for line in lines:
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("event"), str):
            events.append(obj)
    return events


def parse_at(value):
    try:
        at = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo else at.replace(tzinfo=datetime.timezone.utc)


def session_card(events):
    """Questions of one session's log with what became of each, and counts."""
    questions, order = {}, []
    counts = Counter()
    for ev in events:
        name = ev["event"]
        if name == "judge":
            counts["judged"] += 1
            if ev.get("forced"):
                counts["forced"] += 1
            if not ev.get("ok"):
                counts["failed"] += 1
            if ev.get("dropped"):
                counts["dropped"] += 1
            tokens = ev.get("tokens") if isinstance(ev.get("tokens"), dict) else {}
            counts["input_tokens"] += int(tokens.get("input_tokens") or 0)
            counts["output_tokens"] += int(tokens.get("output_tokens") or 0)
            q = ev.get("question")
            if isinstance(q, dict) and q.get("question"):
                key = (q.get("turn", ev.get("turn")), q["question"])
                if key not in questions:
                    order.append(key)
                questions[key] = {"at": ev.get("at"), "kind": q.get("kind"), "question": q["question"],
                                  "quote": q.get("quote", ""), "outcome": "open", "answer": None}
        elif name in DONE_EVENTS:
            key = (ev.get("turn"), ev.get("question"))
            q = questions.get(key)
            if q is None:  # older lines carry no turn: the latest open question with the same text
                q = next((questions[k] for k in reversed(order)
                          if k[1] == key[1] and questions[k]["outcome"] == "open"), None)
            if q is None:  # its judge line was not kept
                q = questions[key] = {"at": ev.get("at"), "kind": ev.get("kind"), "question": ev.get("question"),
                                      "quote": "", "outcome": "open", "answer": None}
                order.append(key)
            q["outcome"] = DONE_EVENTS[name]
            if name == "question-answered":
                q["answer"] = ev.get("answer")
                if ev.get("unknown") or ev.get("answer") == "I don't know":
                    q["outcome"] = "unknown"
    items = [questions[k] for k in order]
    counts["shown"] = len(items)
    for q in items:
        counts[q["outcome"]] += 1
    return items, counts


# ---------- status ----------

def status(args):
    cwd = Path.cwd().resolve()
    settings = load_settings(cwd)
    sid = args.session or os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") or ""
    guessed = False
    hook_file = card_file = None
    if sid:
        hook_name = re.sub(r"[^A-Za-z0-9_-]", "-", sid)[:80] + ".json"
        hook_file = next((d / hook_name for d in hook_state_dirs() if (d / hook_name).is_file()), None)
        card_file = next(iter(sorted(log_root().glob(f"*/{log_key(sid)}.jsonl"))), None)
    else:
        guessed = True
        logs = sorted(project_logs(cwd), key=lambda p: p.stat().st_mtime)
        card_file = logs[-1] if logs else None
        states = sorted(hook_files(), key=lambda p: p.stat().st_mtime)
        if card_file is not None:
            sid = card_file.stem
            hook_file = next((d / f"{sid}.json" for d in hook_state_dirs() if (d / f"{sid}.json").is_file()), None)
        elif states:
            hook_file = states[-1]
            sid = hook_file.stem

    hook = hook_counts(read_json(hook_file) or {}) if hook_file else None
    if hook:
        hook["since_last"] = hook["requests"] - hook["last_fire"] if hook["last_fire"] > -999 else None
    card = None
    if card_file:
        items, counts = session_card(read_log(card_file))
        card = {"counts": dict(counts), "waiting": next((q for q in reversed(items) if q["outcome"] == "open"), None)}
    out = {"settings": settings, "session": sid or None, "session_guessed": guessed,
           "hook": hook, "hook_file": str(hook_file) if hook_file else None,
           "card": card, "card_file": str(card_file) if card_file else None}
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    h = settings["hook"]
    src = settings["file"] or "no config.json (defaults)"
    print(f"Settings from: {src}" + (" (broken: counts as off)" if settings["broken"] else ""))
    print(f"  hook: {'on' if h['enabled'] is True else 'off'} · intensity {h['intensity']} · "
          f"max_per_session {h['max_per_session']} · cooldown_turns {h['cooldown_turns']}")
    print(f"  card: {'on' if settings['card'] else 'off'} · limits as the hook's" +
          (f" · lang {settings['lang']}" if settings["lang"] else ""))
    if not sid:
        print("Session: unknown, and no session record was found.")
        return 0
    print(f"Session: {sid}" + (" (the most recent one; pass --session for another)" if guessed else ""))
    if hook:
        last = f", last {hook['since_last']} requests ago" if hook["since_last"] is not None else ""
        print(f"  hook: {hook['requests']} requests seen · {hook['delegations']} delegating · "
              f"criteria added {hook['injected']} times · said criteria were missing "
              f"{hook['asked_to_check']}/{h['max_per_session']} times{last}")
    else:
        print("  hook: no record for this session (off, never triggered, or older than 7 days)")
    if card:
        c = card["counts"]
        print(f"  card: judged {c.get('judged', 0)} turns · {c.get('shown', 0)}/{h['max_per_session']} questions shown"
              f" · answered {c.get('answered', 0) + c.get('unknown', 0)} (don't know {c.get('unknown', 0)})"
              f" · skipped {c.get('skipped', 0)} · expired {c.get('expired', 0)}"
              f" · dropped (quote not in the prompt) {c.get('dropped', 0)} · failed {c.get('failed', 0)}")
        if card["waiting"]:
            print(f"  waiting above the prompt: {card['waiting']['question']}")
    else:
        print("  card: no judge log for this session (off, or no turn judged yet)")
    return 0


# ---------- summary ----------

def project_dirs(cwd):
    """Judge-log folders for the working folder or the nearest folder above it that has one."""
    root = log_root()
    for d in [cwd, *cwd.parents]:
        folder = root / log_key(str(d))
        if folder.is_dir():
            return [folder]
        if d == home():
            break
    return []


def project_logs(cwd):
    return [f for d in project_dirs(cwd) for f in d.glob("*.jsonl")]


def summary(args):
    cwd = Path.cwd().resolve()
    root = log_root()
    folders = sorted(d for d in root.glob("*") if d.is_dir()) if args.all else project_dirs(cwd)
    since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=args.days)) if args.days else None

    totals, by_kind, sessions, questions = Counter(), {k: Counter() for k in KINDS}, 0, []
    for folder in folders:
        for path in sorted(folder.glob("*.jsonl")):
            events = read_log(path)
            if since:
                events = [e for e in events if (parse_at(e.get("at")) or since) >= since]
            if not events:
                continue
            sessions += 1
            items, counts = session_card(events)
            totals.update(counts)
            for q in items:
                if q["kind"] in by_kind:
                    by_kind[q["kind"]]["shown"] += 1
                    by_kind[q["kind"]][q["outcome"]] += 1
                questions.append({**q, "project": folder.name, "session": path.stem})

    cutoff = datetime.datetime.now().timestamp() - 7 * 86400
    hook = Counter()
    for f in hook_files():
        try:
            if f.stat().st_mtime < cutoff:
                continue
        except OSError:
            continue
        state = read_json(f)
        if state:
            hook["sessions"] += 1
            hook.update({k: v for k, v in hook_counts(state).items() if k != "last_fire"})

    questions.sort(key=lambda q: str(q.get("at") or ""), reverse=True)
    missed = [q for q in questions if q["outcome"] in ("unknown", "skipped", "expired")]
    out = {"scope": "all projects" if args.all else (folders[0].name if folders else None),
           "days": args.days, "sessions": sessions, "card": dict(totals),
           "by_kind": {k: dict(v) for k, v in by_kind.items() if v}, "missed": missed[:args.limit],
           "recent": questions[:args.limit], "hook_last_7_days": dict(hook)}
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    period = f"last {args.days} days" if args.days else "all time"
    if not folders:
        print(f"Judge log: none under {root} yet." if args.all else
              f"Judge log: none for this folder under {root}. Try --all for every project.")
    else:
        where = "all projects" if args.all else str(folders[0])
        print(f"Judge log: {where} ({period})")
        t = totals
        judged = t.get("judged", 0)
        rate = f" ({round(100 * t.get('shown', 0) / judged)}% of judged turns)" if judged else ""
        print(f"  sessions {sessions} · turns judged {judged} (by /criteria-check {t.get('forced', 0)})"
              f" · questions shown {t.get('shown', 0)}{rate}")
        print(f"  dropped because the quote was not in the prompt {t.get('dropped', 0)}"
              f" · judgements that failed {t.get('failed', 0)}"
              f" · tokens in {t.get('input_tokens', 0):,} / out {t.get('output_tokens', 0):,}")
        print("  what became of the questions: " +
              " · ".join(f"{o} {t.get(o, 0)}" for o in OUTCOMES) +
              "  (open: still above the prompt, or closed before expiry was logged)")
        for kind, c in out["by_kind"].items():
            print(f"  {kind}: shown {c.get('shown', 0)} · " +
                  " · ".join(f"{o} {c[o]}" for o in OUTCOMES if c.get(o)))
        if missed:
            print("  missed (\"don't know\", skipped, or left to expire), newest first:")
            for q in missed[:args.limit]:
                day = str(q.get("at") or "")[:10]
                quote = f" — on \"{q['quote']}\"" if q.get("quote") else ""
                print(f"    {day} {q.get('kind')} · {q['outcome']} · {q['question']}{quote}")
    if hook:
        print(f"Hook, last 7 days (all projects): sessions {hook['sessions']} · requests {hook['requests']}"
              f" · delegating {hook['delegations']} · criteria added {hook['injected']}"
              f" · said criteria were missing {hook['asked_to_check']}")
    else:
        print("Hook, last 7 days: no session counters (off, or not triggered).")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Status and record summary of the criteria hook and question card.")
    sub = ap.add_subparsers(dest="command", required=True)
    st = sub.add_parser("status")
    st.add_argument("--session", default="")
    st.add_argument("--json", action="store_true")
    sm = sub.add_parser("summary")
    sm.add_argument("--days", type=int, default=30, help="0 for all time (default 30)")
    sm.add_argument("--all", action="store_true", help="every project, not only this one")
    sm.add_argument("--limit", type=int, default=10, help="questions listed (default 10)")
    sm.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    return status(args) if args.command == "status" else summary(args)


if __name__ == "__main__":
    sys.exit(main())
