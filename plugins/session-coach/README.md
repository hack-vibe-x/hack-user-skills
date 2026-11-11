# hack-user-skills-session-coach

A plugin for looking back on your AI work sessions, in Claude Code and Codex. It has two skills: a session diary written every midnight from the previous day's sessions, and a session playbook that pulls know-how and a ready-to-paste prompt out of the sessions you pick.

| Skill | What it does | Claude Code | Codex |
|---|---|---|---|
| **session-diary** | When turned on, writes a diary every midnight from the previous day's AI conversations. It points out how you worked, what you got done and how you used AI, with evidence, and gives one plan for tomorrow. | Yes | Skill only; needs `claude` |
| **session-playbook** | From recent sessions you pick, writes a task spec, know-how, skill candidates and a prompt to paste, saved as Markdown. | Yes | No (reads Claude Code sessions only) |

> **Still moving:** the screen features of the older plugin (the compass panel, the diary card in `/hack-mode`, the `/session-diary-now` command) are still in `hack-users-for-llms` and were not moved here. This plugin has the skills only.

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-session-coach@hack-user-skills
```

Open a new session after installing. Everything is off by default.

**Requirements:** `python3` (tried with 3.9 and 3.14). The automatic diary can be turned on only on macOS, and it writes with the `claude` command logged in on this computer.

For Codex, `npx skills add hack-vibe-x/hack-user-skills -a codex -g -y --skill session-diary --skill session-playbook` (not tried).

## Use

| Skill | What it does |
|---|---|
| `/hack-user-skills-session-coach:session-diary` | Turn the diary on or off, show its status, read a diary to you, rewrite one |
| `/hack-user-skills-session-coach:session-playbook` | Pick several sessions from the recent list and save the result as a Markdown file |

You can also just ask: "turn on the session diary", "show me yesterday's diary", "pull know-how out of my sessions".

### Session diary

**When it writes:** it wakes on the hour and at login and writes the days missed since you turned it on. Days when the computer was off are written when it is back on. A day without conversations is recorded as such, without a notification.

**What is in it:** in this order, a body in everyday language, tomorrow's plan, a "My notes" section for you, the original words as evidence, and statistics (sessions, messages, active time, commits, tokens, what writing it cost). There are no scores; it compares with earlier diaries. What you write in "My notes" is read by the next diary.

**Language:** the diary is written in the language you set when turning it on (Claude passes the language you are speaking, `--lang en` or `--lang ko`); without a setting, in the language of that day's sessions. To add a language, copy `skills/session-diary/locales/en.json` to `<code>.json` and translate it.

**Rewriting:** ask to rewrite a diary and it is written again from midnight up to that moment; the earlier diary and your notes are thrown away. If it cannot be written, the earlier diary stays.

**Careful: writing it now when there are no conversations yet closes that day as "no conversations".** For example, writing just after midnight means the automatic run for that day is skipped. Ask "rewrite the diary" within that day.

**What it sends:** the diary is written with `claude -p` on this computer, but the model that writes it runs on Anthropic's servers. So turning it on **sends the conversations of every project on this computer to Anthropic**, Codex conversations included. Keys are masked only for known patterns, so secrets you put in a conversation can go out. Diaries are stored only in `~/.hus-session-coach/session-diary/`, outside your repositories.

**Cost:** if you are logged in with a subscription, it comes out of your subscription usage with no separate charge. With an API key it is billed for real. The amount in the diary is the API price `claude` reports. A day with 160-190 thousand characters of material cost about $0.7-0.9 and a day with 10 thousand characters about $0.15-0.25 (Sonnet, 2026-10-30 to 11-02, one person's records). Days without conversations do not call the AI. One call is capped at $3 at API prices.

**Permissions:** the material mixes in web pages and pasted text, so there is a risk of following hidden instructions. So the AI gets no tools and returns text only; the script does all reading and writing of files.

**Login:** tried with a subscription login (`claude` login). The automatic run does not inherit your shell's environment variables, so if you use only an API key from an environment variable it may fail as not logged in.

**Failures:** it tries again on the next hour; after 6 failures it records in that day's diary that it could not write it, and notifies you. Ask "diary status" to see the state.

### Session playbook

Run `/hack-user-skills-session-coach:session-playbook` and the Claude Code sessions of the last two weeks appear as a numbered list with title, project, time and first request. Pick several and it reads those conversations and writes one file to `~/.hus-session-coach/session-playbook/<date>-<topic>.md`: a task spec, know-how with evidence quotes (and where each goes in a skill), skill candidates (with trigger phrases, the done criterion, and the judgement left to you), and a prompt to paste into a new session. The file is written in the language you use with Claude.

**What it sends:** the conversations of the sessions you pick go into the Claude session you are using. Sessions you do not pick are not read. The file quotes parts of the conversations, so do not put it in a public repository.

**Limits:** it reads Claude Code sessions only (not Codex records). Long sessions are shortened in the middle. Whether the know-how makes good prompts in practice has not been checked; only the list and the extraction were checked on real records.

## What is in it

| Path | Contents |
|---|---|
| `skills/session-diary/` | The diary skill, its scripts (`diary_auto.py`, `day_sessions.py`, `check_quotes.py`), the writing rules in `references/`, and the language files in `locales/` |
| `skills/session-playbook/` | The playbook skill, its script (`sessions.py`), and the result format in `references/format.md` |

Tests (fake records and a fake HOME only; they never register a launchd job):

```bash
(cd skills/session-diary/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_day_sessions test_diary_auto)
(cd skills/session-playbook/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_sessions)
```

## What it creates

| Where | What | How to remove |
|---|---|---|
| `~/.hus-session-coach/session-diary/` | Diaries, one `<date>.md` per day. Your documents | Delete the folder after turning the diary off |
| `~/.hus-session-coach/session-diary/.auto/` | `state.json` (settings), `lock`, `app/` (the copy of the scripts the job runs), `logs/auto.log` and `logs/launchd.log` | Deleted with the folder above |
| `~/.hus-session-coach/session-playbook/` | Know-how files `<date>-<topic>.md` and `.last-list.json` (the last list's numbers) | Delete the folder |
| launchd job `io.github.hack-vibe-x.hus-session-coach.session-diary` and `~/Library/LaunchAgents/io.github.hack-vibe-x.hus-session-coach.session-diary.plist` | Runs the diary on the hour and at login | Turn it off: say "turn off the session diary", or run `python3 ~/.hus-session-coach/session-diary/.auto/app/scripts/diary_auto.py off` |

Environment variables it reads: `HUS_SESSION_COACH_HOME` (moves `~/.hus-session-coach`), `HUS_SESSION_COACH_CLAUDE_DIR` and `HUS_SESSION_COACH_CODEX_DIR` (where the session records are read from), `HUS_SESSION_COACH_LABEL` (used by the tests).

To remove the plugin:

1. **Turn the diary off first.** Removing the plugin does not stop it: the job keeps running from its copy and **keeps sending conversations to the AI**. Use the command in the table above.
2. **Uninstall the plugin:** `claude plugin uninstall hack-user-skills-session-coach@hack-user-skills`
3. **To delete the records too,** delete `~/.hus-session-coach`. It is not deleted automatically.

### Moving from hack-users-for-llms

These skills used to be in the `hack-users-for-llms` plugin, which keeps using its own folders (`~/.session-diary`, `~/.session-playbook`) and its own job (`co.hack-users-for-llms.session-diary`). The two diaries must not run at once, so turning this one on stops with a message while the old one is on. Turn the old one off first:

```bash
python3 ~/.session-diary/.auto/app/scripts/diary_auto.py off
```

To keep your earlier diaries and playbook files, copy them (the next diaries then compare with them):

```bash
mkdir -p ~/.hus-session-coach
cp -R ~/.session-diary ~/.hus-session-coach/session-diary
cp -R ~/.session-playbook ~/.hus-session-coach/session-playbook
```

Then turn this diary on. Nothing is moved automatically, and the old folders are left as they are.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

AI와 한 작업 세션을 돌아보는 플러그인입니다. Claude Code와 Codex에서 씁니다. 스킬이 둘 들어 있습니다. 전날 세션으로 매일 자정에 쓰는 세션 일기, 고른 세션에서 노하우와 바로 붙여 쓸 프롬프트를 뽑는 세션 플레이북입니다.

| 스킬 | 하는 일 | Claude Code | Codex |
|---|---|---|---|
| **session-diary** | 켜 두면 매일 자정에 전날 AI 대화를 읽어 일기를 씁니다. 일하는 방식, 성과, AI 활용 수준을 근거와 함께 짚고 내일의 계획 하나를 줍니다. | O | 스킬만. `claude` 필요 |
| **session-playbook** | 최근 세션 중 고른 것에서 작업 명세, 노하우, 스킬 후보, 붙여 쓸 프롬프트를 뽑아 md로 저장합니다. | O | X (Claude Code 세션만 읽음) |

> **옮기는 중:** 옛 플러그인의 화면 기능(compass 패널, `/hack-mode`의 일기 카드, `/session-diary-now` 명령)은 아직 `hack-users-for-llms`에 있고 여기로 옮기지 않았습니다. 이 플러그인에는 스킬만 들어 있습니다.

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-session-coach@hack-user-skills
```

