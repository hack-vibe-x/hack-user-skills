#!/usr/bin/env python3
"""Checks that every quote in a diary is in the material word for word, with the right time and speaker.
Exit code 1 when a quote is wrong.

Quote form: “my words”(13:25), “AI words”(13:25 AI), with the quote marks of the diary's language
(locales/<code>.json quote.open, quote.close). The time is the one on the material's [13:25 me], [13:25 AI] lines.
Sentences outside quotes cannot be checked.

Example: python3 check_quotes.py <diary.md> <material.md> [--lang ko]
"""
import argparse
import re
import sys

import i18n

PREFIX = "[hus-session-coach]"
TURN_RE = re.compile(r"^\[(\d\d:\d\d) (me|AI)\] ", re.M)
# Only the material's own headings end a turn. A "## " inside an AI reply or pasted text is part of the turn.
SECTION_RE = re.compile(r"^## (?:Session |Facts |Commits that day)", re.M)
NOT_IN_MATERIAL = "not in the material"
WRONG_PLACE = "time or speaker differs"
NO_TIME = "no time given"


def marks(lang):
    t = i18n.T(lang)
    return t("quote.open"), t("quote.close")


def quote_re(lang):
    left, right = (re.escape(m) for m in marks(lang))
    return re.compile(r"%s(.+?)%s(?:\s*\((\d\d:\d\d)( AI)?\))?" % (left, right), re.S)


def evidence_heading(lang):
    return "\n## " + i18n.T(lang)("diary.h.evidence")


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


def turns_of(material):
    """(time, speaker) -> the texts of the turns that started at that time."""
    turns = {}
    found = list(TURN_RE.finditer(material))
    for i, m in enumerate(found):
        end = found[i + 1].start() if i + 1 < len(found) else len(material)
        body = material[m.end():end]
        section = SECTION_RE.search(body)
        if section:
            body = body[:section.start()]
        turns.setdefault((m.group(1), m.group(2)), []).append(normalize(body))
    return turns


def repair(diary, material, lang="en"):
    """When the words are found in exactly one turn, write that turn's time and speaker. Other quotes stay as they are."""
    turns = turns_of(material)
    left, right = marks(lang)

    def fix(match):
        text = normalize(match.group(1))
        places = [key for key, bodies in turns.items() if any(text in body for body in bodies)]
        if len(places) != 1:
            return match.group(0)
        when, who = places[0]
        return "%s%s%s(%s%s)" % (left, match.group(1), right, when, " AI" if who == "AI" else "")

    return quote_re(lang).sub(fix, diary)


def drop_broken_refs(diary, lang="en"):
    """Remove body [n] numbers that the evidence section does not list, so a deleted quote leaves no dead number."""
    head, mark, tail = diary.partition(evidence_heading(lang))
    if not mark:
        return re.sub(r" ?\[\d+\]", "", head)
    listed = set(re.findall(r"^\[(\d+)\]", tail, flags=re.M))
    return re.sub(r" ?\[(\d+)\]", lambda m: m.group(0) if m.group(1) in listed else "", head) + mark + tail


def renumber_refs(diary, lang="en"):
    """Number references from 1 in reading order and sort the evidence lines the same way. Unused evidence goes last."""
    head, mark, tail = diary.partition(evidence_heading(lang))
    if not mark:
        return diary
    lines = tail.split("\n")
    items = [i for i, line in enumerate(lines) if re.match(r"\[\d+\]", line)]
    if not items:
        return diary
    order = list(dict.fromkeys(re.findall(r"\[(\d+)\]", head)))
    listed = [re.match(r"\[(\d+)\]", lines[i]).group(1) for i in items]
    order = [n for n in order if n in listed] + [n for n in listed if n not in order]
    new = {old: str(i + 1) for i, old in enumerate(order)}
    head = re.sub(r"\[(\d+)\]", lambda m: "[%s]" % new.get(m.group(1), m.group(1)), head)
    by_old = {re.match(r"\[(\d+)\]", lines[i]).group(1): lines[i] for i in items}
    for slot, old in zip(items, order):
        lines[slot] = re.sub(r"\A\[\d+\]", "[%s]" % new[old], by_old[old])
    return head + mark + "\n".join(lines)


def problems(diary, material, earlier="", lang="en"):
    """(number of quotes, [(problem, quote)]). A quote found word for word in earlier diaries is not wrong."""
    turns = turns_of(material)
    earlier = normalize(earlier)
    quotes = quote_re(lang).findall(diary)
    found = []
    for text, when, ai in quotes:
        text = normalize(text)
        if text in earlier:
            continue
        if not when:
            found.append((NO_TIME, text))
        elif not any(text in body for body in turns.get((when, "AI" if ai else "me"), [])):
            anywhere = any(text in body for bodies in turns.values() for body in bodies)
            found.append((WRONG_PLACE if anywhere else NOT_IN_MATERIAL, text))
    return len(quotes), found


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("diary")
    ap.add_argument("material")
    ap.add_argument("--lang", default="en", help="the diary's language code (quote marks and headings)")
    args = ap.parse_args(argv)
    with open(args.diary, encoding="utf-8") as f:
        diary = f.read()
    with open(args.material, encoding="utf-8") as f:
        material = f.read()
    total, found = problems(diary, material, lang=i18n.pick(args.lang))
    body = re.sub(r"\A---\n.*?\n---\n", "", diary, flags=re.S)
    print("%s %d quotes, %d wrong, body %d characters" % (PREFIX, total, len(found), len(body)))
    for why, text in found:
        print("  %s: %s" % (why, text))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
