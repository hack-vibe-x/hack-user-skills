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

### What a question page shows

- **Three layers.** First, two or three plain sentences on what the decision is. Then what you need to choose: a picture per option, only the rows where the options differ, what each option gives up, and the recommendation as a condition ("if safety matters more than speed") with how sure Claude is. Everything else (an honest drawback of the recommended option, what happens afterwards, evidence, common confusions) is folded away.
- **What your choice will do**, in plain words, right under the options once you pick. For decisions that take work to undo or cannot be undone, it is a check, "Is this what you mean?", that you answer before going on. For easy ones it is one line, and "Go with this, next" settles it.
- **Words a stranger can follow.** Every label is written for someone who has not seen your project. A word that cannot be replaced gets a small **?** after it: hover, press or tab to it and a box says what it means. Claude's question files are checked before the page opens (a missing plain-words summary, an abbreviation or a name from code with no explanation, a sentence that runs on), and a fresh reader who knows nothing about the project reads the page text first (`serve.mjs <file> --text`) and lists what it cannot follow.
- **How hard it is to undo**, as a badge on every decision. Hard-to-undo ones cannot be handed to Claude, and their options open only after you have scrolled through the comparison.
- **More kinds of pictures**: before/after (side by side, swipe or text), timelines with the point of no return, what else is affected, step-by-step stories, and "3 in 100" icon grids.
- **An overview** when there are three or more decisions: a map of what will be decided, where nothing is chosen.
- **A review before submitting**, where you can mark what decided each answer. The record keeps it, along with how to undo the decision and how to check that it worked.

It is on in every project once installed. To turn it off in one project only, run this in that project (it writes `.claude/settings.local.json` there; other projects stay on):

```
claude plugin disable hack-user-skills-visual-decision --scope local
```

Turn it back on with `enable` and the same options. Or just tell Claude "turn off web questions in this project".

## What is in it

| Path | Contents |
|---|---|
| `hooks/` | One hook sends AskUserQuestion to the skill; another, at session start, tells Claude that `.hus-visual-decision/decisions/` exists (only when it does); `env-check.sh` checks for Node.js at session start (it installs nothing) and tells the other hooks where node is |
| `skills/visual-decision/` | The skill, the page, the server, the question file format, and the language files (`en`, `ko`) |
| `samples/` | Questions of all five types, in English and Korean |
| `tests/` | `node --test tests/visual-decision.test.mjs tests/env-check.test.mjs` |

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

## Version history

Each release is tagged `visual-decision-v<version>` in this repository.

