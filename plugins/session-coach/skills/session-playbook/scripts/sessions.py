#!/usr/bin/env python3
"""Lists recent Claude Code sessions and extracts the picked sessions' conversations, shortened for analysis.

Standard library only. Records are only read. The output holds conversation text.

  python3 sessions.py list [--limit 15] [--days 14]
  python3 sessions.py show <number or start of a session id> ... [--budget 12000]

list keeps its numbers in ~/.hus-session-coach/session-playbook/.last-list.json, and show reads the same numbers.
"""
import argparse
import datetime
import json
import os
import re
import sys
from collections import Counter

INJECTED_TAGS = (
    "command-name", "command-message", "command-args", "local-command-stdout", "local-command-stderr",
    "local-command-caveat", "task-notification", "system-reminder", "bash-input", "bash-stdout", "bash-stderr",
)
INJECTED_PREFIXES = ("[Request interrupted", "Caveat: The messages below", "This session is being continued")
STRIP_BLOCKS = ("system-reminder", "ide_selection", "ide_opened_file", "ide_diagnostics")
TEMP_ROOTS = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")
SECRETS = [
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S),
]
SECRET_KV = re.compile(r"(?i)\b(password|passwd|api[_-]?key|secret|token)\b(\s*[:=]\s*)\S+")
PREFIX = "[hus-session-coach]"
# One home folder for the plugin, one sub-folder per skill. HUS_SESSION_COACH_HOME moves the home folder.
DATA_ROOT = os.path.expanduser(os.environ.get("HUS_SESSION_COACH_HOME") or "~/.hus-session-coach")
STATE_DIR = os.path.join(DATA_ROOT, "session-playbook")
LAST_LIST = os.path.join(STATE_DIR, ".last-list.json")
REDACTED = "[redacted]"
USER_KEEP, AI_KEEP, PASTE_KEEP = 1200, 400, 300


def mask(text):
    for rx in SECRETS:
        text = rx.sub(REDACTED, text)
    return SECRET_KV.sub(lambda m: m.group(1) + m.group(2) + REDACTED, text)


def clean_user(text):
    """Keeps only what the person typed. Empty for text a tool put in."""
    t = text.strip() if isinstance(text, str) else ""
    m = re.match(r"<([A-Za-z_-]+)", t)
    if not t or (m and m.group(1) in INJECTED_TAGS) or t.startswith(INJECTED_PREFIXES):
        return ""
    for tag in STRIP_BLOCKS:
        t = re.sub(r"<%s\b[^>]*>.*?</%s>" % (tag, tag), "", t, flags=re.S)

    def paste(mt):
        body = mt.group(1).strip()
        more = " ...(+%d chars)" % (len(body) - PASTE_KEEP) if len(body) > PASTE_KEEP else ""
        return "[pasted] " + body[:PASTE_KEEP] + more

    return re.sub(r"<pasted_content\b[^>]*>(.*?)(?:</pasted_content\b[^>]*>|\Z)", paste, t, flags=re.S).strip()


def clip(text, limit):
    if len(text) <= limit:
        return text
    head = limit * 2 // 3
    return "%s ...(%d chars cut)... %s" % (text[:head], len(text) - limit, text[-(limit - head):])


def head(text, limit):
    """A one-line preview. Keeps the start only."""
    one = " ".join(text.split())
    return one if len(one) <= limit else one[:limit].rstrip() + "…"


def texts(content):
    if isinstance(content, str):
        return [content]
    return [b.get("text", "") for b in (content or []) if isinstance(b, dict) and b.get("type") == "text"]


def when_of(row):
    try:
        return datetime.datetime.fromisoformat(str(row.get("timestamp")).replace("Z", "+00:00")).astimezone()
    except ValueError:
        return None


def parse(path):
    """One session file: the person's messages, AI replies, title, and files touched."""
    s = {"id": os.path.splitext(os.path.basename(path))[0], "path": path, "cwd": None, "title": None,
         "headless": False, "turns": [], "tools": Counter(), "files": []}
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return s
    with f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if not isinstance(o, dict):
                continue
            kind = o.get("type")
            if kind in ("ai-title", "custom-title"):
                s["title"] = o.get("aiTitle") or o.get("customTitle") or s["title"]
                continue
            if kind not in ("user", "assistant") or o.get("isSidechain"):
                continue
            s["cwd"] = s["cwd"] or o.get("cwd")
            s["headless"] = s["headless"] or str(o.get("entrypoint") or "").startswith("sdk")
            content = (o.get("message") or {}).get("content")
            at = when_of(o)
            if kind == "user":
                origin = o.get("origin")
                if o.get("isMeta") or o.get("isCompactSummary") or (isinstance(origin, dict) and origin.get("kind") not in (None, "human")):
                    continue
                text = "\n".join(p for p in (clean_user(x) for x in texts(content)) if p)
                role = "user"
            else:
                text = "\n".join(p for p in (x.strip() for x in texts(content)) if p)
                role = "assistant"
                for b in content if isinstance(content, list) else []:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        s["tools"][b.get("name") or "?"] += 1
                        path_in = (b.get("input") or {}).get("file_path")
                        if b.get("name") in ("Edit", "Write", "NotebookEdit") and path_in and path_in not in s["files"]:
                            s["files"].append(path_in)
            if not text:
                continue
            turns = s["turns"]
            if turns and turns[-1]["role"] == role:
                if not (role == "user" and turns[-1]["text"] == text):
                    turns[-1]["text"] += "\n\n" + text
            else:
                turns.append({"role": role, "text": text, "at": at})
    return s


