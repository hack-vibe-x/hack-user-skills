#!/usr/bin/env python3
"""Lists recent Claude Code and Codex sessions and extracts the picked sessions' conversations, shortened for analysis.

Standard library only. Records are only read. The output holds conversation text.

  python3 sessions.py list [--limit 15] [--days 14]
  python3 sessions.py show <id shown in the list, or its number> ... [--budget 12000]

Each line of the list shows the start of the session's id; show takes it and finds that session wherever it is.
show also takes the list's numbers, read from the list this conversation made last. The lists are kept per
conversation in ~/.hus-session-coach/session-playbook/.last-list.json, so a list made in another conversation does
not change what a number means here.
"""
import argparse
import datetime
import glob
import json
import os
import re
import sys
from collections import Counter

INJECTED_TAGS = (
    "command-name", "command-message", "command-args", "local-command-stdout", "local-command-stderr",
    "local-command-caveat", "task-notification", "system-reminder", "bash-input", "bash-stdout", "bash-stderr",
    "environment_context", "user_instructions", "turn_aborted", "user_shell_command",
)
INJECTED_PREFIXES = ("[Request interrupted", "Caveat: The messages below", "This session is being continued",
                     "# AGENTS.md instructions")
STRIP_BLOCKS = ("system-reminder", "ide_selection", "ide_opened_file", "ide_diagnostics")
TEMP_ROOTS = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")
SECRETS = [
    re.compile(r"\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}"),  # OpenAI, Anthropic, Stripe (sk_live_...)
    re.compile(r"\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}"),  # Google API key
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWT
]
SECRET_KV = re.compile(r"(?i)\b(password|passwd|api[_-]?key|secret|token)\b(\s*[:=]\s*)\S+")
PREFIX = "[hus-session-coach]"
# One home folder for the plugin, one sub-folder per skill. HUS_SESSION_COACH_HOME moves the home folder.
DATA_ROOT = os.path.expanduser(os.environ.get("HUS_SESSION_COACH_HOME") or "~/.hus-session-coach")
STATE_DIR = os.path.join(DATA_ROOT, "session-playbook")
LAST_LIST = os.path.join(STATE_DIR, ".last-list.json")
REDACTED = "[redacted]"
USER_KEEP, AI_KEEP, PASTE_KEEP = 1200, 400, 300
ID_SHOWN = 8
MIN_ID = 6
# Lists of other conversations older than this are dropped from .last-list.json.
LIST_KEEP_DAYS = 14
CLAUDE = "Claude Code"
CODEX = "Codex"
CODEX_PATTERNS = ("sessions/**/*.jsonl", "archived_sessions/*.jsonl")
CODEX_ID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
# Files named in a patch: "*** Update File: path".
PATCH_FILE = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", re.M)


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


def rows(path):
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return
    with f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict):
                yield o


def new_session(path, tool):
    return {"id": os.path.splitext(os.path.basename(path))[0], "path": path, "tool": tool, "cwd": None, "title": None,
            "headless": False, "turns": [], "tools": Counter(), "files": []}


def add_turn(turns, role, text, at):
    """Rows of the same role in a row become one turn. A user message recorded twice is kept once."""
    if not text:
        return
    if turns and turns[-1]["role"] == role:
        if not (role == "user" and turns[-1]["text"] == text):
            turns[-1]["text"] += "\n\n" + text
    else:
        turns.append({"role": role, "text": text, "at": at})


def add_file(s, path):
    if path and path not in s["files"]:
        s["files"].append(path)


def parse_claude(path):
    """One Claude Code session file: the person's messages, AI replies, title, and files touched."""
    s = new_session(path, CLAUDE)
    for o in rows(path):
        kind = o.get("type")
        if kind in ("ai-title", "custom-title"):
            s["title"] = o.get("aiTitle") or o.get("customTitle") or s["title"]
            continue
        if kind not in ("user", "assistant") or o.get("isSidechain"):
            continue
        s["cwd"] = s["cwd"] or o.get("cwd")
        s["headless"] = s["headless"] or str(o.get("entrypoint") or "").startswith("sdk")
        content = (o.get("message") or {}).get("content")
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
                    if b.get("name") in ("Edit", "Write", "NotebookEdit"):
                        add_file(s, (b.get("input") or {}).get("file_path"))
        add_turn(s["turns"], role, text, when_of(o))
    return s


def codex_texts(content, kind):
    return [b.get("text") or "" for b in (content or []) if isinstance(b, dict) and b.get("type") == kind]


