# hack-user-skills-criteria-gap

A plugin of skills and an opt-in hook that find the **judgement criteria that are missing** when you hand work to an AI. It keeps the criteria you agree on in files, and when you hand over work without them, it has the AI ask before starting. The skills work in Claude Code and Codex; the hook runs in Claude Code only.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

The hook needs `python3`; without it the hook stays silent and the skills still work. The `hack-user-skills` marketplace holds other plugins too; only the ones you install run. Open a new session after installing.

## Use

- **Record criteria:** say "show my criteria", "save this criterion", or run `/hack-user-skills-criteria-gap:criteria`. Criteria are saved in `.hus-criteria-gap/` in your project, or in `~/.hus-criteria-gap/` for ones you use everywhere. A criterion becomes confirmed only after you say so.
- **Find missing criteria:** say "check for missing criteria", "look back on this session", or "check before I delegate", or run `/hack-user-skills-criteria-gap:criteria-gap`. It asks one criterion at a time and lets you say "go ahead for now".
- **Turn on the hook:** say "criteria init" or "turn on the criteria check", or run `/hack-user-skills-criteria-gap:criteria-init`. It asks for the scope (this project or everywhere) and the intensity (`light` or `active`). Turn it off the same way.

The hook is **off by default** and prints nothing where it is not turned on. When it is on, it looks only at requests that hand over work, tells Claude about your confirmed criteria, and has Claude ask before the work when none apply. It steps in at most a few times per session, with a cooldown, and it never blocks your input. It knows English and Korean request words (`hooks/patterns.json`, `hooks/patterns.ko.json`).

## What is in it

| Path | Contents |
|---|---|
| `skills/criteria/` | Records, looks up, and changes criteria. The file format is in `references/format.md` |
| `skills/criteria-gap/` | Finds where work was handed over without criteria, asks for them, and compares them with the criteria the AI used |
| `skills/criteria-init/` | Turns the hook on and off, sets its intensity and limits, and shows its status |
| `hooks/` | The `UserPromptSubmit` hook, the request words it looks for, and its tests |

Run the tests from this folder (`plugins/criteria-gap/`): `(cd hooks && python3 -m unittest -v test_criteria_hook)`

## What it creates

| Where | What | Remove |
|---|---|---|
| `.hus-criteria-gap/` in your project | Criteria files, `INDEX.md`, and `config.json` (hook settings). Add it to `.gitignore` if your criteria are personal | Delete the folder |
| `~/.hus-criteria-gap/` | Global criteria and the global `config.json`, in the same layout | Delete the folder |
| `sessions/` in the plugin's data folder (`${CLAUDE_PLUGIN_DATA}`, under `~/.claude/plugins/data/`) | Per-session counters for the hook's limits. Files older than 7 days are removed | Removed with the plugin |
| `$TMPDIR/hus-criteria-gap-hook/` | The same counters, only when the hook runs outside an installed plugin | Delete the folder |

### Moving from hack-users-for-llms

These skills came from the `hack-users-for-llms` plugin, which keeps its criteria in `.criteria/` and `~/.criteria/`. This plugin does not read those folders. To bring your criteria along, move them:

```
mv ~/.criteria ~/.hus-criteria-gap
mv .criteria .hus-criteria-gap    # in each project that has one
```

`hack-users-for-llms` keeps using the old folders, so after moving, its own criteria skills and hook no longer see them. If both plugins are installed, both offer criteria skills that answer to the same requests; keep one of them enabled. The question card that `hack-users-for-llms` shows above the input box is not part of this plugin.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

