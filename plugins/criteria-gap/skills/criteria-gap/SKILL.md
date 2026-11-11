---
name: criteria-gap
description: Finds the points in a conversation with an AI where the user handed over work without judgement criteria (how to pick sources, what a good result is, and so on), asks for the criteria, compares them with the implicit criteria the AI used, and redoes the work if needed. Use when the user says "analyze this conversation", "check for missing criteria", "what did I hand over without knowing", "look back on this session", "check before I delegate", "대화 분석해줘", "기준 비어 있는지 봐줘", "내가 뭘 모르고 시켰지", "이 세션 되짚어줘", "위임 전에 점검해줘". Saving and looking up criteria is the criteria skill.
license: Apache-2.0
---

# criteria-gap: finding missing criteria

When a user hands over work without telling what they know from what they don't, the result is left to chance and drifts off course.
This skill finds those gaps, has the user state the criteria in their own words, and keeps the agreed criteria in the record (`hack-user-skills-criteria-gap:criteria`).
The storage format, lookup rules, and **checks before saving** come from that skill. It is in the same plugin.

Talk to the user in the language they use. Criteria are written in the user's words and language.

## Two modes
- **Look back**: go over a session that already happened. Steps 1–7.
- **Check before delegating**: see whether the request about to be sent has criteria. Steps 3–5 and 8 only. This mode drifts easily, so always follow "Keep the direction" below.

## When the hook is on
If the hook was turned on with `hack-user-skills-criteria-gap:criteria-init`, a `[hus-criteria-gap]` block arrives in the context with each delegating request. It starts steps 3–5 of this skill for you.
- If a confirmed criterion in the block applies to the request, apply it without asking and state `Applied criteria: ...`.
- If the block says the criteria this prompt needs are not listed, ask only the one criterion that blocks the work, before starting. The list in the block may be a filtered part, so look up the record directly with `hack-user-skills-criteria-gap:criteria` when needed.
- Without the hook, or with it off, this skill works the same way by hand.

## Card answers
If the question card was turned on with `hack-user-skills-criteria-gap:criteria-init`, the plugin asks about gaps (an omitted premise, a distinction, understanding a principle, a criterion) in a card above the prompt after a turn ends. A `[hus-criteria-gap]` note in the context says so. In that session, do not also ask about gaps in the chat: the same gap would be asked twice.
A message that starts with `[hus-criteria-gap answer]` is the user's answer to that card. It holds the kind, the question, the options if any, the user's words the question rests on, and the user's answer.
1. **Pin the current work in one line**, handle the answer, then go back to that work ("Keep the direction").
2. Handle it by kind:
   - **Omitted premise, distinction**: if the answer differs from what the AI filled in on its own in the last piece of work, say where in one or two lines and give the corrected result, or ask whether to redo it. If it is the same, confirm in one line and move on.
   - **Principle**: if the answer fits the principle, confirm briefly. If it is wrong or misses something, explain the principle briefly, tied to the user's own example. Do not grade it.
   - **Criterion**: as in step 5. Apply the criterion the user wrote in their wording; saving goes through the checks before saving of `hack-user-skills-criteria-gap:criteria`.
3. **If the answer is "I don't know"**, show 2–3 candidates (each with a short example) as in step 5 and let the user pick or rewrite one.
4. Do not save the answer to the record right away. If it is worth keeping as a criterion, ask "Save this as a criterion?" separately.

## Keep the direction
Do not let asking about criteria make the user lose the work in hand.
- Before asking, **pin the current work in one line**. Example: "Current work: filter sources, then plan. Let's settle one criterion and carry on." Once the criterion is settled, go straight back to that work and do it.
- **Ask only blocking questions now.** Ask now only what would send the next step wrong without it; gather the rest and report them after the work as "N criteria were missing".
- **Always allow "go ahead for now".** If the user does not want to decide now, go on with a temporary criterion and state `Temporary criterion: ...` at the top of the answer. **Do not save temporary criteria.** After the work, ask "Is the temporary criterion I used yours?"; if yes, save it then, through the checks before saving.

## Procedure

### 1. Read the session
Read the conversation the user pasted or the file path they gave. Storage formats differ by tool, so open it and pull out only the user and AI turns in order. If you cannot read it, ask the user to paste it.

### 2. Find delegation points and implicit criteria
Find where the user left a judgement to the AI (filter it, plan it, pick, organise).
For each, infer and write down **the criteria the AI actually used to make the result**. Example: "filtered by newest first".
Pick the gap type from these:
- Selection (what to keep, what to drop)
- Quality (what a good result is)
- Audience and purpose (for whom, for what)
- Constraints (length, tone, things not to do)
- Definition of done (when it is finished)

Attach **a short quote of the turn each gap is based on**. If you cannot quote one, drop the gap.

### 3. Look up the record
Sort each gap with the lookup rules of `hack-user-skills-criteria-gap:criteria`.
- A confirmed criterion exists: do not ask. It is to be applied in step 8.
- Draft, AI-inferred, or past its review date: recheck it in one line.
- The new request conflicts with a saved criterion: ask "Change the criterion, or make an exception this time?". Do not quietly follow either.
- None: a question to ask.

### 4. Pick what to ask
Of the questions to ask, pick only **the 2–3 with the most impact**. Criteria that later steps depend on come first (source selection before planning quality).
Name the rest only: "there are N more".

### 5. Ask one at a time
- **Do not show the AI's answer or implicit criterion first.** Let the user write their own criterion first, to avoid anchoring.
- Ask concretely. Example: "For this magazine, from what level does a parent's statement count as 'fact'? You can say 'I don't know'."
- **An answer that is not a criterion counts as "I don't know".** A question back, hesitation, an explanation of plans, "not sure" are not criteria. Do not record them as the user's criterion.
- **On "I don't know", show candidates.** Give 2–3 candidates (each with a short example) and let the user pick or rewrite one. Candidates are the AI's wording, so do not save one right after it is picked. Ask "Is this your criterion?" as in check 2 of the checks before saving, and ask about confirming separately as in check 6.
- **A criterion the user wrote themselves** is recorded in their wording, through the checks before saving.

### 6. Compare and redo (look back)
Compare the user's criterion with the **AI's implicit criterion** from step 2. Compare criteria, not results.
- If they really differ, say where in one or two lines, and write a **redo prompt** that puts the user's criterion in as explicit input. Run it only after the user agrees.
- Skip small differences.

### 7. Report the gaps left
If step 4 left gaps for later, list their names after the work. If the user wants, ask about them the same way.

### 8. Apply criteria
Include confirmed criteria in later requests, and state them in one line at the top of the answer.
`Applied criteria: sources are primary sources from 2025 on only`

## What not to do
- Do not decide criteria for the user. Candidates and temporary criteria are proposals only; the user saves and confirms.
- Do not take a short "yes" or "save it" as confirming a criterion.
- Do not make a gap without a quote to back it.
- Do not ask several criteria at once.
- Do not save temporary criteria or treat them as confirmed.
- Do not save what the AI added without asking the user.
