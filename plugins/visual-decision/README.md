# hack-user-skills-visual-decision

A Claude Code plugin: when Claude has a question for you, it asks in a local web page instead of terminal text. Every option comes with a visual and rows that show how the options differ, and you submit all your answers at once.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-visual-decision@hack-user-skills
```

Needs Node.js 18 or later. There are no packages to install. If the computer has none, Claude says so when a session starts and asks what you want: install it for you (only when Homebrew is on the computer; no `sudo`, no administrator password), send you the install command, not now, or do not ask again. Nothing is installed until you choose. Until Node.js is there, questions stay in the terminal. The check is `hooks/env-check.sh`; it installs nothing itself. It looks on PATH first, then where nvm, fnm, volta, mise, asdf and Homebrew keep Node.js. The hooks are written for macOS and Linux (they start with `sh`); Windows is not supported.

## How it works

1. Claude is about to ask you something (AskUserQuestion). The hook stops that and sends Claude to the skill. You can also say "ask me in the web UI".
2. The skill writes the question to a temp file and opens a page on `127.0.0.1`.
3. You pick, type your own answer, or send a question back ("I need more information", "None of these options fit", "Decide for me"). Then press **Submit**.
4. Claude reads your answers and continues. The answers are also kept in `.hus-visual-decision/decisions/<date>-<name>.md` at the project root, so you and Claude can look back at what was decided.
5. In later sessions, Claude is told at the start that these records exist, and reads the one that covers what it is about to work on.

It is on in every project once installed. To turn it off in one project only, run this in that project (it writes `.claude/settings.local.json` there; other projects stay on):

```
claude plugin disable hack-user-skills-visual-decision@hack-user-skills --scope local
```

Turn it back on with `enable` and the same options. Or just tell Claude "turn off web questions in this project".

## What is in it

| Path | Contents |
|---|---|
| `hooks/` | One hook sends AskUserQuestion to the skill; another, at session start, tells Claude that `.hus-visual-decision/decisions/` exists (only when it does) |
| `skills/visual-decision/` | The skill, the page, the server, the question file format, and the language files (`en`, `ko`) |
| `samples/` | Questions of all five types, in English and Korean |
| `tests/` | `node --test tests/visual-decision.test.mjs` |

Try the sample from this folder: `node skills/visual-decision/scripts/serve.mjs samples/decisions.json --keep`

The page stops waiting when you press **Cancel these decisions**, when it has been closed for a minute, or after an hour without a submit. Choices made so far stay in your browser for the next time.

## What it creates

| Where | What | Remove |
|---|---|---|
| A temp folder, e.g. `/tmp/hus-visual-decision/` | The question files Claude writes | The system clears it, or delete it |
| Browser storage for `127.0.0.1:<port>` | Choices in progress, under `hus-visual-decision:<question file name>`. Removed on submit | Clear site data for `127.0.0.1` |
| `~/.hus-visual-decision/no-env-check` | Only if you choose "do not ask again": an empty file that stops the Node.js check | Delete the file |
| `.hus-visual-decision/decisions/` at the project root (the git root, or the working folder) | One Markdown file per submitted batch. Commit it to share decisions with your team, or add `.hus-visual-decision/` to `.gitignore` to keep them on your machine | Your documents; keep or delete them |

Before 0.7.0 records went to `docs/decisions/`, and `.hus-visual-decision/` also held `config.json`, `pending/` and `answers/`. Those are no longer used: move old records with `mkdir -p .hus-visual-decision && mv docs/decisions .hus-visual-decision/decisions`, and delete the rest.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

Claude가 물어볼 것이 생기면 터미널 글 대신 로컬 웹 화면으로 묻는 Claude Code 플러그인입니다. 선택지마다 그림과 차이 항목이 붙고, 다 고르면 한 번에 넘깁니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-visual-decision@hack-user-skills
```

Node.js 18 이상이 필요합니다. 따로 깔 패키지는 없습니다. 컴퓨터에 없으면 세션을 시작할 때 Claude가 알리고 무엇을 할지 묻습니다: 대신 설치(Homebrew가 있을 때만, `sudo`와 관리자 비밀번호 없이), 설치 명령 보내 주기, 지금은 넘어가기, 다시 묻지 않기. 고르기 전에는 아무것도 설치하지 않습니다. Node.js가 생기기 전까지 질문은 터미널에서 합니다. 점검은 `hooks/env-check.sh`가 하고, 이 스크립트는 아무것도 설치하지 않습니다. PATH를 먼저 보고, 없으면 nvm, fnm, volta, mise, asdf, Homebrew가 Node.js를 두는 곳도 찾아봅니다. 훅은 macOS와 Linux용입니다(`sh`로 시작). Windows는 지원하지 않습니다.

