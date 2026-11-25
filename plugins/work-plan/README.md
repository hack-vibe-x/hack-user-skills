# hack-user-skills-work-plan

Turns a task you were handed, and the material that came with it, into a work plan you can do with AI. The plan starts from the goal: what the work is for, and what success looks like. Then what must be known to reach it: the criteria for a good result, and a first step that builds them, with sources, when nobody has them. Then how the work is built from the goal, and the path to the end. Each step says which part of the goal it serves, the files to attach, a prompt to paste into an AI chat, the result it must produce, and a done check, including one against the goal, that tells you when to go to the next step. The path has a chat that did not make the result evaluate it, a separate check of its facts, and a step where you read what changed and adjust it yourself before it goes out.

Before it writes, Claude asks you every question the material cannot answer, in rounds, on a web page. Each round comes with a recommended answer built from the material. Every line of the plan cites where it comes from: a quote from the material, one of your answers, an inference, or an assumption. A program checks each quote against the material word for word, and a fresh AI that has not seen the conversation looks for sentences the material does not support.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-work-plan@hack-user-skills
```

The question page comes from [hack-user-skills-visual-decision](https://github.com/hack-vibe-x/hack-user-skills/tree/main/plugins/visual-decision). It is declared as a dependency, so installing this plugin installs it too. If it is still missing when the skill runs, the skill installs it with `claude plugin install` and uses it in the same session. Where no page can be opened (`claude -p`, a remote or SSH session), the questions are asked in the terminal.

**Requirements:** Node.js 18 or later. To read PDFs the checker uses `pdftotext` (Poppler, `brew install poppler`); Word, PowerPoint, Excel, `.hwpx` and OpenDocument files are read with `unzip`, which macOS and most Linux systems have. Images, scanned PDFs and `.hwp` files cannot be checked by the program. The plan marks them, so you know which quotes to check yourself.

## Use

Say what the work is and give the material: "make a work plan for this task, the material is in ~/Downloads/brief", or run `/hack-user-skills-work-plan:work-plan`.

1. Claude reads every material to the end and lists the facts in it with quotes.
2. It asks in rounds. It starts with what the work is for, the goal, and where the criteria for a good result are, then scope, the structure of the work, which material to trust, risks, and the steps. It does not ask what the material already answers. You can stop at any time; what is left open goes into the plan as assumptions.
3. It writes the plan and checks it, then tells you where it is.

Work through the plan from step 1. Paste the step's prompt with the files it names. Check every box of the step's done check, and use the follow-up prompt when one stays empty. Then go to the next step.

## What is in it

| Path | Contents |
|---|---|
| `skills/work-plan/SKILL.md` | The steps Claude follows |
| `skills/work-plan/references/format.md` | The plan's sections, and the rules for steps, prompts and done checks |
| `skills/work-plan/references/ledger.md` | The ledger: where every line of the plan comes from |
| `skills/work-plan/scripts/ledger.mjs` | Checks the plan's quotes against the material and writes its sources section |
| `skills/work-plan/locales/` | The words of the sources section, in English and Korean |
| `tests/` | Tests for the checker: `node --test plugins/work-plan/tests/ledger.test.mjs` |

## What it creates

| Where | What | Remove |
|---|---|---|
| `work-plans/` in the folder Claude was started in (or the folder named by `"dir"` in `.hus-work-plan/config.json`) | One Markdown file per plan, named by date and topic | Your documents; keep or delete them |
| `.hus-work-plan/<date>-<topic>/` in the same folder | Working files: your task description and pasted text word for word, the ledger, each round's question file, answers given in the terminal | Delete the folder once the plan is done. Add `.hus-work-plan/` to `.gitignore` to keep it out of a repository |
| `.hus-visual-decision/decisions/` | Each question round's record, written by visual-decision | See its README |

Claude reads the material in this session, as it reads any file you show it. The plugin itself sends nothing anywhere else, and it does not upload files for you: the plan names the files you attach when you do the steps.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

받은 업무와 함께 온 자료로, AI와 함께 해 나갈 업무 기획서를 만듭니다. 기획서는 목표에서 시작합니다. 이 일이 무엇을 위한 것이고, 성공하면 어떤 모습인지 적습니다. 그다음은 목표에 가려면 알아야 할 것입니다. 좋은 결과를 가르는 기준을 적고, 기준을 가진 사람이 없으면 출처를 붙여 기준을 만드는 단계를 맨 앞에 둡니다. 이어서 목표에서 끌어낸 일의 구조와, 끝까지 가는 경로가 나옵니다. 단계마다 목표의 어느 부분을 위한 단계인지, 첨부할 파일, AI 대화창에 붙여 넣을 프롬프트, 나와야 할 결과, 다음 단계로 넘어가도 되는지 알려 주는 완료 조건이 있습니다. 완료 조건에는 목표에 맞는지 묻는 칸이 들어갑니다. 경로에는 결과를 만들지 않은 대화가 결과를 평가하는 단계, 사실을 따로 확인하는 단계, 보내기 전에 무엇이 바뀌었는지 읽고 직접 고치는 단계가 들어갑니다.

기획서를 쓰기 전에 Claude는 자료로 답할 수 없는 것을 웹 화면으로 모두 묻습니다. 질문은 여러 번에 걸쳐 묶음으로 오고, 묶음마다 자료에 근거한 추천 답이 붙습니다. 기획서의 모든 문장에는 출처가 붙습니다. 출처는 자료의 인용, 사용자의 답, 추론, 가정 중 하나입니다. 인용은 검사 도구가 원문과 글자 그대로 맞춰 봅니다. 대화를 보지 않은 새 AI가 자료로 뒷받침되지 않는 문장도 찾습니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-work-plan@hack-user-skills
```

