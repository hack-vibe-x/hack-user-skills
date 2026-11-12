# hack-user-skills

Skills and hooks for Claude Code by hack-vibe-x. Every plugin lives in this one repository and one marketplace. Add the marketplace once, then install only the plugins you want; a plugin you do not install does not run.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-<name>@hack-user-skills
```

Run `/plugin` to browse the list. To get new plugins and versions later: `/plugin marketplace update hack-user-skills`.

## Plugins

| Plugin | What it does |
|---|---|
| [hack-user-skills-visual-decision](plugins/visual-decision/) | Questions Claude would ask in the terminal are asked in a local web page instead, with a visual for every option and the differences side by side. Answers are kept in `.hus-visual-decision/decisions/` |
| [hack-user-skills-criteria-gap](plugins/criteria-gap/) | When you hand over work without saying how to judge it, Claude asks for that one criterion first and remembers your answer |
| [hack-user-skills-session-coach](plugins/session-coach/) | A daily diary written from yesterday's AI sessions, and a playbook of know-how pulled from sessions you pick |

Each plugin's README covers its use and what it creates on your computer.

## What is in it

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | The marketplace: one entry per plugin |
| `plugins/<name>/` | One plugin: its manifest, skills, hooks, README, LICENSE, and NOTICE |

## What it creates

| Where | What | Remove |
|---|---|---|
| Nothing | The marketplace itself creates nothing. See each plugin's README | |

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

hack-vibe-x가 만든 Claude Code 스킬과 훅입니다. 모든 플러그인이 이 저장소 하나, 마켓플레이스 하나에 들어 있습니다. 마켓플레이스를 한 번 추가하고, 원하는 플러그인만 골라 설치합니다. 설치하지 않은 플러그인은 동작하지 않습니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-<이름>@hack-user-skills
```

`/plugin`을 부르면 목록을 보고 고를 수 있습니다. 새 플러그인과 새 버전은 `/plugin marketplace update hack-user-skills`로 받습니다.

## 플러그인

| 플러그인 | 하는 일 |
|---|---|
| [hack-user-skills-visual-decision](plugins/visual-decision/) | Claude가 터미널에서 물으려던 질문을 로컬 웹 화면으로 묻습니다. 선택지마다 그림이 붙고 차이가 나란히 보이며, 답은 `.hus-visual-decision/decisions/`에 남습니다 |
| [hack-user-skills-criteria-gap](plugins/criteria-gap/) | 판단 기준 없이 일을 맡기면 Claude가 그 기준 하나를 먼저 묻고, 답을 기억해 다음부터 따릅니다 |
| [hack-user-skills-session-coach](plugins/session-coach/) | 전날의 AI 세션으로 쓰는 일기와, 고른 세션에서 뽑는 업무 노하우 |

쓰는 법과 컴퓨터에 만드는 것은 플러그인마다 README에 있습니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `.claude-plugin/marketplace.json` | 마켓플레이스. 플러그인마다 한 줄 |
| `plugins/<이름>/` | 플러그인 하나: 정보 파일, 스킬, 훅, README, LICENSE, NOTICE |

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| 없음 | 마켓플레이스 자체는 아무것도 만들지 않습니다. 플러그인마다 README를 보세요 | |

## 라이선스

Apache License 2.0. `LICENSE`와 `NOTICE`를 보세요.
