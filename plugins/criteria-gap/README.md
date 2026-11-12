# hack-user-skills-criteria-gap

A Claude Code plugin: when you hand Claude work that needs judgement (pick, filter, plan, write for someone) without saying how to judge it, Claude asks for that one criterion first, does the work with it, and remembers your answer so it never asks again.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

Open a new session after installing. The hook needs `python3`; without it the hook stays silent and you can still ask for a check by hand.

## How it works

1. You hand over work: "Pick 5 reviews for the home page."
2. Claude asks the one criterion it would otherwise make up: "What should a home page review make visitors do?" You answer in your own words, or say "I don't know" for 2–3 options, or "go ahead for now".
3. Claude does the work with your answer, then asks once: "Next time, do it this way?" with the exact wording it would keep. Say yes and it is remembered.
4. Next time, Claude follows it without asking and says so on the first line ("Applied criteria: …").

It is on in every project once installed, steps in only on requests that hand over work, at most 3 times per session, and never blocks your input.

You can also say:
- "Show my criteria", "change this criterion", "forget this criterion"
- "Look back on this session": finds where work was handed over without a criterion, asks for yours, and offers to redo the work if it differs
- "Don't ask about criteria here": turns it off in this project (`{"hook": false}` in `.hus-criteria-gap/config.json`). "Ask about criteria here again" turns it back on.

## What is in it

| Path | Contents |
|---|---|
| `skills/criteria-gap/` | The skill: how to ask, remember, show, change and look back. The record format is in `references/format.md`; `scripts/criteria_index.py` rebuilds and checks `INDEX.md` |
| `hooks/` | The `UserPromptSubmit` hook (`criteria_hook.py`, started by `criteria-hook.sh`), the request words it looks for (`patterns*.json`), and its tests |

Run the tests from this folder: `(cd hooks && python3 -m unittest test_criteria_hook)` and `(cd skills/criteria-gap/scripts && python3 -m unittest test_criteria_index)`.

## What it creates

| Where | What | Remove |
|---|---|---|
| `.hus-criteria-gap/` in your project | One file per remembered criterion, `INDEX.md` (made from them), and `config.json` only if you turned it off here. Created when the first criterion is saved. Commit it to share criteria with your team, or add it to `.gitignore` | Delete the folder |
| `~/.hus-criteria-gap/` | Criteria you said are for every project, in the same layout | Delete the folder |
| `sessions/` in the plugin's data folder (`${CLAUDE_PLUGIN_DATA}`, under `~/.claude/plugins/data/`) | Per-session counters for the 3-per-session limit. Files older than 7 days are removed | Removed with the plugin |
| `$TMPDIR/hus-criteria-gap-hook/` | The same counters, only when the hook runs outside an installed plugin | Delete the folder |

### Coming from 0.5 or earlier

- The hook is now on by default. The old `{"hook": {"enabled": false}}` still turns it off; intensity and limits are fixed (light, 3 per session).
- The `criteria` and `criteria-init` skills are now part of `criteria-gap`; just say what you want.
- The question card and `/criteria-check` are gone. If you used them, delete `~/.hus-criteria-gap/judge-log/`; a `"card"` key in `config.json` is ignored.
- Saved criteria are read as before. A criterion left as a draft is asked about again before it is used.

### Coming from hack-users-for-llms

That plugin keeps criteria in `.criteria/` and `~/.criteria/`, which this one does not read. To bring them along: `mv ~/.criteria ~/.hus-criteria-gap`, and `mv .criteria .hus-criteria-gap` in each project. Keep only one of the two plugins enabled.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

판단이 필요한 일(고르기, 거르기, 계획, 누군가를 위한 글)을 기준 없이 맡기면 Claude가 그 기준 하나를 먼저 묻고, 그 답으로 일하고, 답을 기억해 다시 묻지 않게 하는 Claude Code 플러그인입니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

설치한 뒤 새 세션을 엽니다. 훅에는 `python3`가 필요합니다. 없으면 훅은 아무것도 하지 않고, 점검은 직접 부탁하면 됩니다.

## 동작