설치한 뒤 새 세션을 엽니다. 기본은 모두 꺼져 있습니다.

**필요한 것:** `python3`(3.9와 3.14에서 시험함). 자동 일기는 macOS에서만 켤 수 있고, 이 컴퓨터에 로그인된 `claude` 명령으로 씁니다.

Codex는 `npx skills add hack-vibe-x/hack-user-skills -a codex -g -y --skill session-diary --skill session-playbook`로 받습니다(확인하지 못함).

## 쓰는 법

| 스킬 | 하는 일 |
|---|---|
| `/hack-user-skills-session-coach:session-diary` | 일기 켜기, 끄기, 상태 보기, 읽어 주기, 다시 쓰기 |
| `/hack-user-skills-session-coach:session-playbook` | 최근 세션 목록에서 여러 개를 골라 md 파일로 저장 |

말로 요청해도 됩니다("세션 일기 켜줘", "어제 일기 보여줘", "세션에서 노하우 뽑아줘").

### 세션 일기

**쓰는 때:** 매 정각과 로그인 때 깨어나, 켠 날 이후 빠진 날을 씁니다. 컴퓨터가 꺼져 있던 날은 다음에 켜질 때 씁니다. 대화가 없던 날은 없었다고 남기고 알리지 않습니다.

**담기는 것:** 일상 언어로 쓴 본문, 내일의 계획, 내 메모 칸, 원문 근거, 통계(세션, 발화, 활동 시간, 커밋, 토큰, 쓰는 데 든 비용) 순서입니다. 점수는 매기지 않고 지난 일기와 비교합니다. 내 메모에 쓴 글은 다음 일기가 읽습니다.

