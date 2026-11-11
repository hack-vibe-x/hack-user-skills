# visual-decision

A Claude Code plugin that asks you decisions in a local web page instead of in terminal text. Every option comes with a visual and rows that show how the options differ, and you submit all your answers at once. Finished decisions are saved as documents in your project.

## Install

```
/plugin marketplace add hack-vibe-x/visual-decision
/plugin install visual-decision@visual-decision
```

Requires Node.js 18 or later. There are no packages to install.

## Use

- Say "ask me in the web UI" or "open a decision page" and the skill writes a question file and opens the page.
- To receive every question in the web UI in a project, put `{"askHook": true}` in `.decisions/config.json`. It is off by default.
- Press **Submit** and your answers go to Claude. When the turn ends, a record is written to `docs/decisions/<date>-<name>.md`. Change the folder with `recordDir` in the same config file.
- The page and the record follow the question file's `"lang"` (`en` or `ko`), then `lang` in `.decisions/config.json`, then English. To add a language, copy `skills/visual-decision/locales/en.json` to `<code>.json` and translate it.

## What is in it

| Path | Contents |
|---|---|
| `skills/visual-decision/` | The skill, the decision page, the server, the question file format, and the language files |
| `hooks/` | A hook that redirects questions to the web page and a hook that writes the records |
| `samples/` | `decisions.json` (English) and `decisions.ko.json` (Korean) with all five decision types |

Try the sample: `node skills/visual-decision/scripts/serve.mjs samples/decisions.json --keep`

The server listens on 127.0.0.1 only. Answers and records stay in your project folder.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

결정이 필요할 때 터미널 글 대신 로컬 웹 화면으로 묻는 Claude Code 플러그인입니다. 선택지마다 그림과 차이 항목이 붙고, 다 고르면 한 번에 넘깁니다. 끝난 결정은 프로젝트 안에 문서로 쌓입니다.

## 설치

```
/plugin marketplace add hack-vibe-x/visual-decision
/plugin install visual-decision@visual-decision
```

Node.js 18 이상이 필요합니다. 따로 깔 패키지는 없습니다.

## 쓰는 법

- "웹으로 물어봐", "결정 화면 띄워줘"라고 하면 스킬이 질문 파일을 만들고 화면을 띄웁니다.
- 프로젝트에서 모든 질문을 웹으로 받으려면 `.decisions/config.json`에 `{"askHook": true}`를 둡니다. 기본은 꺼져 있습니다.
- **이대로 진행**을 누르면 답이 Claude에게 넘어가고, 턴이 끝날 때 `docs/decisions/<날짜>-<이름>.md`에 기록이 쌓입니다. 기록 폴더는 같은 설정 파일의 `recordDir`로 바꿉니다.
- 화면과 기록의 언어는 질문 파일의 `"lang"`(`en` 또는 `ko`), 없으면 `.decisions/config.json`의 `lang`, 그것도 없으면 영어입니다. 언어를 더하려면 `skills/visual-decision/locales/en.json`을 `<코드>.json`으로 복사해 번역하면 됩니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/visual-decision/` | 스킬 본문, 결정 화면, 서버, 질문 파일 형식, 언어 파일 |
| `hooks/` | 질문을 웹으로 돌리는 훅, 기록을 쌓는 훅 |
| `samples/` | 다섯 가지 결정 유형이 모두 들어 있는 `decisions.json`(영어)과 `decisions.ko.json`(한국어) |

샘플 보기: `node skills/visual-decision/scripts/serve.mjs samples/decisions.ko.json --keep`

서버는 이 컴퓨터(127.0.0.1)에서만 듣고, 답과 기록은 프로젝트 폴더 밖으로 나가지 않습니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