| Version | Date | What changed |
|---|---|---|
| 0.10.0 | 2026-11-19 | Plain words everywhere, not only in the summary: rules for every label (no names from Claude's own notes, no coined phrases, one idea per sentence), a **?** that explains a word on the page, a check that refuses a question file with a missing summary, unexplained abbreviations or code names, and run-on sentences, and a cold read of the page text (`--text`) by a reader who knows nothing about the project. The page's own wording and the samples were simplified |
| 0.9.0 | 2026-11-19 | Question pages in three layers (plain words first, then what you need to choose, then details folded away). What your choice will do is shown in plain words; decisions that are costly or impossible to undo ask "Is this what you mean?" before you move on. A badge for how hard each decision is to undo, an overview when there are three or more decisions, "write my own" and "I can't decide" as their own cards under the options (only one kind of answer at a time), rows only where options differ, ranges and how sure Claude is, a conditional recommendation, and new pictures (before/after, timeline, what else is affected, step-by-step story, "3 in 100" grids). The review lets you mark what decided each answer, and the record keeps it with how to undo and how to check it worked. One meaning per colour; view options folded into "View settings". Older question files work unchanged |
| 0.8.0 | 2026-11-13 | Checks for Node.js at session start and asks before installing anything |
| 0.7.1 | 2026-11-12 | Drawings fit their content, units follow the number as written, the phone question list keeps the current question in view |
| 0.7.0 | 2026-11-12 | Every AskUserQuestion goes to the page; your own answer on pick questions; each submit kept as one Markdown file in `.hus-visual-decision/decisions/`; config, drafts and answer files removed |
| 0.6.0 | 2026-11-12 | The server stops (Cancel, time limit, page closed) and says why; `--check` validates question files; answers are checked against the questions |
| 0.4.0 and earlier | | Before the plugins were collected into this repository |

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

### 질문 화면에 보이는 것

- **세 층.** 맨 먼저 이 결정이 무엇인지 쉬운 말 두세 문장. 다음은 고르는 데 필요한 것: 선택지마다 그림, 선택지끼리 차이 나는 행만, 고르면 포기하는 것, 조건이 붙은 추천("속도보다 안전이 중요하다면")과 Claude가 얼마나 확신하는지. 나머지(추천안의 솔직한 단점, 고른 뒤 상태, 근거, 흔한 오해)는 접혀 있습니다.
- **고르면 무엇을 하게 되는지**를 선택지 바로 아래에 쉬운 말로 보여 줍니다. 되돌리는 데 손이 많이 가거나 되돌릴 수 없는 결정에서는 "이걸 의도한 게 맞나요?"라고 묻고, 답해야 다음으로 갑니다. 쉬운 결정에서는 한 줄로만 보여 주고 "이대로 다음"을 누르면 정해집니다.
- **되돌리기 어려운 정도**가 결정마다 표시됩니다. 되돌리기 어려운 결정은 Claude에게 맡길 수 없고, 비교를 끝까지 내려 봐야 고를 수 있습니다.
- **낯선 사람도 따라갈 수 있는 말.** 모든 글은 이 프로젝트를 본 적 없는 사람이 읽는다고 생각하고 씁니다. 바꿀 수 없는 말에는 단어 옆에 작은 **?**가 붙습니다. 마우스를 올리거나 누르거나 Tab으로 가면 뜻이 뜹니다. Claude가 만든 질문 파일은 화면이 열리기 전에 검사하고(쉬운 말 요약이 없음, 설명 없는 약어나 코드 이름, 너무 긴 문장), 프로젝트를 전혀 모르는 새 읽는이가 화면 글만 먼저 읽고(`serve.mjs <파일> --text`) 이해 못 하는 곳을 알려 줍니다.
- **더 다양한 그림**: 전/후 비교(나란히, 밀어 보기, 글자 차이), 되돌릴 수 없는 시점이 표시된 타임라인, 함께 영향받는 것, 단계별 장면, "100번 중 3번" 아이콘 그림.
- **한눈에 보기**: 결정이 3개 이상이면 먼저 무엇을 정할지 지도로 보여 줍니다. 여기서는 고르지 않습니다.
- **보내기 전 확인 화면**에서 답마다 무엇이 결정적이었는지 표시할 수 있습니다. 기록에는 이것과 함께 되돌리는 법, 잘 됐는지 확인하는 법이 남습니다.

설치하면 모든 프로젝트에서 켜집니다. 한 프로젝트에서만 끄려면 그 프로젝트에서 다음을 실행합니다. 그 프로젝트의 `.claude/settings.local.json`에만 적히고, 다른 프로젝트는 그대로 켜져 있습니다.

```
claude plugin disable hack-user-skills-visual-decision --scope local
```

다시 켜려면 같은 옵션으로 `enable`을 실행합니다. Claude에게 "이 프로젝트에서는 웹으로 묻지 마"라고 해도 됩니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `hooks/` | AskUserQuestion을 스킬로 보내는 훅, 세션을 시작할 때 `.hus-visual-decision/decisions/`가 있음을 Claude에게 알리는 훅(폴더가 있을 때만), 세션을 시작할 때 Node.js를 점검하고(아무것도 설치하지 않음) 다른 훅에 node의 위치를 알려 주는 `env-check.sh` |
| `skills/visual-decision/` | 스킬 본문, 화면, 서버, 질문 파일 형식, 언어 파일(`en`, `ko`) |
| `samples/` | 다섯 가지 질문 유형이 모두 든 영어·한국어 샘플 |
| `tests/` | `node --test tests/visual-decision.test.mjs tests/env-check.test.mjs` |

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

## 버전 기록

릴리스마다 이 저장소에 `visual-decision-v<버전>` 태그가 붙습니다.

| 버전 | 날짜 | 바뀐 것 |
|---|---|---|
| 0.10.0 | 2026-11-19 | 요약뿐 아니라 모든 글을 쉬운 말로: 모든 라벨에 적용되는 규칙(Claude가 작업하며 붙인 이름 금지, 지어낸 표현 금지, 한 문장에 한 가지), 화면에서 말뜻을 알려 주는 **?**, 쉬운 말 요약이 없거나 설명 없는 약어·코드 이름·늘어진 문장이 있는 질문 파일 거부, 프로젝트를 모르는 읽는이가 화면 글을 먼저 읽어 보는 단계(`--text`). 화면 자체의 문구와 샘플도 쉽게 고침 |
| 0.9.0 | 2026-11-19 | 질문 화면을 세 층으로 나눔(먼저 쉬운 말, 다음 고르는 데 필요한 것, 나머지는 접어 둠). 고르면 그 답이 무엇을 하게 되는지 쉬운 말로 보여 주고, 되돌리려면 품이 들거나 되돌릴 수 없는 결정은 "이걸 의도한 게 맞나요?"에 답해야 넘어감. 결정마다 되돌리기 어려운 정도 표시, 결정이 3개 이상이면 한눈에 보기, 선택지 아래 "직접 적을게요"·"못 고르겠어요" 카드(답은 셋 중 하나만), 차이 나는 행만 보이기, 범위와 확신도, 조건이 붙은 추천, 새 그림(전/후 비교, 타임라인, 함께 영향받는 것, 단계별 장면, "100번 중 3번" 그림). 확인 화면에서 무엇이 결정적이었는지 표시하고, 기록에 되돌리는 법과 잘 됐는지 확인하는 법을 함께 남김. 색마다 뜻 하나, 보기 조작은 "보기 설정"으로 접음. 예전 질문 파일도 그대로 동작 |
| 0.8.0 | 2026-11-13 | 세션을 시작할 때 Node.js를 점검하고, 설치는 묻고 나서만 함 |
| 0.7.1 | 2026-11-12 | 그림이 내용에 맞는 높이로 그려짐, 단위가 적은 그대로 숫자 뒤에 붙음, 폰에서 질문 목록이 지금 질문을 보여 줌 |
| 0.7.0 | 2026-11-12 | 모든 AskUserQuestion을 웹 화면으로 보냄, 고르기 질문에 직접 답 적기, 제출할 때마다 `.hus-visual-decision/decisions/`에 마크다운 파일 하나로 남김, 설정·임시 답 파일 정리 |
| 0.6.0 | 2026-11-12 | 서버가 멈출 때(그만두기, 시간 제한, 화면 닫힘) 이유를 알림, `--check`로 질문 파일 검사, 받은 답을 질문과 맞춰 봄 |
| 0.4.0 이전 | | 플러그인들을 이 저장소로 모으기 전 |

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
