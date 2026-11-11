# Result file format and writing rules

One file, four sections, in this order. Write the whole file, headings included, in the language the person uses with you; the English below is the structure, not the wording. Quotes from sessions stay in the words the person used.

````markdown
# Know-how for <topic> (<date>)

Sessions analysed: list of <number. title (date, project)>
What was read: one line on how much of each shortened conversation, or of the whole, was read

## 1. Task spec
The common kind of task in one sentence. Under it, one line per session:
- Session N: what was made or fixed -> result (finished, or stopped half way)

## 2. Know-how
Numbered, 5 to 10 items. Five lines each:
- **Judgement**: one sentence with a condition. "When ..., A; when ..., B"
- **Criterion**: why it was chosen that way. If the person gave no reason, infer it from the conversation and mark it "(inferred)".
- **Evidence**: session number and a short quote of the person's message
- **Scope**: this project only / this kind of work in general
- **Where it goes in a skill**: one of these five. Trigger phrases (description) / order of steps / rule / done check / ask the person

## 3. Skill candidates
0 to 4. Only tasks that have all three below are candidates. If one is missing, drop it.
- **It has a procedure.** It went in a similar order each time.
- **The instruction is clear.** You can say what goes in and what has to come out for it to be done.
- **It repeated.** The same kind of work came up in two or more sessions.

For each:
- Name (lowercase-hyphenated)
- **Trigger phrases**: 1 to 3 quotes of what the person actually said when starting that work
- Input and output
- Evidence for the three: which sessions repeated it, what the procedure is, what had to be explained again every time
- **Done criterion**: the point where the person accepted the result and what they checked then. If there is no accepting message, "not confirmed"
- **Judgement left to the person**: what the person decided themselves after turning down the AI's proposal. The skill does not decide it; it is a step that asks. If none, "none"
If nothing repeated enough to become a skill, write "no candidates".

## 4. Prompt to paste
```text
(Prompt text to copy into a new session or CLAUDE.md)
```
````

## Choosing know-how
Know-how is **judgement and tricks that only someone who has done it knows, and that rarely get written down**. It is not information (what something is) but method (how, when, and why it is done that way).
- **It carries context.** It is a judgement that changes with conditions.
- **It comes from failure.** Experience of trying and being wrong set into a criterion.
- **Often even the person cannot explain it.** It comes out as "this isn't it" (tacit knowledge). So do not drop it because the person gave no reason; infer the criterion and write it down.

Moved into a document, often only the result survives and "why it was chosen that way" falls out. So always write a judgement with its criterion. If you cannot find the criterion, write "criterion unknown"; do not make one up to fill the count.

For each candidate ask "could someone doing this for the first time find it by searching or by common sense?" and drop it if so. Know-how with evidence shows these signals:
- **The person correcting the AI.** "That's not it", "why did you ...", "again", "check ... first". The strongest signal.
- **A decision reversed, an approach abandoned.** Why it was abandoned is the criterion.
- **A request repeated across sessions.** If it comes up in two or more sessions it is a habit or a criterion.
- **A fixed order of work.** If A was checked before B every time, look at the judgement inside that order.
- **The moment of acceptance.** What the person checked just before "done", "good", "let's go with this". It becomes a done check.
- **What the person decided themselves.** Where they turned down the AI's choice and gave their own. Keep it as "ask the person".

Drop general truths that a beginner knows too ("run the tests"), one-off facts such as that project's file names and values, generalities the AI produced on its own, and a preference that came up once.

## Writing judgements and the prompt
- An evidence quote is one phrase of the person's message, word for word. Do not reword it.
- Write "not confirmed" for what the sessions did not confirm (such as a session whose outcome is unknown).
- Do not copy the know-how section into the prompt; rewrite it as text for the AI that takes on the work: the task, what to check first, the criteria for judgement, what not to do, what to ask the person (judgement left to the person), and the "done" criterion (from the done checks). Leave out evidence quotes and session numbers, but keep the condition and criterion of each judgement. Without the criterion, the receiving AI cannot adapt to another situation and only copies the result.
- Do not pad the prompt with instructions. Keep only the know-how that would send this work badly wrong if broken.
- Do not let the skill candidates and the prompt say the same thing twice. The prompt is for use now; skill candidates are for later.
