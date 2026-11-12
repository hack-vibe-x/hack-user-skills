#!/usr/bin/env python3
"""Rebuild and check INDEX.md of a criteria record folder. Standard library only.

  python3 criteria_index.py rebuild [--dir DIR ...]
  python3 criteria_index.py check   [--dir DIR ...] [--today YYYY-MM-DD]

Without --dir it works on the project folder (.hus-criteria-gap/ in the working folder or the
nearest one above it, up to HOME) and the global folder (~/.hus-criteria-gap/), whichever exist.

The criterion files are the source; INDEX.md is made from them and never edited by hand.
`check` exits 1 when it finds an error (a broken file, or an INDEX.md that differs from the files)
and 0 otherwise; warnings (a criterion that is not to be treated as confirmed) do not fail it.
The format is in ../references/format.md.
"""
import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

DATA_DIR = ".hus-criteria-gap"
INDEX = "INDEX.md"
REVIEW_DAYS = 90
STATUSES = ("confirmed", "draft", "superseded", "retired")
SOURCES = ("user", "co-created", "ai-inferred")
REQUIRED = ("id", "area", "decision", "status", "source")
ID_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
SUMMARY = 80
HEADER = ("# Criteria index\n\n"
          "<!-- Made from the criterion files by scripts/criteria_index.py rebuild. Do not edit by hand. -->\n")


# ---------- reading (the same rules as hooks/criteria_hook.py and hooks/criteria-card.tsx) ----------

def parse_file(text):
    """(front matter or None when there is none, body)."""
    text = text.lstrip("﻿").replace("\r\n", "\n")
    if not text.startswith("---\n"):
        return None, text.strip()
    end = text.find("\n---", 4)
    if end == -1:
        return None, text.strip()
    meta = {}
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
        meta[key.strip()] = str(value)
    return meta, text[end + 4:].lstrip("\n").strip()


def parse_date(value):
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        return None


def review_date(meta):
    """review_after, else REVIEW_DAYS after confirmed_at, else None."""
    due = parse_date(meta.get("review_after"))
    if due is None:
        confirmed = parse_date(meta.get("confirmed_at"))
        due = confirmed + datetime.timedelta(days=REVIEW_DAYS) if confirmed else None
    return due


