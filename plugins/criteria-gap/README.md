# hack-user-skills-criteria-gap

A plugin of skills, an opt-in hook and an opt-in question card that find the **judgement criteria that are missing** when you hand work to an AI. It keeps the criteria you agree on in files, and when you hand over work without them, it has the AI ask before starting, or asks you itself after the turn. The skills work in Claude Code and Codex; the hook and the question card run in Claude Code only.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

The hook needs `python3`; without it the hook stays silent and the skills and the question card still work. The `hack-user-skills` marketplace holds other plugins too; only the ones you install run. Open a new session after installing.

## Use

- **Record criteria:** say "show my criteria", "save this criterion", or run `/hack-user-skills-criteria-gap:criteria`. Criteria are saved in `.hus-criteria-gap/` in your project, or in `~/.hus-criteria-gap/` for ones you use everywhere. A criterion becomes confirmed only after you say so.
- **Find missing criteria:** say "check for missing criteria", "look back on this session", or "check before I delegate", or run `/hack-user-skills-criteria-gap:criteria-gap`. It asks one criterion at a time and lets you say "go ahead for now".
- **Turn on the hook:** say "criteria init" or "turn on the criteria check", or run `/hack-user-skills-criteria-gap:criteria-init`. It asks for the scope (this project or everywhere) and the intensity (`light` or `active`). Turn it off the same way.
- **Turn on the question card:** say "turn on the question card", or run `/hack-user-skills-criteria-gap:criteria-init` and pick the card. It asks for the scope the same way. Turn it off the same way.

The hook is **off by default** and prints nothing where it is not turned on. When it is on, it looks only at requests that hand over work, tells Claude about your confirmed criteria, and has Claude ask before the work when none apply. It steps in at most a few times per session, with a cooldown, and it never blocks your input. It knows English and Korean request words (`hooks/patterns.json`, `hooks/patterns.ko.json`).

The question card is **off by default** too; with it off, it calls no model and shows nothing. When it is on, after each turn a judge model looks at your message and Claude's answer for one gap in your thinking: an omitted premise, two things mixed under one word, a principle worth checking, or a missing criterion. When it finds one worth asking, a card above the prompt shows one question, with options where they fit, a field for your own answer, "Don't know" and "Skip". Your answer goes back to Claude as a message, and Claude carries on with it. A question you leave alone goes away after 3 turns. `/criteria-check` checks the last turn right away, past the cooldown. The card uses the same limits as the hook (`intensity`, `max_per_session`, `cooldown_turns`; by default `light`, 3 per session, 3 turns apart). **Cost:** one Sonnet call on each turn where it may ask, none during the cooldown or past the session cap. Its buttons and labels are in English or Korean: set `lang` in `config.json`, or it follows the script you write in.

## What is in it

| Path | Contents |
|---|---|
| `skills/criteria/` | Records, looks up, and changes criteria. The file format is in `references/format.md` |
| `skills/criteria-gap/` | Finds where work was handed over without criteria, asks for them, and compares them with the criteria the AI used; handles answers from the question card |
| `skills/criteria-init/` | Turns the hook and the question card on and off, sets their intensity and limits, and shows their status |
| `hooks/criteria_hook.py`, `hooks/criteria-hook.sh` | The `UserPromptSubmit` hook, with the request words it looks for (`patterns*.json`) and its tests |
| `hooks/criteria-card.tsx` | The question card (a Claude Code hooks module) and the `/criteria-check` command |
| `hooks/locales/` | The card's screen text in English (`en.json`) and Korean (`ko.json`) |
| `types/`, `tests/` | The card's state type and its tests |

Run the tests from this folder (`plugins/criteria-gap/`): `(cd hooks && python3 -m unittest -v test_criteria_hook test_locales)` and `claude plugin test .`

## What it creates

| Where | What | Remove |
|---|---|---|
| `.hus-criteria-gap/` in your project | Criteria files, `INDEX.md`, and `config.json` (the `hook` settings, and `card: true` for the question card). Add it to `.gitignore` if your criteria are personal | Delete the folder |
| `~/.hus-criteria-gap/` | Global criteria and the global `config.json`, in the same layout | Delete the folder |
| `~/.hus-criteria-gap/judge-log/<project>/<session id>.jsonl` | While the question card is on, one line per judgement and per answer or skip: the question asked, tokens used, why a judgement failed. Parts of the conversation can show up in the question text. Kept on this computer only, never removed automatically, and left behind when the plugin is removed | Delete the `judge-log/` folder |
| `sessions/` in the plugin's data folder (`${CLAUDE_PLUGIN_DATA}`, under `~/.claude/plugins/data/`) | Per-session counters for the hook's limits. Files older than 7 days are removed | Removed with the plugin |
| `$TMPDIR/hus-criteria-gap-hook/` | The same counters, only when the hook runs outside an installed plugin | Delete the folder |

