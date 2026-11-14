# hack-user-skills-criteria-gap

A Claude Code plugin for one habit: moving on from an AI's answer without having really read or understood it. You skim, feel you understood, and say "ok, go on", while a premise you never stated, a point you skipped or a premise you took differently stays in place, and the work piles up on it. When that happens and it matters, a card above the prompt asks you one question that makes you fill the gap in your own words.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

Open a new session after installing. It runs in Claude Code only.

**Check that it works:** type `/criteria-check`. If the command is there, the card is running (your first prompt also shows a one-line "question card is on" note). If it says unknown command, update Claude Code (`claude update`, or update the VS Code extension or desktop app), make sure the plugin is enabled in `/plugin`, and open a new session. Nothing else needs installing: no Node.js, no Python. If the card stays quiet, say "the question card never shows up" and Claude checks the usual causes with you.

## How it works

1. After each turn, a judge model reads Claude's previous answer, your message after it, and Claude's new answer.
2. If you moved on from something that changes the result, the card shows one question above the prompt. It points at the words it rests on (yours or Claude's) and asks you to choose or say it in one line. It never asks "did you understand?", because the feeling of understanding is what goes wrong.
   - **A point you moved on from:** Claude said "for regulars A, for new customers B" and you said "go with A" without saying who it is for.
   - **A premise you did not state:** the plan rests on "40 a day", and you never said where 40 comes from.
   - **A premise you may have taken differently:** the answer counted weekends, and your next step is about weekdays.
   - **Two things under one word:** "booking" as an order the day before, or as a time slot.
   - **Understanding check:** a one-line "why" about what you just accepted.
3. Answer with an option, in your own words, "I don't know", or skip. Your answer goes to Claude, which says whether it differs from what it assumed and offers to redo what it changes.
4. Each question, your answer and what came of it are written to a text log you can look back on.

**How often:** 3 questions per 30 turns to start. An answer that shows a real gap allows one more; one that shows you had it right, or a skipped question, allows one fewer. Questions are at least 2 turns apart, one at a time, and a question left alone goes away after 3 turns. Every 30 turns it starts again at 3.

**Cost:** one Sonnet call on each turn it judges (a turn with an answer worth reading, while questions are left in the block), and one small call after each answered question. None when the block's questions are used up.

You can say:
- "Ask fewer questions" or "ask more often": one step down or up
- "Turn off the question card" (in this project), "turn the question card back on"
- "What do I often miss": groups your log by kind, with examples
- "Show my question log", "delete my question log"
- `/criteria-check`: checks the last turn now

## What is in it

| Path | Contents |
|---|---|
| `hooks/criteria-card.tsx` | The question card (a Claude Code hooks module) and `/criteria-check` |
| `hooks/locales/` | The card's text in English (`en.json`) and Korean (`ko.json`) |
| `skills/criteria-gap/` | How Claude handles your answers, and the requests above |
| `types/`, `tests/` | The card's state type and its tests |

For development, run the tests from this folder: `claude plugin test .` and `(cd hooks && python3 -m unittest test_locales)`.

## What it creates

| Where | What | Remove |
|---|---|---|
| `~/.hus-criteria-gap/log/<project>/<date>.md` | One entry per question: the words it pointed at, the question, your answer, what came of it. Parts of your conversations are in it. Kept on this computer only, outside your projects; not removed automatically or with the plugin | "Delete my question log", or delete the folder |
| `.hus-criteria-gap/config.json` in a project, or `~/.hus-criteria-gap/config.json` | Only when you turned the card off (`"card": false`) or changed how often it asks (`"pace"`) | Delete the file |

### Coming from 0.6 or earlier

- The plugin now does one thing: the question card, on by default. The hook that asked for criteria before delegating, and the criteria record, are gone. Criterion files in `.hus-criteria-gap/` are no longer read; keep or delete them.
- The card looks at your previous turn too, and asks about points you skipped and premises you took differently.
- The old judge log in `~/.hus-criteria-gap/judge-log/` is no longer written; delete it. The new log is readable text in `~/.hus-criteria-gap/log/`.
- Old settings in `config.json` (`hook`, `lang`) are ignored; `"card": false` still turns it off.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

AI의 답을 제대로 읽거나 이해하지 않은 채 넘어가는 습관 하나를 다루는 Claude Code 플러그인입니다. 답을 훑어보고, 이해했다고 느끼고, "좋아, 진행해"라고 하는 사이에 말하지 않은 전제나 건너뛴 부분, 다르게 받아들인 전제가 그대로 남고 그 위에 일이 쌓입니다. 그런 일이 생기고 그것이 결과를 바꿀 때, 입력창 위 카드가 그 공백을 내 말로 메우게 하는 질문 하나를 띄웁니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

설치한 뒤 새 세션을 엽니다. Claude Code에서만 동작합니다.

**잘 돌아가는지 확인:** `/criteria-check`를 입력해 보세요. 명령이 있으면 카드가 돌아가는 중입니다(첫 메시지를 보낼 때 "질문 카드가 켜져 있어요"라는 한 줄 안내도 한 번 뜹니다). "알 수 없는 명령"이 나오면 Claude Code를 업데이트하고(`claude update`, VS Code 확장이나 데스크톱 앱은 앱 업데이트), `/plugin`에서 플러그인이 켜져 있는지 확인한 뒤 새 세션을 여세요. 따로 설치할 것은 없습니다: Node.js도 Python도 필요 없습니다. 카드가 조용하면 "질문 카드가 안 떠"라고 말하세요. Claude가 흔한 원인을 같이 확인합니다.

## 동작

1. 턴이 끝날 때마다 판정 모델이 Claude의 직전 답, 그 뒤의 내 메시지, Claude의 새 답을 읽습니다.
2. 결과를 바꿀 무언가를 그냥 넘겼다면, 입력창 위에 질문 하나가 뜹니다. 근거가 된 말(내 말 또는 Claude의 답)을 짚고, 고르거나 한 줄로 말하게 합니다. "이해했나요?"는 묻지 않습니다. 잘못되는 것이 바로 그 이해했다는 느낌이기 때문입니다.
   - **앞 답에서 건너뛴 부분:** Claude가 "단골이면 A, 신규 손님이면 B"라고 했는데, 대상을 정하지 않고 "A로 해줘"라고 함
   - **말하지 않은 전제:** 계획이 "하루 40건"에 기대는데, 40이 어디서 나왔는지 말한 적 없음
   - **다르게 받아들였을 수 있는 전제:** 답은 주말을 넣어 셌는데, 다음 요청은 평일 이야기
   - **한 단어에 섞인 두 가지:** "예약"이 전날 주문인지, 시간 예약인지
   - **이해 확인:** 방금 받아들인 것에 대해 한 줄로 "왜"를 묻기
3. 선택지를 고르거나, 직접 쓰거나, "모르겠어"를 누르거나, 건너뜁니다. 답은 Claude에게 가고, Claude는 자기가 짐작한 것과 다른지 말하고, 달라지는 부분을 다시 할지 묻습니다.
4. 질문, 내 답, 그 결과가 텍스트 기록으로 남아 나중에 돌아볼 수 있습니다.

**얼마나 자주:** 30턴마다 3개에서 시작합니다. 답이 실제 공백을 드러내면 하나 늘고, 제대로 알고 있었거나 건너뛰면 하나 줄어듭니다. 질문 사이는 최소 2턴, 한 번에 하나이고, 답하지 않은 질문은 3턴 뒤 사라집니다. 30턴마다 다시 3개로 돌아갑니다.

**비용:** 판정하는 턴마다 Sonnet 호출 한 번(읽을 만한 답이 있고, 그 블록에 질문이 남아 있을 때), 답한 질문마다 결과를 보는 작은 호출 한 번이 듭니다. 블록의 질문을 다 쓰면 호출하지 않습니다.

이렇게 말할 수 있습니다.
- "질문 줄여줘", "더 자주 물어봐": 한 단계씩 줄이거나 늘림
- "질문 카드 꺼줘"(이 프로젝트에서), "질문 카드 다시 켜줘"
- "내가 자주 놓치는 것 정리해줘": 기록을 종류별로 묶고 사례를 보여 줌
- "질문 기록 보여줘", "질문 기록 지워줘"
- `/criteria-check`: 마지막 턴을 지금 점검

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `hooks/criteria-card.tsx` | 질문 카드(Claude Code hooks module)와 `/criteria-check` |
| `hooks/locales/` | 카드 문구, 영어(`en.json`)와 한국어(`ko.json`) |
| `skills/criteria-gap/` | Claude가 내 답과 위의 요청을 다루는 방법 |
| `types/`, `tests/` | 카드 상태 타입과 테스트 |

개발용 테스트(이 폴더에서): `claude plugin test .`, `(cd hooks && python3 -m unittest test_locales)`

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| `~/.hus-criteria-gap/log/<프로젝트>/<날짜>.md` | 질문마다 한 항목: 짚은 말, 질문, 내 답, 결과. 대화 일부가 들어갑니다. 이 컴퓨터에만, 프로젝트 밖에 저장하고, 자동으로 지우지 않으며 플러그인을 지워도 남습니다 | "질문 기록 지워줘", 또는 폴더를 지웁니다 |
| 프로젝트의 `.hus-criteria-gap/config.json` 또는 `~/.hus-criteria-gap/config.json` | 카드를 껐을 때(`"card": false`)나 질문 빈도를 바꿨을 때(`"pace"`)만 생깁니다 | 파일을 지웁니다 |

### 0.6 이하에서 올라올 때

- 이제 질문 카드 하나만 하고, 기본으로 켜져 있습니다. 위임 전에 기준을 묻던 훅과 기준 기록은 없어졌습니다. `.hus-criteria-gap/`의 기준 파일은 더 읽지 않으니 두거나 지우세요.
- 카드가 직전 턴까지 보고, 건너뛴 부분과 다르게 받아들인 전제도 묻습니다.
- 예전 판정 기록(`~/.hus-criteria-gap/judge-log/`)은 더 쓰지 않으니 지우세요. 새 기록은 `~/.hus-criteria-gap/log/`에 읽을 수 있는 글로 남습니다.
- `config.json`의 예전 설정(`hook`, `lang`)은 무시합니다. `"card": false`는 그대로 끕니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