1. 일을 맡깁니다: "홈페이지 첫 화면에 올릴 후기 5개 골라줘."
2. Claude가 원래라면 혼자 정했을 기준 하나를 묻습니다: "첫 화면 후기를 읽은 사람이 무엇을 하길 바라세요?" 내 말로 답하거나, "모르겠어"라고 하면 후보 2~3개를 받고, "일단 진행"이라고 해도 됩니다.
3. Claude가 그 답으로 일한 뒤, 기억할 문구를 그대로 보여 주며 한 번만 묻습니다: "다음에도 이렇게 할까요?" "응"이라고 하면 기억합니다.
4. 다음부터는 묻지 않고 그 기준대로 하고, 답 첫 줄에 어떤 기준을 따랐는지 밝힙니다.

설치하면 모든 프로젝트에서 켜집니다. 일을 맡기는 요청에만, 세션당 최대 3번 나서고, 입력을 막지 않습니다.

이렇게도 말할 수 있습니다.
- "기준 보여줘", "이 기준 바꿔줘", "이 기준 잊어줘"
- "이 세션 되짚어줘": 기준 없이 맡긴 곳을 찾아 내 기준을 묻고, AI가 쓴 기준과 다르면 다시 하자고 제안합니다
- "여기선 기준 묻지 마": 이 프로젝트에서 끕니다(`.hus-criteria-gap/config.json`에 `{"hook": false}`). "여기서 다시 기준 물어봐"라고 하면 다시 켜집니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/criteria-gap/` | 스킬: 묻기, 기억하기, 보여 주기, 바꾸기, 되짚기. 기록 형식은 `references/format.md`, `INDEX.md`를 다시 만들고 검사하는 건 `scripts/criteria_index.py` |
| `hooks/` | `UserPromptSubmit` 훅(`criteria_hook.py`, `criteria-hook.sh`가 실행), 훅이 찾는 요청 표현(`patterns*.json`), 테스트 |

테스트 실행(이 폴더에서): `(cd hooks && python3 -m unittest test_criteria_hook)`, `(cd skills/criteria-gap/scripts && python3 -m unittest test_criteria_index)`

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| 프로젝트의 `.hus-criteria-gap/` | 기억한 기준마다 파일 하나, `INDEX.md`(기준 파일에서 만듦), 이 프로젝트에서 껐을 때만 `config.json`. 첫 기준을 저장할 때 생깁니다. 팀과 기준을 나누려면 커밋하고, 개인 기준이면 `.gitignore`에 넣으세요 | 폴더를 지웁니다 |
| `~/.hus-criteria-gap/` | 모든 프로젝트에 쓰겠다고 한 기준. 구조는 같습니다 | 폴더를 지웁니다 |
| 플러그인 데이터 폴더(`${CLAUDE_PLUGIN_DATA}`, `~/.claude/plugins/data/` 아래)의 `sessions/` | 세션당 3번 한도를 세는 기록. 7일 지난 파일은 지워집니다 | 플러그인을 지우면 함께 지워집니다 |
| `$TMPDIR/hus-criteria-gap-hook/` | 같은 기록. 설치한 플러그인 밖에서 훅을 돌릴 때만 생깁니다 | 폴더를 지웁니다 |

### 0.5 이하에서 올라올 때

- 훅이 이제 기본으로 켜져 있습니다. 예전의 `{"hook": {"enabled": false}}`도 그대로 끕니다. 강도와 한도는 고정입니다(light, 세션당 3번).
- `criteria`와 `criteria-init` 스킬은 `criteria-gap`으로 합쳤습니다. 하고 싶은 것을 말로 하면 됩니다.
- 질문 카드와 `/criteria-check`는 없어졌습니다. 썼다면 `~/.hus-criteria-gap/judge-log/`를 지우세요. `config.json`의 `"card"` 키는 무시됩니다.
- 저장한 기준은 그대로 읽습니다. 초안으로 남은 기준은 쓰기 전에 다시 묻습니다.

### hack-users-for-llms에서 옮길 때

그 플러그인은 기준을 `.criteria/`와 `~/.criteria/`에 두고, 이 플러그인은 그 폴더를 읽지 않습니다. 가져오려면 `mv ~/.criteria ~/.hus-criteria-gap`, 프로젝트마다 `mv .criteria .hus-criteria-gap`을 실행합니다. 두 플러그인 중 하나만 켜 두세요.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
