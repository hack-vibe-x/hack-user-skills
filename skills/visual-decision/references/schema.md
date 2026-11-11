# Question file format

`samples/decisions.json` (English) and `samples/decisions.ko.json` (Korean) contain all five decision types.

```json
{ "id": "lead-list-layout", "lang": "en", "title": "Lead list screen", "decisions": [ ... ] }
```

`id` becomes part of the record file name (the question file name if missing). `title` is the title of the page and the record. `lang` picks the UI language (`en`, `ko`, or any `locales/<code>.json`).

## Common to every decision

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | An English name that is unique within the batch. Answers come back under it |
| `type` | yes | `pick` `preview` `multi` `batch` `value` |
| `q` | yes | The question in one line |
| `short` | | A short name for the left-hand list |
| `tag` | | A label for the kind of decision (screen design, copy, structure, approval…) |
| `ctx` | | One sentence on why it is being asked now |
| `more` | | Longer background, folded away |
| `facts` | | Chips for the current state. `[["Commits","25"],["Tests","835 pass"]]` |
| `pattern` | | A note shown under the decision. For samples only; leave it out in real use |

## Which type

| Situation | Type |
|---|---|
| One of 2–4: designs, copy, structure, approvals | `pick` |
| Choices that only change the feel of one screen: color, font, spacing | `preview` |
| Pick several to include (scope, within a budget) | `multi` |
| Several light, unrelated decisions | `batch` |
| Pick one number | `value` |

## pick

```json
{ "id": "layout", "type": "pick", "q": "Which layout should we use?",
  "dims": ["Leads on one screen", "Mobile", "Effort"],
  "options": [
    { "key": "table", "label": "Table", "rec": true, "cap": "One row per person",
      "visual": { "type": "screen", "layout": "table" },
      "d": [["12 leads", "good"], ["Scrolls sideways", "bad"], ["1 day", ""]],
      "when": "Skimming many leads quickly matters most" }
  ],
  "same": "All three keep the same search and filter." }
```

- `d` follows `dims`: same order, same count. Each cell is `[value, "good" | "bad" | ""]`.
- `when` is one "choose this when…" line. `cap` is the caption under the visual.

### visual

| type | Fields | Use for |
|---|---|---|
| `screen` | `layout`: `table` `cards` `split` | A skeleton of a common screen layout |
| `button` | `text` | Button copy placed on a real button |
| `html` | `html`, `height` (px) | A small design you draw yourself. Rendered in an isolated frame; scripts do not run |
| `image` | `src` (file path) | A screenshot or mock image. Only files inside the working dir or a temp dir |
| `grid` | `cols`, `rows`, `mark` (cell numbers to paint red), `big` | Comparing counts or sizes (cells, table size) |
| `steps` | `steps` (names), `reach` (how far it goes, from 0) | How far along a flow it goes |

`screen`, `button`, `html` and `image` are drawn inside a window frame so it is clear they are "the thing being shown". If an `html` or `image` is a diagram rather than a screen, add `"screen": false` to drop the frame.

## preview

One big preview with the options swapped in.

```json
{ "id": "accent", "type": "preview", "q": "Which accent color?",
  "preview": { "html": "<h3>Title</h3><span class=\"pv-btn\">Button</span>" },
  "options": [ { "key": "indigo", "label": "Indigo", "color": "#3b4bd8", "desc": "Calm", "rec": true } ] }
```

- Inside the preview HTML, `var(--pv)` becomes the option's `color`. To change other values, give the option `"vars": {"--pv": "...", "--radius": "..."}`.
- Without `preview`, a built-in preview (badge, title, link, button, bars) is used.
- If `color` is a 6-digit hex, the contrast of white text on it is computed and shown.

## multi

```json
{ "id": "scope", "type": "multi", "q": "What goes into this week?", "budget": 5, "unit": " days",
  "items": [ { "id": "forms", "label": "Forms admin", "sub": "No-code forms", "cost": 2, "rec": true } ] }
```

Items with `rec` start selected. `budget` and `cost` are optional (the total bar disappears without them).

## batch

```json
{ "id": "small", "type": "batch", "q": "Three small decisions.",
  "items": [ { "id": "sort", "q": "Default table sort",
    "options": [ { "key": "new", "label": "Newest first", "sub": "New on top", "rec": true }, { "key": "name", "label": "By name", "sub": "Easy to find" } ] } ] }
```

Give each item one `rec` ("Pick all recommended" uses it). `sub` says what differs between options.

## value

```json
{ "id": "limit", "type": "value", "q": "How many per day?", "unit": "per day",
  "stops": [
    { "v": 100, "label": "Careful", "outs": [ { "k": "Time to finish", "v": "12 days", "t": "bad", "p": 50 } ] },
    { "v": 200, "label": "Recommended", "rec": true, "outs": [ { "k": "Time to finish", "v": "6 days", "t": "", "p": 25 } ] } ] }
```

List the values a person can pick as `stops`, and write the result for each value (`outs`) ahead of time. A stop with `label` becomes a quick-pick button. `p` is a bar length (0–100).

## What comes back

```
- layout: "split" · additional comments: Make the detail area wider
- cta: sent back (options) — Claude will come up with other options and ask again. Why: I'd like shorter ones too
- scope: ["forms","dm"]
- small: {"sort":"new"}
- limit: 200
```