def parse_codex(path, imported=frozenset()):
    """One Codex session file, in the same shape as parse_claude. A run a program started (codex exec), a subagent's
    run, or a copy Codex imported from another tool is marked headless and not read past its first line."""
    s = new_session(path, CODEX)
    found = CODEX_ID.search(s["id"])
    s["id"] = found.group(1) if found else s["id"]
    typed, fallback, assistant = [], [], []
    has_meta = False
    for seq, o in enumerate(rows(path)):
        typ, p, at = o.get("type"), o.get("payload") or {}, when_of(o)
        if typ == "session_meta" and not has_meta:
            has_meta = True
            source = p.get("source")
            s["id"] = p.get("id") or s["id"]
            s["cwd"] = p.get("cwd")
            s["headless"] = (source == "exec" or p.get("originator") == "codex_exec"
                             or (isinstance(source, dict) and "subagent" in source) or s["id"] in imported)
            if s["headless"]:
                return s
        elif typ == "event_msg" and p.get("type") == "user_message":
            typed.append((seq, at, p.get("message") or ""))
        elif typ == "event_msg" and p.get("type") == "item_completed" and (p.get("item") or {}).get("type") == "UserMessage":
            blocks = (p.get("item") or {}).get("content") or []
            typed.append((seq, at, "\n".join((b.get("text") or "") for b in blocks if isinstance(b, dict))))
        elif typ == "response_item" and p.get("type") == "message" and p.get("role") == "user":
            fallback.append((seq, at, "\n".join(codex_texts(p.get("content"), "input_text"))))
        elif typ == "response_item" and p.get("type") == "message" and p.get("role") == "assistant":
            assistant.append((seq, at, "\n".join(codex_texts(p.get("content"), "output_text")).strip()))
        elif typ == "response_item" and p.get("type") in ("function_call", "custom_tool_call", "local_shell_call"):
            s["tools"][p.get("name") or "shell"] += 1
            body = p.get("input") or p.get("arguments") or ""
            for name in PATCH_FILE.findall(body if isinstance(body, str) else ""):
                add_file(s, name.strip())
    # Typed messages are recorded as events. Only the older format without events falls back to the model input.
    events = [(q, at, "user", clean_user(t)) for q, at, t in (typed or fallback)]
    events += [(q, at, "assistant", t) for q, at, t in assistant]
    for _, at, role, text in sorted(events, key=lambda e: e[0]):
        add_turn(s["turns"], role, text, at)
    return s


def parse(path, imported=frozenset()):
    return parse_codex(path, imported) if os.path.basename(path).startswith("rollout-") else parse_claude(path)