**언어:** 켤 때 정한 언어로 씁니다(Claude가 지금 쓰는 말에 맞춰 `--lang ko`나 `--lang en`을 넘깁니다). 정하지 않았으면 그날 세션의 언어로 씁니다. 언어를 더하려면 `skills/session-diary/locales/en.json`을 `<코드>.json`으로 복사해 번역하면 됩니다.

**다시 쓰기:** 일기를 다시 쓰라고 하면 0시부터 그 시점까지로 새로 쓰고, 이전 일기와 내 메모는 폐기합니다. 쓰지 못하면 이전 일기는 그대로 남습니다.

**주의: 대화가 아직 없을 때 지금 쓰면 그날이 "대화 없음"으로 닫힙니다.** 예를 들어 0시 직후에 쓰면 그날 자정 자동 쓰기가 건너뜁니다. 그날 안에 "일기 다시 써줘"라고 하면 됩니다.

**보내는 것:** 일기는 이 컴퓨터의 `claude -p`로 쓰지만, 글을 쓰는 모델은 Anthropic 서버에서 돕니다. 그래서 켜면 **이 컴퓨터의 모든 프로젝트 대화를 Anthropic으로 보냅니다.** Codex 대화도 포함됩니다. 키는 정해진 패턴만 가리므로 대화에 넣은 비밀값이 나갈 수 있습니다. 일기는 저장소 밖 `~/.hus-session-coach/session-diary/`에만 저장합니다.

**비용:** 구독으로 로그인했다면 별도 청구 없이 구독 사용량에서 차감됩니다. API 키로 쓰면 실제 요금이 나갑니다. 일기에 적히는 금액은 `claude`가 알려 주는 API 요금 환산치입니다. 재료 16~19만 자인 날 약 $0.7~0.9, 1만 자인 날 약 $0.15~0.25였습니다(Sonnet, 2026-10-30~11-02, 한 사람 기록). 대화가 없는 날은 AI를 부르지 않습니다. 호출 한 번의 상한은 환산치 $3입니다.

**권한:** 재료에는 웹 글이나 붙여넣은 글이 섞여 있어 숨은 지시를 따를 위험이 있습니다. 그래서 AI는 도구 없이 글만 돌려주고, 파일 읽기와 쓰기는 스크립트가 합니다.

**로그인:** 구독 로그인(`claude` 로그인)에서 확인했습니다. 자동 실행은 셸의 환경 변수를 물려받지 않으므로, 환경 변수에 둔 API 키로만 쓰고 있다면 로그인 실패로 쓰지 못할 수 있습니다.

**실패:** 다음 정각에 다시 시도하고, 6번 실패하면 그날 일기에 쓰지 못했다고 남기고 알립니다. 상태는 "일기 상태"라고 물어보면 됩니다.

### 세션 플레이북