def is_mine(s, current_id):
    users = [t for t in s["turns"] if t["role"] == "user"]
    cwd = s["cwd"] or ""
    return bool(users) and not s["headless"] and s["id"] != current_id and not (cwd + "/").startswith(TEMP_ROOTS)


def project_name(cwd):
    for marker in ("/.claude/worktrees/", "/.codex/worktrees/", "/.worktrees/"):
        if cwd and marker in cwd:
            cwd = cwd.split(marker)[0]
    return os.path.basename((cwd or "").rstrip("/")) or "?"


def recent_sessions(root, days, limit, current_id):
    cutoff = datetime.datetime.now().timestamp() - days * 86400
    paths = []
    for proj in os.listdir(root) if os.path.isdir(root) else []:
        pdir = os.path.join(root, proj)
        for name in os.listdir(pdir) if os.path.isdir(pdir) else []:
            p = os.path.join(pdir, name)
            if name.endswith(".jsonl") and os.path.isfile(p) and os.path.getmtime(p) >= cutoff:
                paths.append(p)
    paths.sort(key=os.path.getmtime, reverse=True)
    found = []
    for p in paths:
        s = parse(p)
        if is_mine(s, current_id):
            found.append(s)
            if len(found) >= limit:
                break
    return found


def cmd_list(args):
    current = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    found = recent_sessions(os.path.expanduser(args.claude_dir), args.days, args.limit, current)
    if not found:
        print("%s No Claude Code sessions with a person working were found in the last %d days." % (PREFIX, args.days))
        return 0
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(LAST_LIST, "w", encoding="utf-8") as f:
        json.dump([{"n": i, "id": s["id"], "path": s["path"]} for i, s in enumerate(found, 1)], f)
    for i, s in enumerate(found, 1):
        users = [t for t in s["turns"] if t["role"] == "user"]
        first, last = s["turns"][0]["at"], s["turns"][-1]["at"]
        span = first.strftime("%m-%d %H:%M") if first else "?"
        if first and last and first.date() == last.date() and last > first:
            span += "~" + last.strftime("%H:%M")
        title = s["title"] or head(users[0]["text"], 40)
        opening = head(users[0]["text"], 70)
        print("%2d. %s  [%s] %d messages from me" % (i, title, project_name(s["cwd"]), len(users)))
        print("    %s · first request: %s" % (span, opening))
    print("\n%s %d sessions. Ask the person which numbers to analyse (several allowed)." % (PREFIX, len(found)))
    return 0


def resolve(refs):
    try:
        with open(LAST_LIST, encoding="utf-8") as f:
            last = json.load(f)
    except (OSError, ValueError):
        last = []
    out = []
    for ref in refs:
        hit = next((x for x in last if str(x["n"]) == ref), None) if ref.isdigit() else None
        if hit is None:
            hit = next((x for x in last if x["id"].startswith(ref)), None)
        if hit is None:
            print("%s Not found: %s (run list first)" % (PREFIX, ref), file=sys.stderr)
            continue
        out.append(hit)
    return out


def render(s, budget):
    """Keeps the person's messages where possible and cuts middle turns when long. The goal and the outcome are at the ends."""
    lines = []
    for t in s["turns"]:
        if t["role"] == "user":
            lines.append("[me] " + mask(clip(t["text"], USER_KEEP)))
        else:
            lines.append("[AI] " + mask(clip(t["text"], AI_KEEP)))
    if sum(len(x) for x in lines) > budget:
        keep, size = set(), 0
        # Half the budget each to the start and the end. If the start took it all, the outcome would be cut.
        for order in (range(len(lines)), range(len(lines) - 1, -1, -1)):
            used = 0
            for i in order:
                if i in keep or used + len(lines[i]) > budget // 2:
                    break
                keep.add(i)
                used += len(lines[i])
        out, prev = [], -1
        for i in sorted(keep):
            if i != prev + 1:
                out.append("...(%d turns cut)..." % (i - prev - 1))
            out.append(lines[i])
            prev = i
        if prev != len(lines) - 1:
            out.append("...(%d turns cut)..." % (len(lines) - 1 - prev))
        lines = out
    return lines


def cmd_show(args):
    picked = resolve(args.refs)
    for k, hit in enumerate(picked, 1):
        s = parse(hit["path"])
        users = [t for t in s["turns"] if t["role"] == "user"]
        print("=" * 60)
        print("Session %s — %s" % (hit["n"], s["title"] or "(no title)"))
        print("Project: %s · %d messages from me · %d AI replies" % (project_name(s["cwd"]), len(users), len(s["turns"]) - len(users)))
        if s["tools"]:
            print("Tools used: " + ", ".join("%s %d" % kv for kv in s["tools"].most_common(6)))
        if s["files"]:
            print("Files changed: " + ", ".join(os.path.basename(p) for p in s["files"][:10]) + (" and %d more" % (len(s["files"]) - 10) if len(s["files"]) > 10 else ""))
        print("-" * 60)
        print("\n\n".join(render(s, args.budget)))
    return 0 if picked else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--claude-dir", default="~/.claude/projects")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list")
    p.add_argument("--limit", type=int, default=15)
    p.add_argument("--days", type=int, default=14)
    p.set_defaults(fn=cmd_list)
    p = sub.add_parser("show")
    p.add_argument("refs", nargs="+")
    p.add_argument("--budget", type=int, default=12000, help="character limit per session")
    p.set_defaults(fn=cmd_show)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
