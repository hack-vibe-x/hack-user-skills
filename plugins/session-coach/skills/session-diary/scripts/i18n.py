"""Text a person reads that the scripts write themselves: diary labels, the statistics block, notifications.

It lives in ../locales/<code>.json as flat keys. en.json is the full base; another language file overrides it key by
key, so a missing key falls back to English and a key missing everywhere shows as its own name.
"""
import json
import os
import re

LOCALES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "locales")


def _read(code):
    with open(os.path.join(LOCALES, code + ".json"), encoding="utf-8") as f:
        return json.load(f)


def is_known(code):
    """Only a short code that has a language file, so a setting cannot point outside the folder."""
    return (isinstance(code, str) and re.fullmatch(r"[a-z]{2,3}", code) is not None
            and os.path.isfile(os.path.join(LOCALES, code + ".json")))


def pick(*candidates):
    return next((c for c in candidates if is_known(c)), "en")


def languages():
    return sorted(name[:-5] for name in os.listdir(LOCALES) if re.fullmatch(r"[a-z]{2,3}\.json", name))


def every(key):
    """{code: value} of one key in each language file, not merged. For text that may come from any language."""
    found = {}
    for code in languages():
        value = _read(code).get(key)
        if value:
            found[code] = value
    return found


def fmt(text, values):
    return re.sub(r"\{(\w+)\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)


class T:
    """t = T("ko"); t("notify.written", date="10/3"). t.raw(key) is the value with its {placeholders} unfilled."""

    def __init__(self, code):
        self.lang = pick(code)
        self.strings = _read("en")
        if self.lang != "en":
            self.strings.update(_read(self.lang))

    def raw(self, key):
        return self.strings.get(key, key)

    def __call__(self, key, **values):
        return fmt(self.raw(key), values)