질문 화면은 [hack-user-skills-visual-decision](https://github.com/hack-vibe-x/hack-user-skills/tree/main/plugins/visual-decision)이 띄웁니다. 의존 플러그인으로 적혀 있어서 이 플러그인을 설치하면 함께 설치됩니다. 스킬을 실행할 때 visual-decision이 없으면 `claude plugin install`로 설치하고 그 세션에서 바로 씁니다. 화면을 열 수 없는 곳(`claude -p`, 원격이나 SSH 접속)에서는 터미널로 묻습니다.

**필요한 것:** Node.js 18 이상. PDF는 `pdftotext`(Poppler, `brew install poppler`)로 읽습니다. Word, PowerPoint, Excel, `.hwpx`, OpenDocument 파일은 `unzip`으로 읽습니다. macOS와 대부분의 리눅스에 들어 있습니다. 이미지, 스캔한 PDF, `.hwp` 파일은 검사 도구가 맞춰 볼 수 없습니다. 기획서에 그런 자료를 따로 표시하므로, 어느 인용을 직접 확인해야 하는지 알 수 있습니다.

## 쓰는 법

무슨 일인지 말하고 자료를 알려 주세요. 예: "이 일 업무 기획해줘. 자료는 ~/Downloads/brief 폴더에 있어". `/hack-user-skills-work-plan:work-plan`을 불러도 됩니다.

1. Claude가 자료를 끝까지 읽고, 자료에 있는 사실을 인용과 함께 정리합니다.
2. 여러 번에 걸쳐 묻습니다. 일의 목적, 목표, 좋은 결과를 가르는 기준이 어디 있는지를 먼저 묻고, 범위, 일의 구조, 어느 자료를 믿을지, 위험, 단계 순서로 이어 갑니다. 자료에 이미 답이 있는 것은 묻지 않습니다. 언제든 그만둘 수 있고, 답하지 않은 것은 가정으로 기획서에 남습니다.
3. 기획서를 쓰고 점검한 뒤, 어디에 저장했는지 알려 줍니다.

기획서는 1단계부터 따라갑니다. 단계의 프롬프트를 적힌 파일과 함께 붙여 넣으세요. 완료 조건의 칸을 모두 확인하고, 채워지지 않은 칸이 있으면 보충 프롬프트를 씁니다. 모두 채워지면 다음 단계로 넘어갑니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/work-plan/SKILL.md` | Claude가 따르는 순서 |
| `skills/work-plan/references/format.md` | 기획서의 구성, 그리고 단계, 프롬프트, 완료 조건을 쓰는 규칙 |
| `skills/work-plan/references/ledger.md` | 자료 장부: 기획서의 문장마다 어디서 왔는지 적는 목록 |
| `skills/work-plan/scripts/ledger.mjs` | 기획서의 인용을 원문과 맞춰 보고 출처 목록을 쓰는 검사 도구 |
| `skills/work-plan/locales/` | 출처 목록에 쓰는 말(영어, 한국어) |
| `tests/` | 검사 도구 테스트: `node --test plugins/work-plan/tests/ledger.test.mjs` |

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| Claude를 시작한 폴더의 `work-plans/` (`.hus-work-plan/config.json`의 `"dir"`로 바꿀 수 있음) | 기획서. 날짜와 주제로 이름 붙인 Markdown 파일 | 사용자의 문서입니다. 두거나 지우세요 |
| 같은 폴더의 `.hus-work-plan/<날짜>-<주제>/` | 작업 파일: 업무 설명과 붙여 넣은 글 원문, 자료 장부, 질문 묶음 파일, 터미널로 받은 답 | 기획서가 끝나면 폴더를 지우세요. 저장소에 넣지 않으려면 `.gitignore`에 `.hus-work-plan/`을 더하세요 |
| `.hus-visual-decision/decisions/` | 질문 묶음마다 visual-decision이 남기는 기록 | visual-decision README를 보세요 |

자료는 Claude가 이 세션에서 읽습니다. 사용자가 보여 주는 다른 파일을 읽을 때와 같습니다. 플러그인이 따로 어디로 보내는 것은 없고, 파일을 대신 올리지도 않습니다. 기획서에는 단계를 할 때 사용자가 첨부할 파일 이름이 적힙니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
