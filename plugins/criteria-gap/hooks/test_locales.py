"""Checks the question card's language files against the keys criteria-card.tsx uses.

Run from hooks/: python3 -m unittest -v test_locales
"""
import json
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCALES = HERE / "locales"
KEY = re.compile(r"""['"`]((?:card|kind|check|log|notice)\.[a-z_.]+|command\.description)['"`]""")


def placeholders(text):
    return sorted(set(re.findall(r"\{(\w+)\}", text)))


class LocaleTest(unittest.TestCase):
    def setUp(self):
        self.source = (HERE / "criteria-card.tsx").read_text(encoding="utf-8")
        self.en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))

    def used_keys(self):
        keys = set(KEY.findall(self.source))
        kinds = re.search(r"const KINDS: GapKind\[\] = \[([^\]]*)\]", self.source).group(1)
        keys |= {f"kind.{k}" for k in re.findall(r"'(\w+)'", kinds)}
        # Keys built from a value at run time.
        keys |= {"card.quote.user", "card.quote.ai", "log.quote.user", "log.quote.ai", "log.skipped", "log.expired"}
        return keys

    def test_every_key_the_card_uses_is_in_en_json(self):
        missing = sorted(k for k in self.used_keys() if k not in self.en)
        self.assertEqual(missing, [])

    def test_no_key_is_left_unused(self):
        unused = sorted(k for k in self.en if k not in self.used_keys())
        self.assertEqual(unused, [])

    def test_language_files_are_flat_and_match_en_json(self):
        for path in sorted(LOCALES.glob("*.json")):
            with self.subTest(path.name):
                self.assertRegex(path.name, r"^[a-z]{2,3}\.json$")
                data = json.loads(path.read_text(encoding="utf-8"))
                for key, value in data.items():
                    self.assertIsInstance(value, str, key)
                    self.assertIn(key, self.en, key)
                    self.assertEqual(placeholders(value), placeholders(self.en[key]), key)

    def test_korean_has_every_key(self):
        ko = json.loads((LOCALES / "ko.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(ko), sorted(self.en))


if __name__ == "__main__":
    unittest.main()