### Moving from hack-users-for-llms

These skills and the question card came from the `hack-users-for-llms` plugin, which keeps its criteria in `.criteria/` and `~/.criteria/`. This plugin does not read those folders. To bring your criteria along, move them:

```
mv ~/.criteria ~/.hus-criteria-gap
mv .criteria .hus-criteria-gap    # in each project that has one
```

`hack-users-for-llms` keeps using the old folders, so after moving, its own criteria skills and hook no longer see them. If both plugins are installed, both offer criteria skills that answer to the same requests; keep one of them enabled.

`/hack-mode` is gone: there is no mode picker here. Turn the question card on with `criteria-init` ("turn on the question card"). Old judge logs stay in `~/.hack-mode/`; new ones go to `~/.hus-criteria-gap/judge-log/`.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

AI에게 일을 맡길 때 **비어 있는 판단 기준**을 찾아 묻는 스킬, 훅(켜야 동작), 질문 카드(켜야 동작)를 담은 플러그인입니다. 합의한 기준을 파일로 남기고, 기준 없이 일을 맡기면 AI가 일을 시작하기 전에 묻게 하거나, 턴이 끝난 뒤 직접 묻습니다. 스킬은 Claude Code와 Codex에서 쓰고, 훅과 질문 카드는 Claude Code에서만 동작합니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

훅에는 `python3`가 필요합니다. 없으면 훅은 아무것도 하지 않고 스킬과 질문 카드는 그대로 쓸 수 있습니다. `hack-user-skills` 마켓플레이스에는 다른 플러그인도 있지만, 설치한 것만 동작합니다. 설치한 뒤 새 세션을 엽니다.

## 쓰는 법

- **기준 기록:** "기준 보여줘", "이 기준 저장해"라고 하거나 `/hack-user-skills-criteria-gap:criteria`를 부릅니다. 기준은 프로젝트의 `.hus-criteria-gap/`에, 어디서나 쓰는 기준은 `~/.hus-criteria-gap/`에 저장됩니다. 사용자가 확정해야만 확정 기준이 됩니다.
- **빈 기준 찾기:** "기준 비어 있는지 봐줘", "이 세션 되짚어줘", "위임 전에 점검해줘"라고 하거나 `/hack-user-skills-criteria-gap:criteria-gap`을 부릅니다. 기준을 한 번에 하나씩 묻고, "일단 진행"도 고를 수 있습니다.
- **훅 켜기:** "criteria init", "기준 점검 켜줘"라고 하거나 `/hack-user-skills-criteria-gap:criteria-init`을 부릅니다. 범위(이 프로젝트 또는 전역)와 강도(`light` 또는 `active`)를 묻습니다. 끌 때도 같은 방법으로 말합니다.
- **질문 카드 켜기:** "질문 카드 켜줘"라고 하거나 `/hack-user-skills-criteria-gap:criteria-init`을 불러 카드를 고릅니다. 범위도 같은 방식으로 묻습니다. 끌 때도 같은 방법으로 말합니다.

훅은 **기본이 꺼져 있고**, 켜지 않은 곳에서는 아무것도 출력하지 않습니다. 켜 두면 일을 맡기는 요청만 보고, 확정 기준을 Claude에게 알려 주고, 맞는 기준이 없으면 작업 전에 묻게 합니다. 세션마다 개입 횟수 제한과 쿨다운이 있고, 입력을 막는 일은 없습니다. 영어와 한국어 요청 표현을 알아봅니다(`hooks/patterns.json`, `hooks/patterns.ko.json`).