def one_line(text, limit):
    text = " ".join(re.sub(r"[\x00-\x1f]", " ", str(text)).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def read_folder(folder):
    """[(file name, front matter or None, body or error text)] for every criterion file, by name."""
    entries = []
    for f in sorted(folder.glob("*.md")):
        if f.name == INDEX or not f.is_file():
            continue
        try:
            meta, body = parse_file(f.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as err:
            entries.append((f.name, None, f"cannot be read ({err.__class__.__name__})"))
            continue
        entries.append((f.name, meta, body))
    return entries


# ---------- INDEX.md ----------

def index_line(name, meta, body):
    due = review_date(meta) if meta.get("status") in ("confirmed", "draft") else None
    summary = one_line(body.split("\n", 1)[0] if body else "", SUMMARY)
    parts = [f"[{meta.get('id') or Path(name).stem}]({name})",
             f"{one_line(meta.get('area', ''), 40)}/{one_line(meta.get('decision', ''), 40)}",
             meta.get("status", "") or "?", meta.get("source", "") or "?",
             f"review {due.isoformat()}" if due else "review -", summary]
    return "- " + " · ".join(parts)


def build_index(entries):
    rank = {s: i for i, s in enumerate(STATUSES)}
    rows = [(m.get("area", ""), m.get("decision", ""), rank.get(m.get("status"), len(rank)), n, m, b)
            for n, m, b in entries if m is not None]
    rows.sort(key=lambda r: r[:4])
    lines = [index_line(n, m, b) for _, _, _, n, m, b in rows]
    return HEADER + "\n" + ("\n".join(lines) if lines else "(no criteria yet)") + "\n"


# ---------- checks ----------

def check_folder(folder, entries, known_ids, today):
    """([errors], [warnings]) as 'file: message' strings."""
    errors, warnings = [], []
    confirmed_keys = {}
    superseded_by = {m.get("supersedes") for _, m, _ in entries if m and m.get("supersedes")}
    for name, meta, body in entries:
        if meta is None:
            errors.append(f"{name}: {body}" if body.startswith("cannot be read") else
                          f"{name}: no front matter (a block between '---' lines at the top)")
            continue
        missing = [k for k in REQUIRED if not meta.get(k)]
        if missing:
            errors.append(f"{name}: missing {', '.join(missing)}")
        cid, status, source = meta.get("id", ""), meta.get("status", ""), meta.get("source", "")
        if cid and cid != Path(name).stem:
            errors.append(f"{name}: id '{cid}' does not match the file name")
        if cid and not ID_RE.fullmatch(cid):
            errors.append(f"{name}: id '{cid}' is not lowercase ASCII letters, digits and hyphens")
        if status and status not in STATUSES:
            errors.append(f"{name}: status '{status}' is not one of {', '.join(STATUSES)}")
        if source and source not in SOURCES:
            errors.append(f"{name}: source '{source}' is not one of {', '.join(SOURCES)}")
        for key in ("confirmed_at", "review_after"):
            if meta.get(key) and parse_date(meta[key]) is None:
                errors.append(f"{name}: {key} '{meta[key]}' is not a date (YYYY-MM-DD)")
        if status == "confirmed" and parse_date(meta.get("confirmed_at")) is None:
            errors.append(f"{name}: confirmed without confirmed_at")
        if meta.get("supersedes") and meta["supersedes"] not in known_ids:
            errors.append(f"{name}: supersedes '{meta['supersedes']}', which is not in the record")
        if not body:
            errors.append(f"{name}: no criterion text under the front matter")
        if status == "confirmed":
            key = (meta.get("area", ""), meta.get("decision", ""))
            if key in confirmed_keys:
                errors.append(f"{name}: a second confirmed criterion for {key[0]}/{key[1]} "
                              f"(also {confirmed_keys[key]}); supersede or retire one")
            else:
                confirmed_keys[key] = name
            if source == "ai-inferred":
                warnings.append(f"{name}: confirmed but ai-inferred, so it is not treated as confirmed; "
                                f"ask the user whether it is theirs")
            due = review_date(meta)
            if due and due < today:
                warnings.append(f"{name}: past its review date ({due.isoformat()}), so it is not treated as "
                                f"confirmed; recheck it with the user")
        if status == "superseded" and cid and cid not in superseded_by:
            warnings.append(f"{name}: superseded, but no criterion names it in supersedes")
    index = folder / INDEX
    try:
        current = index.read_text(encoding="utf-8").replace("\r\n", "\n") if index.is_file() else None
    except (OSError, UnicodeDecodeError):
        current = None
    if current is None:
        if entries:  # a folder with no criterion yet (only config.json, say) needs no index
            errors.append(f"{INDEX}: missing; run rebuild")
    elif current != build_index(entries):
        errors.append(f"{INDEX}: differs from the criterion files; run rebuild")
    return errors, warnings


# ---------- folders ----------

def default_folders():
    home = Path(os.environ.get("HOME") or os.path.expanduser("~")).resolve()
    global_dir = home / DATA_DIR
    folders = []
    start = Path.cwd().resolve()
    for d in [start, *start.parents]:
        candidate = d / DATA_DIR
        if candidate.is_dir():
            if candidate.resolve() != global_dir.resolve():
                folders.append(candidate)
            break
        if d == home:
            break
    if global_dir.is_dir():
        folders.append(global_dir)
    return folders


def main(argv=None):
    ap = argparse.ArgumentParser(description="Rebuild and check INDEX.md of the criteria record.")
    ap.add_argument("command", choices=("rebuild", "check"))
    ap.add_argument("--dir", action="append", default=[], help="a record folder (repeatable)")
    ap.add_argument("--today", help="YYYY-MM-DD, for the review date check (default: today)")
    args = ap.parse_args(argv)

    folders = [Path(d) for d in args.dir] if args.dir else default_folders()
    folders = [f for f in folders if f.is_dir()]
    if not folders:
        print("No criteria record folder here (.hus-criteria-gap/ in this project or ~/.hus-criteria-gap/).")
        return 0
    today = parse_date(args.today) if args.today else datetime.date.today()
    if today is None:
        print(f"--today '{args.today}' is not a date (YYYY-MM-DD).", file=sys.stderr)
        return 2

    read = [(f, read_folder(f)) for f in folders]
    if args.command == "rebuild":
        for folder, entries in read:
            text = build_index(entries)
            (folder / INDEX).write_text(text, encoding="utf-8")
            count = sum(1 for _, m, _ in entries if m is not None)
            skipped = [n for n, m, _ in entries if m is None]
            print(f"{folder / INDEX}: {count} criteria" +
                  (f"; left out (no front matter or unreadable): {', '.join(skipped)}" if skipped else ""))
        return 0

    known_ids = {m.get("id") for _, entries in read for _, m, _ in entries if m and m.get("id")}
    total_err = total_warn = 0
    for folder, entries in read:
        errors, warnings = check_folder(folder, entries, known_ids, today)
        total_err += len(errors)
        total_warn += len(warnings)
        print(f"{folder}: {len(entries)} criterion files, {len(errors)} errors, {len(warnings)} warnings")
        for e in errors:
            print(f"  ERROR {e}")
        for w in warnings:
            print(f"  WARN  {w}")
    return 1 if total_err else 0


if __name__ == "__main__":
    sys.exit(main())
