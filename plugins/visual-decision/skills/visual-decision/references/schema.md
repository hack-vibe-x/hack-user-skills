# Question file format

`samples/decisions.json` (English) and `samples/decisions.ko.json` (Korean) contain all five decision types.

```json
{ "lang": "en", "title": "Lead list screen", "decisions": [ ... ] }
```

`title` is the title of the page. `terms` (optional) is the list of words explained on every question: `[["DM", "A private message to one person"]]`; see "Words" below. `themes` (optional) names concerns that run across several decisions: `[{ "id": "undo", "label": "Undo", "desc": "Whether you can go back" }]`; each decision lists the ids it touches in its own `themes`. `lang` picks the UI language (`en`, `ko`, or any `locales/<code>.json`); a region such as `ko-KR` uses `ko`. A code with no locale file is reported by `--check`.

Answers in progress are kept in the browser together with a hash of the question file. If the file changes at all, they are dropped, so answers for an old version never come back.

## The three layers of a page

Every question page reads from top to bottom in three layers. Write each layer for the person who stops there.

1. **In plain words** (`plain`, and each option's `gist`): what this is, in two or three sentences a 14-year-old understands. No code names, no jargon. If a word is unavoidable, explain it in `terms`.
2. **What you need to choose**: the pictures, the rows that differ, what each option gives up (`give`), "choose this when" (`when`), the recommendation with its condition (`recNote`).
3. **More detail**: background (`more`) and each card's folded details: an honest drawback (`flaw`), what happens (`after`), a lens line, an example, evidence, what to know first, a common confusion.

With three or more decisions, the page opens on an overview (a map of what will be decided, where nothing is chosen) built from `short`, `stake`, `depends`, `undo` and `themes`.

When the person picks an answer, its `means` sentence shows under the options. On a decision that takes work to undo or cannot be undone (`undo` "costly" or "none", or `noDelegate`), it is a check: "Is this what you mean?", answered before they can move on. On an easy one it is a single line, and "Go with this, next" settles it, so the check keeps its weight where it matters. Write `means` as one or two plain sentences that say what will happen, not what the option is called.

The page gives each colour one meaning: green and red only for good and bad (red also for "cannot be undone"), blue for what the person chose or can press. Badges for undo, confidence and the recommendation are grey.

## Words

The page is read by someone who has not seen the project, so every string is written for a stranger: no labels from your own notes, no coined phrases, one idea per sentence. SKILL.md has the rules and the "read it cold" step. `--check` enforces what a program can:

- every decision has `plain`, in at most four sentences;
- an abbreviation (`DM`, `API`) or a name from code (`session_relay`, `pendingFile`, `notes.md`), in any field or in the words of an `html` picture, has a line in `terms` (top level or on the question). `AI`, `UI`, `OK`, `URL`, `ID`, `PDF`, `CSV`, `FAQ` need none;
- a sentence in a prose field (`plain`, `gist`, `means`, `give`, `flaw`, `when`, `cap`, `why`, `q`…) is at most 90 characters in Korean, 170 in English;
- more than five `terms`, a term not used on its question, and a meaning that only repeats the word are refused.

`serve.mjs <file> --text` prints all the words the person will see, numbered, one per line, and nothing else (no field names, ids or markup; a picture drawn in `html` is read block by block). Give it to a reader who knows nothing about the project. `--text-map` says where each number is in the file, for fixing; it is not for the reader.

The built-in labels of the page use the same **?** for a few words that need it (the recommended option, sent back, "You decide", "not chosen yet"); they come from `gl.<name>.w` (the words, split by `|`) and `gl.<name>.m` (the meaning) in the language file.

## Common to every decision

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | An English name that is unique within the batch. Answers come back under it |
| `type` | yes | `pick` `preview` `multi` `batch` `value` |
| `q` | yes | The question in one line |
| `short` | | A short name for the left-hand list |
| `tag` | | A label for the kind of decision (screen design, copy, structure, approval…) |
| `plain` | | Two or three plain sentences on what this decision is (layer 1). Always write it |
| `ctx` | | One sentence on why it is being asked now |
| `more` | | Longer background, folded away |
| `facts` | | Chips for the current state. `[["Commits","25"],["Tests","835 pass"]]` |
| `pattern` | | A note shown under the decision. For samples only; leave it out in real use |
| `noDelegate` | | `true` for an approval before a hard-to-undo action. The page hides "Decide for me" and the server refuses it, so the person must pick or send it back for more information or other options |
| `undo` | | How hard it is to go back: `"easy"`, `"costly"` or `"none"`, or `{ "level", "how" }`. Shown as a badge. `"none"` works like `noDelegate`. Options can carry their own `undo` |
| `stake` | | One line on what is at stake, for the overview |
| `depends` | | One line on which other decision this one hangs on, for the overview |
| `themes` | | Ids from the top-level `themes` |
| `terms` | | `[["word", "meaning in plain words"]]`: words that cannot be replaced. Listed under the question, and the page puts a **?** after the word wherever it appears (once per block of text); pressing or hovering it shows the meaning. At most five; each must appear on the question |
| `panels` | | Boxes above the options: `[{ "title", "text" }]` or `[{ "title", "visual" }]` (for example a `blast` or `impact` visual, or a pre-mortem line) |
| `recNote` | | The recommendation as a condition, not a speech: `{ "if": "safety matters more than speed", "conf": "high" \| "mid" \| "low", "why": "one sentence" }` |
| `lens` | | The name of a lens (for example "Second-order effect"); each option's `lens` line uses it |

Hard-to-undo decisions (`noDelegate`, or `undo` level `"none"`) show the recommendation, but their options open only after the comparison has scrolled into view.

Option `key`s and item `id`s are text (`"1"`, not `1`) and may hold any characters, `:` included.

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

- `d` follows `dims`: same order, same count. Each cell is `[value, "good" | "bad" | ""]`, or an object `{ "v", "t", "n", "lo", "hi", "conf", "why" }`:
  - `n` draws a bar on a scale shared by all options; `lo` and `hi` draw a range with `n` as the likely value.
  - `conf` is `"high"` (checked or measured), `"mid"` (from similar work) or `"low"` (a guess). A low one is drawn dashed. Give `why` with it: one short reason.
  - Never write effort as days or weeks of a person's time. Write what changes and what the person has to check ("New layout and the reply box move · check 2 screens").
- A row can be `"Name"` or `{ "q": "How many fit on one screen?", "short": "Shown", "now": "now 5", "max": 12 }`. Write rows as questions the person would ask, all phrased the same way round. `now` is today's value for comparison.
- Rows that are the same for every option are folded into one line under the cards; the person can show them.
- `when` is one "choose this when…" line. `cap` is the caption under the visual.
- Option fields for the layers:

  | Field | Layer | Meaning |
  |---|---|---|
  | `gist` | 1 | One plain line: the bottom line of this option |
  | `means` | check | One or two plain sentences: what will happen if this is chosen. Shown in the check under the options |
  | `give` | 2 | What choosing this gives up (or, for the baseline, what doing nothing costs) |
  | `baseline` | 2 | `true` for "do nothing / keep it as it is". Drawn with a dashed border |
  | `flaw` | 3 | The honest drawback of the recommended option |
  | `after` | 3 | 2–3 short lines on what is true once it is chosen |
  | `lens` | 3 | One line through the decision's `lens` |
  | `example` | 3 | A named person doing a concrete thing |
  | `detail` | 3 | `{ "evidence": [["measured" \| "file" \| "estimate", "text"]], "prereq", "confusion", "visual" }` |
  | `check`, `next` | record | How to check it worked, and what happens next. Written into the record |

  A non-recommended option also shows what it gains and loses against the recommended one, worked out from the `d` marks.
- Under the options the person may type an answer of their own instead ("None of these?"). It comes back as `own answer (none of the options) — "…"`. Add `"ownAnswer": false` to the decision when only the listed options make sense (for example yes/no approvals).

### visual

| type | Fields | Use for |
|---|---|---|
| `screen` | `layout`: `table` `cards` `split` | A skeleton of a common screen layout |
| `button` | `text` | Button copy placed on a real button |
| `html` | `html`, `height` (px, optional) | A small design you draw yourself. Rendered in an isolated frame; scripts do not run. The frame fits the drawing's height; `height` is the least it gets |
| `image` | `src` (file path) | A screenshot or mock image: png, jpg, gif, webp or svg, inside the working dir or `/tmp`. A relative path starts at the working dir. `--check` reports a file the page cannot show |
| `grid` | `cols`, `rows`, `mark` (cell numbers to paint red), `big` | Comparing counts or sizes (cells, table size) |
| `steps` | `steps` (names), `reach` (how far it goes, from 0) | How far along a flow it goes |
| `diff` | `before`, `after` (two visuals; leave `after` out for "nothing changes"), `text` (`[before, after]`, optional) | Something the person already has changes: a screen, copy, settings. A card shows the new version, with today's words under it when they can be read; the person can switch the view to side by side or swipe (a view setting, not an answer). A text diff is offered only when `text` is given |
| `timeline` | `max`, `ticks` (`[[x, "label"]]`), `lanes` (`[{ "name", "items": [{ "from", "to", "label", "t" }] }]`), `pnr` (point of no return), `pnrLabel` | When things happen, and from when there is no way back |
| `impact` | `center`, `rings` (up to 3 lists of `{ "l", "t": "bad" \| "unsure" \| "" }`), `legend` | What else is touched, by distance from the change |
| `story` | `panels` (`[{ "caption", "visual" }]`, 2–4) | What a person goes through, step by step |
| `odds` | `hit`, `of` (default 100), `lo`, `hi` | A chance, as "3 in 100"; `lo`–`hi` are drawn as outlined cells |
| `blast` | `add`, `change`, `del`, `why` | Counts of what an approval adds, changes and removes |

Any visual can also take `notes` (`[{ "at": [x%, y%], "text", "dim": row index }]`: numbered pins tied to the rows) and `focus` (`[x%, y%, width%, height%]`: dims everything but the part that differs).

Which picture to use:

| What differs between the options | Visual |
|---|---|
| How a screen looks | `screen`, `image` or `html`, with `notes`; or `diff` |
| Wording, settings or code | `diff` (`text` mode) |
| Quantities | numbers in the `d` cells (`n`, `lo`, `hi`) |
| When things happen | `timeline` |
| What else is affected | `impact` |
| What a user goes through | `story` or `steps` |
| A chance of something | `odds` |
| Whether it can be undone | `undo`, `timeline` with `pnr` |

`screen`, `button`, `html` and `image` are drawn inside a window frame so it is clear they are "the thing being shown". If an `html` or `image` is a diagram rather than a screen, add `"screen": false` to drop the frame.

## preview

One big preview with the options swapped in.

```json
{ "id": "accent", "type": "preview", "q": "Which accent color?",
  "preview": { "html": "<h3>Title</h3><span class=\"pv-btn\">Button</span>" },
  "options": [ { "key": "indigo", "label": "Indigo", "color": "#3b4bd8", "desc": "Calm", "rec": true } ] }
```

- Inside the preview HTML, `var(--pv)` becomes the option's `color`. To change other values, give the option `"vars": {"--pv": "...", "--radius": "..."}`.
- The preview is drawn in an isolated frame, one per option; scripts do not run and the page's own styles do not reach it. The classes `pv-badge`, `pv-btn` and `pv-chart` are available inside it. `preview.height` sets the frame height in px (default 320).
- Without `preview`, a built-in preview (badge, title, link, button, bars) is used.
- If `color` is a 6-digit hex, the contrast of white text on it is computed and shown.

## multi

```json
{ "id": "scope", "type": "multi", "q": "What goes into this week?", "budget": 5, "unit": " days",
  "items": [ { "id": "forms", "label": "Forms admin", "sub": "No-code forms", "cost": 2, "rec": true } ] }
```

Items can take a `visual` (a small picture next to each). Items with `rec` are laid out ahead of time with dashed lines, but they are not an answer yet. The question counts as decided once the person toggles an item, presses "Keep this", or presses "Keep this and go on". Moving to another question in the list does not decide it. `budget` and `cost` are optional (the total bar disappears without them).

## batch

```json
{ "id": "small", "type": "batch", "q": "Three small decisions.",
  "items": [ { "id": "sort", "q": "Default table sort",
    "options": [ { "key": "new", "label": "Newest first", "sub": "New on top", "rec": true }, { "key": "name", "label": "By name", "sub": "Easy to find" } ] } ] }
```

Give each item one `rec` ("Pick all recommended" uses it). `sub` says what differs between options.

## value

```json
{ "id": "limit", "type": "value", "q": "How many per day?", "unit": " per day",
  "stops": [
    { "v": 100, "label": "Careful", "outs": [ { "k": "Time to finish", "v": "12 days", "t": "bad", "p": 50 } ] },
    { "v": 200, "label": "Recommended", "rec": true, "outs": [ { "k": "Time to finish", "v": "6 days", "t": "", "p": 25 } ] } ] }
```

Also for `value`:

- `values`: `{ "q": "What matters more this time?", "left", "right", "labels": [...], "map": [stop index per label] }`. The person's answer marks the stop that fits it ("your priority"). It is a hint, not the answer.
- `assume`: one line on what the outcomes are based on.
- An out can take `conf`, `why` and `odds` (`{ "hit", "lo", "hi" }`, drawn as an icon array).
- A stop can take `means` (the sentence for the check).
- When the outs have `p`, all stops' outcomes are drawn side by side above the slider.

`unit` (here and in `multi`) is put right after the number as written: start it with a space when the language wants one (`" per day"` → 200 per day, `"%"` → 20%; Korean counters also go on without a space).

List the values a person can pick as `stops`, and write the result for each value (`outs`) ahead of time. A stop with `label` becomes a quick-pick button. `p` is a bar length (0–100). The slider starts on the `rec` stop as a draft; like `multi`, it becomes the answer only when the person moves it, picks a stop, or keeps it.

## What comes back

```
- layout: "split" · decided by: Leads shown · additional comments: Make the detail area wider
- name: own answer (none of the options) — "Lead inbox"
- cta: sent back (options) — Claude will come up with other options and ask again. Why: I'd like shorter ones too
- perm: sent back (delegate) — Go with the recommended "ask". Tell the user what you chose.
- scope: ["forms","dm"]
- small: {"sort":"new"}
- limit: 200
```

`decided by` lists the rows the person said decided it, on the review page (optional). The record also keeps, where the question file gives them: what the answer does (`means`), whether it matched the recommendation, how to undo it, `check` and `next`.