def codex_imported_ids(root):
    """Ids of sessions Codex imported from another tool. They repeat the originals, so they are left out."""
    try:
        with open(os.path.join(root, "external_agent_session_imports.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return frozenset()
    recs = data.get("records", []) if isinstance(data, dict) else []
    return frozenset(r.get("imported_thread_id") for r in recs if isinstance(r, dict) and r.get("imported_thread_id"))


def current_ids():
    """This conversation, in Claude Code or Codex. It is left out of the list."""
    return {x for x in (os.environ.get("CLAUDE_CODE_SESSION_ID"), os.environ.get("CODEX_THREAD_ID")) if x}


def is_mine(s, current):
    current = {current} if isinstance(current, str) else set(current)
    users = [t for t in s["turns"] if t["role"] == "user"]
    cwd = s["cwd"] or ""
    return bool(users) and not s["headless"] and s["id"] not in current and not (cwd + "/").startswith(TEMP_ROOTS)


def project_name(cwd):
    for marker in ("/.claude/worktrees/", "/.codex/worktrees/", "/.worktrees/"):
        if cwd and marker in cwd:
            cwd = cwd.split(marker)[0]
    return os.path.basename((cwd or "").rstrip("/")) or "?"


def session_files(claude_root, codex_root):
    """Every session file of both tools. Claude Code: <project>/<id>.jsonl; Codex: rollout-<time>-<id>.jsonl."""
    found = glob.glob(os.path.join(claude_root, "*", "*.jsonl"))
    for pattern in CODEX_PATTERNS:
        found += glob.glob(os.path.join(codex_root, pattern), recursive=True)
    return [p for p in found if os.path.isfile(p)]


def recent_sessions(claude_root, codex_root, days, limit, current):
    cutoff = datetime.datetime.now().timestamp() - days * 86400
    stamped = []
    for p in session_files(claude_root, codex_root):
        try:
            stamped.append((os.path.getmtime(p), p))
        except OSError:
            pass
    imported = codex_imported_ids(codex_root)
    found = []
    for when, p in sorted(stamped, reverse=True):
        if when < cutoff:
            break
        s = parse(p, imported)
        if is_mine(s, current):
            found.append(s)
            if len(found) >= limit:
                break
    return found


# ---------- the list each conversation made last ----------

def conversation_key():
    return os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CODEX_THREAD_ID") or "-"


def load_lists():
    """{conversation id: {"at": seconds, "items": [...]}}. The older format, one list for everyone, is dropped."""
    try:
        with open(LAST_LIST, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}


def save_list(items):
    now = datetime.datetime.now().timestamp()
    lists = {k: v for k, v in load_lists().items() if now - (v.get("at") or 0) < LIST_KEEP_DAYS * 86400}
    lists[conversation_key()] = {"at": now, "items": items}
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = LAST_LIST + ".tmp-%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lists, f)
    os.replace(tmp, LAST_LIST)


def cmd_list(args):
    found = recent_sessions(os.path.expanduser(args.claude_dir), os.path.expanduser(args.codex_dir), args.days,
                            args.limit, current_ids())
    if not found:
        print("%s No Claude Code or Codex sessions with a person working were found in the last %d days." % (PREFIX, args.days))
        return 0
    save_list([{"n": i, "id": s["id"], "path": s["path"]} for i, s in enumerate(found, 1)])
    for i, s in enumerate(found, 1):
        users = [t for t in s["turns"] if t["role"] == "user"]
        first, last = s["turns"][0]["at"], s["turns"][-1]["at"]
        span = first.strftime("%m-%d %H:%M") if first else "?"
        if first and last and first.date() == last.date() and last > first:
            span += "~" + last.strftime("%H:%M")
        title = s["title"] or head(users[0]["text"], 40)
        opening = head(users[0]["text"], 70)
        print("%2d. %s  [%s · %s] %d messages from me · id %s" % (i, title, project_name(s["cwd"]), s["tool"], len(users),
                                                                 s["id"][:ID_SHOWN]))
        print("    %s · first request: %s" % (span, opening))
    print("\n%s %d sessions. Ask the person which to analyse (several allowed), then pass show the ids shown "
          "(the numbers of this list work too)." % (PREFIX, len(found)))
    return 0


def find_by_id(prefix, claude_root, codex_root):
    """Session files whose id starts with prefix, in either tool's records, at any age."""
    hits = []
    for p in session_files(claude_root, codex_root):
        name = os.path.splitext(os.path.basename(p))[0]
        found = CODEX_ID.search(name) if name.startswith("rollout-") else None
        sid = found.group(1) if found else name
        if sid.startswith(prefix):
            hits.append({"n": "-", "id": sid, "path": p})
    return hits


def resolve(refs, claude_root, codex_root):
    """A number is looked up in the list this conversation made last; an id is looked up in the records themselves."""
    items = (load_lists().get(conversation_key()) or {}).get("items") or []
    out = []
    for ref in refs:
        if ref.isdigit() and len(ref) < MIN_ID:
            hit = next((x for x in items if str(x.get("n")) == ref), None)
            if hit is None:
                print("%s Number %s is not in this conversation's last list. Run list again, or pass the id it shows."
                      % (PREFIX, ref), file=sys.stderr)
                continue
            out.append(hit)
            continue
        if not re.fullmatch(r"[0-9A-Za-z-]{%d,}" % MIN_ID, ref):
            print("%s Not an id: %s (give at least %d characters of the id the list shows)" % (PREFIX, ref, MIN_ID),
                  file=sys.stderr)
            continue
        hits = [x for x in items if x["id"].startswith(ref)] or find_by_id(ref, claude_root, codex_root)
        unique = {x["path"]: x for x in hits}
        if len(unique) == 1:
            out.append(hits[0])
        elif not unique:
            print("%s Not found: %s" % (PREFIX, ref), file=sys.stderr)
        else:
            print("%s %s matches %d sessions; give more of the id" % (PREFIX, ref, len(unique)), file=sys.stderr)
    return out


def render(s, budget):
    """Keeps the person's messages where possible and cuts middle turns when long. The goal and the outcome are at the ends."""
    lines = []
    for t in s["turns"]:
        if t["role"] == "user":
            lines.append("[me] " + clip(mask(t["text"]), USER_KEEP))
        else:
            lines.append("[AI] " + clip(mask(t["text"]), AI_KEEP))
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
    claude_root, codex_root = os.path.expanduser(args.claude_dir), os.path.expanduser(args.codex_dir)
    picked = resolve(args.refs, claude_root, codex_root)
    for hit in picked:
        s = parse(hit["path"])
        users = [t for t in s["turns"] if t["role"] == "user"]
        print("=" * 60)
        number = "%s " % hit["n"] if hit.get("n") not in (None, "-") else ""
        print("Session %s(id %s) — %s" % (number, s["id"][:ID_SHOWN], s["title"] or "(no title)"))
        print("Project: %s · %s · %d messages from me · %d AI replies" % (
            project_name(s["cwd"]), s["tool"], len(users), len(s["turns"]) - len(users)))
        if s["tools"]:
            print("Tools used: " + ", ".join("%s %d" % kv for kv in s["tools"].most_common(6)))
        if s["files"]:
            print("Files changed: " + ", ".join(os.path.basename(p) for p in s["files"][:10]) + (" and %d more" % (len(s["files"]) - 10) if len(s["files"]) > 10 else ""))
        print("-" * 60)
        print("\n\n".join(render(s, args.budget)))
    return 0 if picked else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--claude-dir", default=os.environ.get("HUS_SESSION_COACH_CLAUDE_DIR") or "~/.claude/projects")
    ap.add_argument("--codex-dir", default=os.environ.get("HUS_SESSION_COACH_CODEX_DIR") or "~/.codex")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list")
    p.add_argument("--limit", type=int, default=15)
    p.add_argument("--days", type=int, default=14)
    p.set_defaults(fn=cmd_list)
    p = sub.add_parser("show")
    p.add_argument("refs", nargs="+")
    p.add_argument("--budget", type=int, default=12000, help="character limit per session")
    p.set_defaults(fn=cmd_show)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
