---
name: criteria-gap
description: When the user hands over work that needs judgement (pick, filter, plan, organise, write for someone) without saying how to judge it, asks for that one criterion first, does the work with it, and remembers it for next time. Also shows, changes and forgets remembered criteria, looks back on a session for work handed over without criteria, and turns the criteria questions off in one project. Use when a [hus-criteria-gap] note arrives, or when the user says "check before I delegate", "look back on this session", "what did I hand over without knowing", "show my criteria", "change this criterion", "forget this criterion", "don't ask about criteria here", "위임 전에 점검해줘", "이 세션 되짚어줘", "내가 뭘 모르고 시켰지", "기준 보여줘", "이 기준 바꿔줘", "이 기준 잊어줘", "여기선 기준 묻지 마".
license: Apache-2.0
---

# Ask for the missing criterion, then remember it

When the user hands over a judgement without a criterion, the AI quietly makes one up and the result drifts. Ask for the one criterion that matters, in the user's own words, then keep it so the same question is never asked twice.

Talk in the user's language, and keep criteria in the user's words and language. To the user, say "remembered criteria"; do not show the record's terms (confirmed, draft, co-created, area, decision) unless they ask.

## When a [hus-criteria-gap] note arrives
The hook adds it to requests that hand over work.
- **Criteria listed that fit the request:** follow them without asking, and say so on the first line of the answer in the user's language (in English: `Applied criteria: ...`).
- **A listed criterion from another area** (another page, channel or audience): ask whether it applies here before using it.
- **Nothing listed fits, or a judgement is still open:** ask as below, before starting.
The list may be cut short; read `.hus-criteria-gap/INDEX.md` (project, then `~/.hus-criteria-gap/`) when needed. Without the hook, do the same by hand when the user asks for a check before delegating.

## How to ask
1. **Pin the work in one line.** "Current work: pick 5 reviews for the home page. One question, then I carry on."
2. **One question per message, and nothing else in it.** Ask only what would send the next step wrong. Keep the rest for after the work: "2 more things were left to me: …".
3. **The user answers first.** Do not show candidates, a recommendation or the criterion you would use. Say they can answer "I don't know" or "go ahead for now". A question back, hesitation or "not sure" counts as "I don't know".
4. **After "I don't know":** give 2–3 candidates, each with a short example from the work, and let them pick or rewrite one. Do not pick one yourself.
5. **After "go ahead for now":** use a criterion of your own, put `Temporary criterion: …` at the top of the answer, and do not remember it unless they later say it is theirs.
6. **Go back to the work** and do it with the answer.

## Remember it (one question)
After the work, if the criterion would apply again, ask once, as the only question at the end of the answer: "Next time, do it this way?" and quote the exact wording you would keep.
Before asking, make that wording right, without asking the user about each point:
- It answers the question that was asked; if it holds two decisions, show them as two lines.
- Every condition the user gave is in it (exclusions, limits, numbers).
- Someone could tell later whether a result met it. If a word like "good" or "enough" leaves that open, ask what it means first, as a criterion question.
- It is the user's words. Point at any part you added: "'no repeated bread' is my wording".

A clear yes saves it; anything else saves nothing. Then say in one line where it was kept.
- Where: `.hus-criteria-gap/` in the project. `~/.hus-criteria-gap/` only when the user says it is for every project. A project criterion wins over a global one for the same thing.
- How: one file per criterion as in [references/format.md](references/format.md), `status: confirmed`, `source: user` (or `co-created` when the user took your wording). Then run `python3 <this skill's folder>/scripts/criteria_index.py rebuild` and `... check`, and fix any error.
- When the folder is new in a git repository, add one line: "Add `.hus-criteria-gap/` to `.gitignore` if these are personal."

## Other requests
- **Show** ("show my criteria"): list them in plain words, grouped by topic, with the date each was decided.
- **Change:** never overwrite. Write a new file that names the old one in `supersedes`, mark the old one `superseded`, and ask the same one question first.
- **Forget:** mark it `retired`; do not delete the file.
- **An old one** (past its review date, 90 days after it was decided) or one the AI wrote: before using it, ask "Still do it this way?". On yes, set today's date.
- **A request that goes against one:** ask "Change the criterion, or an exception this time?". Do not quietly follow either.

## Look back on a session
1. Read the conversation the user pasted or pointed to; keep only the user's and the AI's turns.
2. Find where the user left a judgement to the AI, with a short quote of that turn (no quote, no gap), and the criterion the AI actually used ("newest first").
3. Skip the ones a remembered criterion covers. Of the rest, ask the 2–3 that change the result most, the earliest step first, one at a time as in "How to ask". Show what the AI used only after the user answers.
4. If the user's criterion really differs, say where in one or two lines and write a prompt that redoes the work with it. Run it only when the user agrees.
5. Offer to remember the ones that will come up again.

## Off in one project
"Don't ask about criteria here": write `{"hook": false}` to `.hus-criteria-gap/config.json` in the project (keep anything else in it). For every project, write it to `~/.hus-criteria-gap/config.json`; a project file wins over the global one. To turn it back on, set `true`. It applies from the next request. Showing and changing criteria still work when it is off.

## Do not
- Decide a criterion for the user, or remember one without a clear yes.
- Remember a temporary criterion or a candidate the user did not take.
- Ask two things in one message.
- Make a gap without a quote behind it.