## 동작

1. Claude가 질문하려고 하면(AskUserQuestion) 훅이 그 질문을 막고 스킬로 보냅니다. "웹으로 물어봐"라고 해도 됩니다.
2. 스킬이 질문을 임시 파일로 쓰고 `127.0.0.1`에 화면을 띄웁니다.
3. 답을 고르거나 직접 적고, 아니면 질문을 돌려보냅니다("정보가 부족해요", "마음에 드는 선택지가 없어요", "알아서 정해 주세요"). 그리고 **이대로 진행**을 누릅니다.
4. Claude가 답을 읽고 이어서 일합니다. 답은 프로젝트 루트의 `.hus-visual-decision/decisions/<날짜>-<이름>.md`에도 남아, 나중에 무엇을 정했는지 다시 볼 수 있습니다.
5. 다음 세션부터는 시작할 때 Claude에게 이 기록이 있다고 알려 주고, Claude는 하려는 일에 해당하는 기록을 읽습니다.

설치하면 모든 프로젝트에서 켜집니다. 한 프로젝트에서만 끄려면 그 프로젝트에서 다음을 실행합니다. 그 프로젝트의 `.claude/settings.local.json`에만 적히고, 다른 프로젝트는 그대로 켜져 있습니다.

```
claude plugin disable hack-user-skills-visual-decision@hack-user-skills --scope local
```

다시 켜려면 같은 옵션으로 `enable`을 실행합니다. Claude에게 "이 프로젝트에서는 웹으로 묻지 마"라고 해도 됩니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `hooks/` | AskUserQuestion을 스킬로 보내는 훅, 세션을 시작할 때 `.hus-visual-decision/decisions/`가 있음을 Claude에게 알리는 훅(폴더가 있을 때만) |
| `skills/visual-decision/` | 스킬 본문, 화면, 서버, 질문 파일 형식, 언어 파일(`en`, `ko`) |
| `samples/` | 다섯 가지 질문 유형이 모두 든 영어·한국어 샘플 |
| `tests/` | `node --test tests/visual-decision.test.mjs` |

샘플 보기(이 폴더에서): `node skills/visual-decision/scripts/serve.mjs samples/decisions.ko.json --keep`

화면에서 **결정 그만두기**를 누르거나, 화면을 닫고 1분이 지나거나, 제출 없이 1시간이 지나면 서버가 멈춥니다. 고르던 답은 브라우저에 남아 다음에 다시 열면 되살아납니다.

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| 임시 폴더(예: `/tmp/hus-visual-decision/`) | Claude가 쓰는 질문 파일 | 시스템이 비우거나, 직접 지웁니다 |
| `127.0.0.1:<포트>`의 브라우저 저장소 | 고르던 답. 키는 `hus-visual-decision:<질문 파일 이름>`. 제출하면 지워집니다 | `127.0.0.1`의 사이트 데이터를 지웁니다 |
| `~/.hus-visual-decision/no-env-check` | "다시 묻지 않기"를 고를 때만: Node.js 점검을 멈추는 빈 파일 | 파일을 지웁니다 |
| 프로젝트 루트(git 루트, 없으면 작업 폴더)의 `.hus-visual-decision/decisions/` | 제출한 묶음마다 마크다운 파일 하나. 팀과 결정을 나누려면 커밋하고, 이 컴퓨터에만 두려면 `.hus-visual-decision/`을 `.gitignore`에 넣습니다 | 사용자 문서입니다. 두거나 지웁니다 |

0.7.0 전에는 기록이 `docs/decisions/`에 쌓였고, `.hus-visual-decision/`에는 `config.json`, `pending/`, `answers/`도 있었습니다. 이것들은 이제 쓰지 않습니다. 예전 기록은 `mkdir -p .hus-visual-decision && mv docs/decisions .hus-visual-decision/decisions`로 옮기고, 나머지는 지우면 됩니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