`/hack-user-skills-session-coach:session-playbook`을 부르면 최근 2주의 Claude Code 세션이 제목, 프로젝트, 시각, 첫 요청과 함께 번호 목록으로 나옵니다. 여러 개를 고르면 그 대화를 읽어 작업 명세, 근거 인용이 붙은 노하우(스킬의 어느 칸으로 갈지 포함), 스킬로 만들 만한 후보(켜는 말, 다 됐다의 기준, 사람에게 남길 판단 포함), 새 세션에 붙여 쓸 프롬프트를 한 파일로 `~/.hus-session-coach/session-playbook/<날짜>-<주제>.md`에 저장합니다. 파일은 Claude와 쓰는 말로 씁니다.

**보내는 것:** 고른 세션의 대화가 지금 쓰는 Claude 세션으로 들어갑니다. 고르지 않은 세션은 읽지 않습니다. 파일에 대화 일부가 인용되므로 공개 저장소에 올리지 마세요.

**한계:** Claude Code 세션만 읽습니다(Codex 기록은 읽지 않음). 긴 세션은 가운데를 줄여 읽습니다. 만든 노하우가 실제로 좋은 프롬프트가 되는지는 확인하지 못했습니다. 목록과 본문 뽑기만 실제 기록으로 확인했습니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/session-diary/` | 일기 스킬, 스크립트(`diary_auto.py`, `day_sessions.py`, `check_quotes.py`), `references/`의 쓰는 규칙, `locales/`의 언어 파일 |
| `skills/session-playbook/` | 플레이북 스킬, 스크립트(`sessions.py`), `references/format.md`의 결과 형식 |

시험(가짜 기록과 가짜 HOME만 씁니다. launchd 작업을 등록하지 않습니다):

```bash
(cd skills/session-diary/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_day_sessions test_diary_auto)
(cd skills/session-playbook/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_sessions)
```

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| `~/.hus-session-coach/session-diary/` | 일기. 하루에 `<날짜>.md` 하나. 사용자 문서입니다 | 일기를 끈 뒤 폴더를 지웁니다 |
| `~/.hus-session-coach/session-diary/.auto/` | `state.json`(설정), `lock`, `app/`(자동 실행이 쓰는 스크립트 복사본), `logs/auto.log`, `logs/launchd.log` | 위 폴더와 함께 지워집니다 |
| `~/.hus-session-coach/session-playbook/` | 노하우 파일 `<날짜>-<주제>.md`, `.last-list.json`(마지막 목록의 번호) | 폴더를 지웁니다 |
| launchd 작업 `io.github.hack-vibe-x.hus-session-coach.session-diary`와 `~/Library/LaunchAgents/io.github.hack-vibe-x.hus-session-coach.session-diary.plist` | 매 정각과 로그인 때 일기를 씁니다 | 끄기: "세션 일기 꺼줘"라고 하거나 `python3 ~/.hus-session-coach/session-diary/.auto/app/scripts/diary_auto.py off`를 실행합니다 |

읽는 환경 변수: `HUS_SESSION_COACH_HOME`(`~/.hus-session-coach` 위치를 바꿈), `HUS_SESSION_COACH_CLAUDE_DIR`, `HUS_SESSION_COACH_CODEX_DIR`(세션 기록을 읽는 곳), `HUS_SESSION_COACH_LABEL`(시험용).

플러그인을 지우려면:

1. **일기를 먼저 끕니다.** 플러그인을 지워도 자동 실행은 복사본으로 **계속 돌면서 대화를 AI에 보냅니다.** 위 표의 명령을 씁니다.
2. **플러그인을 지웁니다:** `claude plugin uninstall hack-user-skills-session-coach@hack-user-skills`
3. **기록까지 지우려면** `~/.hus-session-coach`를 지웁니다. 자동으로 지워지지 않습니다.

### hack-users-for-llms에서 옮겨 올 때

이 스킬들은 원래 `hack-users-for-llms` 플러그인에 있었습니다. 그 플러그인은 계속 자기 폴더(`~/.session-diary`, `~/.session-playbook`)와 자기 작업(`co.hack-users-for-llms.session-diary`)을 씁니다. 두 일기가 함께 돌면 안 되므로, 옛 일기가 켜져 있으면 이 일기는 켜지지 않고 안내만 합니다. 옛 일기를 먼저 끕니다.

```bash
python3 ~/.session-diary/.auto/app/scripts/diary_auto.py off
```

지난 일기와 플레이북 파일을 이어 쓰려면 복사합니다(다음 일기가 지난 일기와 비교합니다).

```bash
mkdir -p ~/.hus-session-coach
cp -R ~/.session-diary ~/.hus-session-coach/session-diary
cp -R ~/.session-playbook ~/.hus-session-coach/session-playbook
```

그다음 이 일기를 켭니다. 자동으로 옮기는 것은 없고, 옛 폴더는 그대로 둡니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
