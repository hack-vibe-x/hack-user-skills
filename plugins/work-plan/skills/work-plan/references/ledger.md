# Ledger format

The ledger is the list of where every line of the plan comes from. It lives in the working folder as `ledger.json`. The plan cites its entries as `[1]`, `[2, 5]`; `scripts/ledger.mjs` checks each quote against its material and writes the plan's sources section from it. The person reads the sources section, not this file.

```json
{
  "lang": "en",
  "root": "/absolute/path/of/the/project",
  "materials": [
    { "id": "M0", "path": ".hus-work-plan/2026-11-24-competitor-prices/request.md", "what": "Task description", "read": "full" },
    { "id": "M1", "path": "material/request-mail.txt", "what": "Request mail from the team lead", "read": "full" },
    { "id": "M2", "path": "material/price-list.pdf", "what": "Price list of company A", "read": "partial", "note": "The table on page 3 is an image and was not read" },
    { "id": "M3", "path": ".hus-visual-decision/decisions/2026-11-24-work-plan-round-1.md", "what": "Answers to round 1", "read": "full" }
  ],
  "entries": [
    { "id": "1", "kind": "material", "material": "M1", "where": "second line", "quote": "please send it by 5 December" },
    { "id": "2", "kind": "material", "material": "M3", "quote": "for the board" },
    { "id": "3", "kind": "inference", "from": ["1", "2"], "text": "The team lead has to see a draft before the first week of December.", "why": "A board report goes past the team lead first." },
    { "id": "4", "kind": "assumption", "text": "Only companies A, B and C are looked at.", "why": "No answer on widening the scope." }
  ]
}
```

## Materials

| Field | Meaning |
|---|---|
| `id` | `M0`, `M1`, … `M0` is always the person's own description of the task, saved word for word |
| `path` | Relative to `root` (or absolute). One file per material: list the files of a folder one by one |
| `what` | What it is, in the person's language, for the sources section |
| `read` | `full`, `partial` (say what was not read in `note`) or `unreadable` |
| `note` | Optional. Shown in the sources section |

What counts as material: the person's task description (`request.md`), every file or folder they gave, text they pasted (saved word for word as `pasted-<n>.md`), each visual-decision record of a question round (`.hus-visual-decision/decisions/…md`), and the person's answers given in chat (saved word for word as `answers-<n>.md`). The person's answers are sources like any other: a decision in the plan cites the record it came from.

`ledger.mjs text <file>` prints the text the checker reads from a file. Use it when a quote fails and you think it is right: the PDF or Word reader may have split or joined words differently.

## Entries

`id` is a number as text (`"1"`), unique. Number them in the order you add them; the plan may cite them in any order.

| kind | Required | Use |
|---|---|---|
| `material` | `material`, `quote`; `where` (page, section, row) when it helps find the place | A fact the material states. `quote` is copied, not paraphrased: the shortest span that carries the fact, in the material's own words and language |
| `inference` | `from` (entry ids), `text`, `why` | Something that follows from entries but no material says. The plan must call it an inference where it uses it, not state it as fact |
| `assumption` | `text`, `why` | Something the plan rests on that nobody confirmed: a question the person stopped before answering, or a gap nobody could fill. Every assumption also goes in the plan's "Assumptions and open questions" section |

## What the checker reports

FAIL (fix before saving): a quote not found word for word in its material, a quote from material marked `unreadable`, a missing file, an unknown material or entry id, a duplicate id, an inference with no `from`, a `[n]` in the plan with no entry, a missing or stale sources section.

WARN (open each and decide): material a program cannot read (images, scans, formats with no reader here; mark it `partial` or `unreadable`), an entry the plan never cites, a line of the plan with a number but no `[n]`. Lines inside code blocks (the prompts) are not checked for numbers: state each fact in the plan with its source, and let the prompt repeat it.

Formats read: plain text, Markdown, CSV, JSON, HTML, PDF with a text layer (`pdftotext`), Word, PowerPoint, Excel, Hangul `.hwpx`, OpenDocument, and on macOS `.doc` and `.rtf` (`textutil`). Not read: images, scanned PDFs, `.hwp`. You may still read such a file yourself (you can see images and pages). Then mark it `partial` with the note "read by the AI; quotes not checked by the program", so the person knows which quotes to check by eye. If you could not read it either, mark it `unreadable` and quote nothing from it.