질문 카드도 **기본이 꺼져 있고**, 꺼져 있으면 모델을 부르지 않고 아무것도 띄우지 않습니다. 켜 두면 턴마다 판정 모델이 내 메시지와 Claude의 답을 보고 내 생각의 빈 곳 하나를 찾습니다. 생략된 전제, 한 말에 섞인 두 가지, 확인해 볼 만한 원리, 빠진 판단 기준입니다. 물을 만한 것이 있으면 입력창 위 카드에 질문 하나를 띄웁니다. 맞으면 보기가 있고, 직접 답하는 칸, "모름", "건너뛰기"가 있습니다. 답은 메시지로 Claude에게 가고, Claude가 그 답을 받아 이어 갑니다. 답하지 않은 질문은 3턴이 지나면 내려갑니다. `/criteria-check`는 쿨다운과 상관없이 마지막 턴을 바로 점검합니다. 카드는 훅과 같은 한도(`intensity`, `max_per_session`, `cooldown_turns`, 기본값은 `light`, 세션당 3번, 3턴 간격)를 씁니다. **비용:** 물을 수 있는 턴마다 Sonnet을 한 번 부릅니다. 쿨다운 중이거나 세션 한도를 넘으면 부르지 않습니다. 버튼과 라벨은 영어나 한국어로 나옵니다. `config.json`에 `lang`을 정하거나, 정하지 않으면 내가 쓰는 글자를 따릅니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/criteria/` | 기준을 기록하고 조회·변경합니다. 파일 형식은 `references/format.md` |
| `skills/criteria-gap/` | 기준 없이 맡긴 곳을 찾아 묻고, AI가 쓴 기준과 비교합니다. 질문 카드의 답도 다룹니다 |
| `skills/criteria-init/` | 훅과 질문 카드를 켜고 끄고, 강도와 한도를 정하고, 상태를 보여 줍니다 |
| `hooks/criteria_hook.py`, `hooks/criteria-hook.sh` | `UserPromptSubmit` 훅, 훅이 찾는 요청 표현(`patterns*.json`), 테스트 |
| `hooks/criteria-card.tsx` | 질문 카드(Claude Code hooks module)와 `/criteria-check` 명령 |
| `hooks/locales/` | 카드 화면 글자. 영어(`en.json`)와 한국어(`ko.json`) |
| `types/`, `tests/` | 카드 상태 타입과 테스트 |

테스트 실행(이 폴더 `plugins/criteria-gap/`에서): `(cd hooks && python3 -m unittest -v test_criteria_hook test_locales)`, `claude plugin test .`

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| 프로젝트의 `.hus-criteria-gap/` | 기준 파일, `INDEX.md`, `config.json`(`hook` 설정과 질문 카드를 켜는 `card: true`). 개인 기준이면 `.gitignore`에 넣어 두세요 | 폴더를 지웁니다 |
| `~/.hus-criteria-gap/` | 전역 기준과 전역 `config.json`. 구조는 같습니다 | 폴더를 지웁니다 |
| `~/.hus-criteria-gap/judge-log/<프로젝트>/<세션 id>.jsonl` | 질문 카드를 켠 동안 판정, 답, 건너뛰기마다 한 줄씩 남깁니다. 띄운 질문, 쓴 토큰, 판정 실패 이유가 들어갑니다. 대화 일부가 질문 문장에 섞일 수 있습니다. 이 컴퓨터에만 저장하고 자동으로 지우지 않으며, 플러그인을 지워도 남습니다 | `judge-log/` 폴더를 지웁니다 |
| 플러그인 데이터 폴더(`${CLAUDE_PLUGIN_DATA}`, `~/.claude/plugins/data/` 아래)의 `sessions/` | 훅의 개입 한도를 세는 세션별 기록. 7일 지난 파일은 지워집니다 | 플러그인을 지우면 함께 지워집니다 |
| `$TMPDIR/hus-criteria-gap-hook/` | 같은 기록. 설치한 플러그인 밖에서 훅을 돌릴 때만 생깁니다 | 폴더를 지웁니다 |

### hack-users-for-llms에서 옮기기

이 스킬들과 질문 카드는 `hack-users-for-llms` 플러그인에서 나왔습니다. 그 플러그인은 기준을 `.criteria/`와 `~/.criteria/`에 둡니다. 이 플러그인은 그 폴더를 읽지 않습니다. 기준을 가져오려면 옮깁니다.

```
mv ~/.criteria ~/.hus-criteria-gap
mv .criteria .hus-criteria-gap    # 폴더가 있는 프로젝트마다
```

`hack-users-for-llms`는 계속 옛 폴더를 쓰므로, 옮긴 뒤에는 그 플러그인의 기준 스킬과 훅이 기준을 보지 못합니다. 두 플러그인을 함께 설치하면 같은 요청에 두 쪽의 기준 스킬이 다 나서므로 하나만 켜 두세요.

`/hack-mode`는 없어졌습니다. 여기에는 모드 고르기가 없습니다. 질문 카드는 `criteria-init`으로 켭니다("질문 카드 켜줘"). 예전 판정 기록은 `~/.hack-mode/`에 그대로 있고, 새 기록은 `~/.hus-criteria-gap/judge-log/`에 쌓입니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
