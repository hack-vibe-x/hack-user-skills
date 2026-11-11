# What to observe

## How the person uses AI: 11 observable behaviours
Judge only whether each behaviour was seen, and only inside **the one session where the person handed over the most work that day**. Pick a session with a wide scope and three or more messages from the person. Counting across all sessions makes all 11 show on a busy day, leaving nothing to compare; counting per session takes hundreds of judgements and did not reproduce. Put the keys of the behaviours seen in `seen` in the diary's front matter; as diaries build up, compare as "M of the last N days". A behaviour not seen is not a criticism: the work may not have called for it. The list is taken from the observable behaviours of Anthropic's AI Fluency Index.

| Key | Behaviour | Counts as "seen" when |
|---|---|---|
| `iterates` | Refining | The first answer is not taken as is; follow-up requests improve the result |
| `goal` | Stating the goal first | The request says what to do and why |
| `examples` | Giving good examples | The person gives an example or reference of the level wanted |
| `format` | Setting the format | The person sets the structure or format of the result |
| `mode` | Setting how to work | The person sets how the AI works: "ask me first", "push back on me" |
| `tone` | Setting the tone | The person sets the tone or style of the text |
| `missing_context` | Pointing out missing context | The person notices a fact the AI does not know and tells it or asks about it |
| `audience` | Naming the audience | The person says who will read the result |
| `questions_reasoning` | Questioning the reasoning | The person challenges the AI's logic or asks why |
| `consults_first` | Consulting first | The person asks about the approach before it is carried out |
| `checks_facts` | Checking facts | The person runs the result or compares it with sources |

When unsure: asking about the AI's logic ("why did you do it this way?", "is this right?") is `questions_reasoning`; bringing a result the person ran or a source is `checks_facts`; telling the AI a fact it does not know is `missing_context`. A message that covers two counts as both seen.

Read with care:
- **Much is not in the record.** Thinking it over, or trying it on another screen, does not show. Responsible-use behaviours (checking before sharing, disclosing AI use) mostly happen outside the conversation and are not measured here.
- **Look especially at sessions that hand over making something.** In Anthropic's analysis, conversations that produce code or documents had more directing and fewer evaluating behaviours (pointing out context, checking facts, questioning reasoning). When a result looks finished, people may question it less.
- **Do not use their percentages as a baseline.** Those figures were observed on Claude.ai users, not on coding tools or on this person. Compare only with this person's earlier diaries. Talk about trends only once five diaries have built up.

## How the person works: what to look at
- Was there a goal and a "done" criterion at the start, and did it change on the way?
- Places where the person explained the same thing again or repeated the same request.
- Asking again about something that was in the reply just before (a sign it was not read). The material keeps the AI reply before a short question up to 800 characters. If it is cut and cannot be confirmed, do not write it.
- Did the person make the decision, or take the AI's proposal as is? "Fix it" or "implement it" sent with no discussion before counts as handing it over. "OK, implement it" after a long discussion may be a decision, so it does not count as handing over.
- With several sessions open at once, work left unfinished.
- Was a judgement worth keeping kept as a rule, document or skill?

## How to write feedback
- Attach criticism to the work and the behaviour. Talking about the person's character or ability moves attention from the work to the self and weakens the effect.
- For each point, write in plain words, as one piece: **what happened -> why it cost something -> what to do next time**. Link the original words by number only and put them in the Evidence section.
- Write good behaviour by the same standard. Knowing what was done well and why is what makes it repeatable.
- Prefer scenes where the cost actually showed (work redone, a decision reversed).

## Sources
| What was borrowed | Source | Limits |
|---|---|---|
| The 11 observable behaviours, judged seen or not | [Anthropic AI Fluency Index](https://www.anthropic.com/research/AI-fluency-index) | Measures only behaviour visible in the conversation. Correlation, not cause |
| A diary plus looking back at earlier diaries; only what appears twice or more counts as a pattern | [claude-diary](https://github.com/rlancemartin/claude-diary) (MIT) | That project changes Claude's memory; this skill changes the person's behaviour |
| Original quote for every judgement, short approvals left out of judging, masking keys | [prompt-review](https://github.com/tokoroten/prompt-review) | It has no license notice, so no code was taken, only ideas |
| Time spent putting it into writing creates learning | Di Stefano et al., [Learning by Thinking](https://papers.ssrn.com/abstract=2414478) | Effect sizes differ between sources and were not confirmed from the original. The effect is larger early in learning, after some experience |
| Feedback on the task, not the person | Kluger & DeNisi 1996, [abstract](https://pluto.huji.ac.il/~mskluger/files/Download/Kluger%20&%20%20DeNisi%20abstract.doc) | The average effect is good, but more than a third of interventions lowered performance |
| Tomorrow's plan as one "if this, then that" sentence | Gollwitzer & Sheeran 2006, implementation intentions. [2025 update](https://kops.uni-konstanz.de/handle/123456789/69905) | Effect sizes were confirmed from secondary sources only |
| Comparing how I see myself with the record | Tankelevitch et al., CHI 2024, [The Metacognitive Demands and Opportunities of Generative AI](https://arxiv.org/abs/2312.10893) | Not a study that tested this comparison; drawn from its case for self-awareness and calibrated confidence |
| Asking about the gap between what was meant and what happened | The US Army's After Action Review; the What? So what? Now what? reflection model | Widely used frameworks; the originals were not checked this time |

What earlier experiments in this project (`session-profile`, in the git history) taught:
- AI judges attach too many problems. When mismatch findings were questioned again, only 12 of 33 and 3 of 9 remained. So there is a step that questions every criticism again.
- Numeric scores hid what the person saw as their own weakness (baseline scores 78-93). So there are no scores.
- "Yes" alone does not show understanding. Of 14 short-approval scenes, understanding was confirmed in none.