AI에게 일을 맡길 때 **비어 있는 판단 기준**을 찾아 묻는 스킬과 훅(켜야 동작)을 담은 플러그인입니다. 합의한 기준을 파일로 남기고, 기준 없이 일을 맡기면 AI가 일을 시작하기 전에 묻게 합니다. 스킬은 Claude Code와 Codex에서 쓰고, 훅은 Claude Code에서만 동작합니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-criteria-gap@hack-user-skills
```

훅에는 `python3`가 필요합니다. 없으면 훅은 아무것도 하지 않고 스킬은 그대로 쓸 수 있습니다. `hack-user-skills` 마켓플레이스에는 다른 플러그인도 있지만, 설치한 것만 동작합니다. 설치한 뒤 새 세션을 엽니다.

## 쓰는 법

- **기준 기록:** "기준 보여줘", "이 기준 저장해"라고 하거나 `/hack-user-skills-criteria-gap:criteria`를 부릅니다. 기준은 프로젝트의 `.hus-criteria-gap/`에, 어디서나 쓰는 기준은 `~/.hus-criteria-gap/`에 저장됩니다. 사용자가 확정해야만 확정 기준이 됩니다.
- **빈 기준 찾기:** "기준 비어 있는지 봐줘", "이 세션 되짚어줘", "위임 전에 점검해줘"라고 하거나 `/hack-user-skills-criteria-gap:criteria-gap`을 부릅니다. 기준을 한 번에 하나씩 묻고, "일단 진행"도 고를 수 있습니다.
- **훅 켜기:** "criteria init", "기준 점검 켜줘"라고 하거나 `/hack-user-skills-criteria-gap:criteria-init`을 부릅니다. 범위(이 프로젝트 또는 전역)와 강도(`light` 또는 `active`)를 묻습니다. 끌 때도 같은 방법으로 말합니다.

훅은 **기본이 꺼져 있고**, 켜지 않은 곳에서는 아무것도 출력하지 않습니다. 켜 두면 일을 맡기는 요청만 보고, 확정 기준을 Claude에게 알려 주고, 맞는 기준이 없으면 작업 전에 묻게 합니다. 세션마다 개입 횟수 제한과 쿨다운이 있고, 입력을 막는 일은 없습니다. 영어와 한국어 요청 표현을 알아봅니다(`hooks/patterns.json`, `hooks/patterns.ko.json`).

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/criteria/` | 기준을 기록하고 조회·변경합니다. 파일 형식은 `references/format.md` |
| `skills/criteria-gap/` | 기준 없이 맡긴 곳을 찾아 묻고, AI가 쓴 기준과 비교합니다 |
| `skills/criteria-init/` | 훅을 켜고 끄고, 강도와 한도를 정하고, 상태를 보여 줍니다 |
| `hooks/` | `UserPromptSubmit` 훅, 훅이 찾는 요청 표현, 테스트 |

테스트 실행(이 폴더 `plugins/criteria-gap/`에서): `(cd hooks && python3 -m unittest -v test_criteria_hook)`

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| 프로젝트의 `.hus-criteria-gap/` | 기준 파일, `INDEX.md`, `config.json`(훅 설정). 개인 기준이면 `.gitignore`에 넣어 두세요 | 폴더를 지웁니다 |
| `~/.hus-criteria-gap/` | 전역 기준과 전역 `config.json`. 구조는 같습니다 | 폴더를 지웁니다 |
| 플러그인 데이터 폴더(`${CLAUDE_PLUGIN_DATA}`, `~/.claude/plugins/data/` 아래)의 `sessions/` | 훅의 개입 한도를 세는 세션별 기록. 7일 지난 파일은 지워집니다 | 플러그인을 지우면 함께 지워집니다 |
| `$TMPDIR/hus-criteria-gap-hook/` | 같은 기록. 설치한 플러그인 밖에서 훅을 돌릴 때만 생깁니다 | 폴더를 지웁니다 |

### hack-users-for-llms에서 옮기기

이 스킬들은 `hack-users-for-llms` 플러그인에서 나왔습니다. 그 플러그인은 기준을 `.criteria/`와 `~/.criteria/`에 둡니다. 이 플러그인은 그 폴더를 읽지 않습니다. 기준을 가져오려면 옮깁니다.

```
mv ~/.criteria ~/.hus-criteria-gap
mv .criteria .hus-criteria-gap    # 폴더가 있는 프로젝트마다
```

`hack-users-for-llms`는 계속 옛 폴더를 쓰므로, 옮긴 뒤에는 그 플러그인의 기준 스킬과 훅이 기준을 보지 못합니다. 두 플러그인을 함께 설치하면 같은 요청에 두 쪽의 기준 스킬이 다 나서므로 하나만 켜 두세요. `hack-users-for-llms`가 입력창 위에 띄우는 질문 카드는 이 플러그인에 들어 있지 않습니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
