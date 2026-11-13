# hack-user-skills-session-coach

A plugin for looking back on your AI work sessions, in Claude Code and Codex. It has two skills: a session diary written every midnight from the previous day's sessions, and a session playbook that pulls know-how and a ready-to-paste prompt out of the sessions you pick. In Claude Code it also adds screen features: a compass pane that tracks a conversation's progress toward the goal you set, a card that writes today's diary now, and the latest diary's plan shown when a session starts.

| Skill | What it does | Claude Code | Codex |
|---|---|---|---|
| **session-diary** | When turned on, writes a diary every midnight from the previous day's AI conversations. It points out how you worked, what you got done and how you used AI, with evidence, and gives one plan for tomorrow. | Yes | Skill only; needs `claude` |
| **session-playbook** | From recent sessions you pick (Claude Code and Codex), writes a task spec, know-how, skill candidates and a prompt to paste, saved as Markdown. | Yes | Yes |
| **session-compass** (screen) | Set a goal for the conversation; a pane shows each turn's progress on an LED board and warns when the conversation drifts. | Yes | No |
| **session-diary-now** (screen) | Writes today's diary from 00:00 until now, after asking. | Yes | No |
| **tomorrow's plan** (screen) | When a session starts, shows the plan from the latest diary above the prompt, once. | Yes | No |

## Install

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-session-coach@hack-user-skills
```

Open a new session after installing. Everything is off by default, except the Python check at the start of each session (below).

**Requirements:** Python 3.9 or later (tried with 3.9 and 3.14). If the computer has none, Claude says so when a session starts and asks what you want: install it for you (only when Homebrew is on the computer; no `sudo`, no administrator password), send you the install command, not now, or do not ask again. Nothing is installed until you choose. The check is `hooks/env-check.sh`; it installs nothing itself. It looks on PATH first, then where pyenv, mise, asdf and Homebrew keep Python. The hook is written for macOS and Linux (it starts with `sh`); Windows is not supported. The check is a Claude Code hook: in Codex there is none, and the skills say so themselves when `python3` is missing. The automatic diary can be turned on only on macOS, and it writes with the `claude` command logged in on this computer. If that command is not on PATH, the one inside the VS Code or Cursor Claude Code extension is used.

For Codex, `npx skills add hack-vibe-x/hack-user-skills -a codex -g -y --skill session-diary --skill session-playbook` (not tried).

## Use

| Skill | What it does |
|---|---|
| `/hack-user-skills-session-coach:session-diary` | Turn the diary on or off, show its status, read a diary to you, rewrite one |
| `/hack-user-skills-session-coach:session-playbook` | Pick several sessions from the recent list and save the result as a Markdown file |
| `/session-compass [first thought]` | Claude Code only. Turn the compass on for this session and set the conversation's goal through a short interview. With a goal set, `/session-compass <what to change>` changes it; after the goal is reached it finishes it and starts the next |
| `/session-compass-show` | Show the current goal and open the pane |
| `/session-compass-reset` | Clear the goal and the path, and turn the compass off for this session |
| `/session-diary-now` | Claude Code only. A card above the prompt asks whether to write today's diary from 00:00 until now |

You can also just ask: "turn on the session diary", "show me yesterday's diary", "pull know-how out of my sessions".

### Session diary

**When it writes:** it wakes on the hour and at login and writes the days missed since you turned it on. Days when the computer was off are written when it is back on. A day without conversations is recorded as such, without a notification.

**What is in it:** in this order, a body in everyday language, tomorrow's plan, a "My notes" section for you, the original words as evidence, and statistics (sessions, messages, active time, commits, tokens, what writing it cost). There are no scores; it compares with earlier diaries. What you write in "My notes" is read by the next diary. Goals you set that day with `/session-compass` go into the material too, with how each ended, so the diary compares what you set out to do with what happened.

**Tomorrow's plan on screen:** in Claude Code, when a session starts, the plan of the latest diary from the past week (not today's) shows above the prompt. It goes when your first turn ends or when you press **Got it**, and later sessions do not show the same plan again (the date seen is kept in `.auto/plan-seen`).

**Language:** the diary is written in the language you set when turning it on (Claude passes the language you are speaking, `--lang en` or `--lang ko`); without a setting, in the language of that day's sessions. To add a language, copy `skills/session-diary/locales/en.json` to `<code>.json` and translate it.

**Writing now, rewriting:** in Claude Code, `/session-diary-now` shows a card above the prompt: **Write now** writes today's diary from midnight up to that moment, and a day with a diary is skipped by the midnight run. If today already has one, the card says the earlier diary and your notes are thrown away and offers **Write again**. You can also ask to rewrite a diary. If it cannot be written, the earlier diary stays. The card does not turn the diary on; that stays with the `hack-user-skills-session-coach:session-diary` skill.

When today has no conversations yet, **Write now** writes nothing and says so; the day stays open and is written at midnight as usual.

**What it sends:** the diary is written with `claude -p` on this computer, but the model that writes it runs on Anthropic's servers. So turning it on **sends the conversations of every project on this computer to Anthropic**, Codex conversations included. Keys are masked only for known patterns, so secrets you put in a conversation can go out. Diaries are stored only in `~/.hus-session-coach/session-diary/`, outside your repositories.

**Cost:** if you are logged in with a subscription, it comes out of your subscription usage with no separate charge. With an API key it is billed for real. The amount in the diary is the API price `claude` reports. A day with 160-190 thousand characters of material cost about $0.7-0.9 and a day with 10 thousand characters about $0.15-0.25 (Sonnet, 2026-10-30 to 11-02, one person's records). Days without conversations do not call the AI. One call is capped at $3 at API prices.

**Permissions:** the material mixes in web pages and pasted text, so there is a risk of following hidden instructions. So the AI gets no tools and returns text only; the script does all reading and writing of files.

**Login:** tried with a subscription login (`claude` login). The automatic run does not inherit your shell's environment variables, so if you use only an API key from an environment variable it may fail as not logged in.

**Failures:** it tries again on the next hour; after 6 failures it records in that day's diary that it could not write it, and notifies you. Ask "diary status" to see the state. If launchd refuses the job when turning it on, it tries three times; if all fail it stays off and says so.

**Updates and removal:** the job runs a copy of the scripts, and each run checks the plugin it was copied from. After the plugin updates, the copy is refreshed at the next run, and in Claude Code a new session refreshes it at once (it runs `diary_auto.py sync` only when the diary is on and the copy is older). Once the plugin is uninstalled, the next run writes nothing, and the run after that (an hour later) turns the diary off and notifies you. To stop it at once, turn it off before uninstalling.

### Session playbook

Run `/hack-user-skills-session-coach:session-playbook` and the Claude Code and Codex sessions of the last two weeks appear as a numbered list with title, project, tool, time, first request and the start of the session's id. Pick several and it reads those conversations and writes one file to `~/.hus-session-coach/session-playbook/<date>-<topic>.md`: a task spec, know-how with evidence quotes (and where each goes in a skill), skill candidates (with trigger phrases, the done criterion, and the judgement left to you), and a prompt to paste into a new session. The file is written in the language you use with Claude.

**What it sends:** the conversations of the sessions you pick go into the Claude session you are using. Sessions you do not pick are not read. The file quotes parts of the conversations, so do not put it in a public repository.

**Picking:** the ids work from any conversation. The numbers mean the list this conversation made last, so a list made in another conversation does not change them.

**Limits:** Codex records give no session titles, so the first request stands in. Long sessions are shortened in the middle. Whether the know-how makes good prompts in practice has not been checked; only the list and the extraction were checked on real records.

### Session compass (Claude Code)

It is off until you run `/session-compass` in a session, and it stays on only for that session. Claude interviews you one question at a time: the destination (what you should have in hand at the end), the "done when" condition, what to avoid, and about how many steps (turns) it takes. Once you confirm the card, Claude saves it and the **Goal journey** pane opens.

After each turn a light model (Haiku) judges whether the turn moved toward the goal (▲ closer, ▶ standing still or a side road, ▼ further away) and the pane draws it on an LED board with the reason. After two turns off course a warning shows above the prompt. When it looks like the direction of the goal itself changed, the pane and the band above the prompt ask; the new goal is used only if you press **Yes, it changed**.

When the "done when" condition looks met, buttons appear above the prompt: **Finish and set a new goal**, **Finish only**, **Not yet**. Judging pauses until you pick one. Using up the estimated steps alone does not count as reaching the goal. Finished goals stay in the pane until the session ends.

**Cost:** one Haiku call per turn while a goal is set and not yet reached. No goal, no call. The turn that sets or changes the goal is not judged. Calls use the session's own login.

**What it sends:** the judge gets the goal, the last few judgements, and that turn's message, answer (shortened) and tool names. It runs on Anthropic's servers like the session itself.

**Judge log:** each judgement and your answer to an arrival or a goal change is one line in `~/.hus-session-coach/session-compass/judge-log/<project>/<session id>.jsonl`, so you can check later whether the judge was right. Parts of the conversation can appear in the reasons and goals. It is stored on this computer only, never deleted automatically, and stays after the plugin is removed.

**Language:** the pane, buttons and command replies use the language the diary is set to; otherwise Korean once you write to Claude in Korean in that session; otherwise English. The text is in `hooks/locales/`.

## What is in it

| Path | Contents |
|---|---|
| `skills/session-diary/` | The diary skill, its scripts (`diary_auto.py`, `day_sessions.py`, `check_quotes.py`, `i18n.py`), the writing rules in `references/`, and the language files in `locales/` |
| `skills/session-playbook/` | The playbook skill, its script (`sessions.py`), and the result format in `references/format.md` |
| `hooks/` | `env-check.sh` (the Python check at session start; it installs nothing, tests in `test_env_check.py`) and the Claude Code mod: `hooks.json` runs the check and lists `session-coach.tsx`, which holds `session-compass.tsx` (commands, tools, pane, judge) and `session-diary.tsx` (`/session-diary-now` and its card, the plan shown at the start, and the sync of the job's copy; it runs `skills/session-diary/scripts/diary_auto.py`). Screen text is in `locales/en.json` and `locales/ko.json` |
| `types/index.d.ts` | The types of the values the mod keeps for the session |
| `tests/` | Tests of the mod, run with `claude plugin test` |

Tests (fake records and a fake HOME only; they never register a launchd job):

```bash
(cd skills/session-diary/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_day_sessions test_diary_auto)
(cd skills/session-playbook/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_sessions)
(cd hooks && python3 -m unittest -v test_env_check)
claude plugin test .
```

## What it creates

| Where | What | How to remove |
|---|---|---|
| `~/.hus-session-coach/session-diary/` | Diaries, one `<date>.md` per day. Your documents | Delete the folder after turning the diary off |
| `~/.hus-session-coach/session-diary/.auto/` | `state.json` (settings, and where the copy came from), `lock`, `app/` (the copy of the scripts the job runs), `plan-seen` (the date of the last plan shown on screen), `logs/auto.log` and `logs/launchd.log` | Deleted with the folder above |
| `~/.hus-session-coach/session-playbook/` | Know-how files `<date>-<topic>.md` and `.last-list.json` (each conversation's last list, kept two weeks) | Delete the folder |
| `~/.hus-session-coach/session-compass/judge-log/<project>/<session id>.jsonl` | The compass judge log, one file per session | Delete the folder |
| `~/.hus-session-coach/no-env-check` | Only if you choose "do not ask again": an empty file that stops the Python check | Delete the file |
| launchd job `io.github.hack-vibe-x.hus-session-coach.session-diary` and `~/Library/LaunchAgents/io.github.hack-vibe-x.hus-session-coach.session-diary.plist` | Runs the diary on the hour and at login | Turn it off: say "turn off the session diary", or run `python3 ~/.hus-session-coach/session-diary/.auto/app/scripts/diary_auto.py off` |

The mod also keeps the goal, the path, the diary card, the plan on screen and the screen language as session values of `hack-user-skills-session-coach` (`compass`, `diary`, `lang`), held by Claude Code for that session only. On disk it writes only the judge log and `plan-seen`, and through `diary_auto.py sync` the job's copy.

Environment variables it reads: `HUS_SESSION_COACH_HOME` (moves `~/.hus-session-coach`, the judge log included), `HUS_SESSION_COACH_CLAUDE_DIR` and `HUS_SESSION_COACH_CODEX_DIR` (where the session records are read from), `HUS_SESSION_COACH_LABEL` (used by the tests).

To remove the plugin:

1. **Turn the diary off first.** Otherwise the job notices the plugin is gone and turns itself off within about two hours, writing nothing in between. Use the command in the table above.
2. **Uninstall the plugin:** `claude plugin uninstall hack-user-skills-session-coach@hack-user-skills`
3. **To delete the records too,** delete `~/.hus-session-coach`. It is not deleted automatically.

### Moving from hack-users-for-llms

These skills used to be in the `hack-users-for-llms` plugin, which keeps using its own folders (`~/.session-diary`, `~/.session-playbook`) and its own job (`co.hack-users-for-llms.session-diary`). The two diaries must not run at once, so turning this one on stops with a message while the old one is on. Turn the old one off first:

```bash
python3 ~/.session-diary/.auto/app/scripts/diary_auto.py off
```

To keep your earlier diaries and playbook files, ask "move my old diaries over", or run the command below yourself, where `<plugin>` is this plugin's folder (the next diaries then compare with them). `--dry-run` lists what would be copied; nothing is overwritten, and the diary language and model come along when this one has none set:

```bash
python3 <plugin>/skills/session-diary/scripts/diary_auto.py migrate --dry-run
python3 <plugin>/skills/session-diary/scripts/diary_auto.py migrate
```

Then turn this diary on. The old folders are left as they are, and the old judge logs in `~/.hack-mode/` are not copied (they hold the criteria card's lines too).

The screen features moved here too: `/compass` became `/session-compass` (and `/compass-show`, `/compass-reset` became `/session-compass-show`, `/session-compass-reset`), and `/session-diary-now` keeps its name. `/hack-mode` is gone: the compass turns on by running `/session-compass` in a session, and the diary is turned on with the skill. The old judge logs stay in `~/.hack-mode/` and are not moved. If both plugins are installed, two `/session-diary-now` commands and two compasses exist; remove or disable the old plugin.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# 한국어

AI와 한 작업 세션을 돌아보는 플러그인입니다. Claude Code와 Codex에서 씁니다. 스킬이 둘 들어 있습니다. 전날 세션으로 매일 자정에 쓰는 세션 일기, 고른 세션에서 노하우와 바로 붙여 쓸 프롬프트를 뽑는 세션 플레이북입니다. Claude Code에서는 화면 기능이 더 있습니다. 정한 목표를 향한 대화의 진척을 보여 주는 compass 패널, 오늘 일기를 지금 쓰는 카드, 세션을 시작할 때 보여 주는 최신 일기의 계획입니다.

| 스킬 | 하는 일 | Claude Code | Codex |
|---|---|---|---|
| **session-diary** | 켜 두면 매일 자정에 전날 AI 대화를 읽어 일기를 씁니다. 일하는 방식, 성과, AI 활용 수준을 근거와 함께 짚고 내일의 계획 하나를 줍니다. | O | 스킬만. `claude` 필요 |
| **session-playbook** | 최근 세션(Claude Code, Codex) 중 고른 것에서 작업 명세, 노하우, 스킬 후보, 붙여 쓸 프롬프트를 뽑아 md로 저장합니다. | O | O |
| **session-compass** (화면) | 대화의 목표를 정하면 패널이 턴마다 진척을 LED 판에 찍고, 대화가 벗어나면 알립니다. | O | X |
| **session-diary-now** (화면) | 물어본 뒤 0시부터 지금까지로 오늘 일기를 씁니다. | O | X |
| **내일의 계획** (화면) | 세션을 시작할 때 최신 일기의 계획을 입력창 위에 한 번 보여 줍니다. | O | X |

## 설치

```
/plugin marketplace add hack-vibe-x/hack-user-skills
/plugin install hack-user-skills-session-coach@hack-user-skills
```

설치한 뒤 새 세션을 엽니다. 기본은 모두 꺼져 있습니다. 다만 세션을 시작할 때 하는 Python 점검(아래)은 켜진 채로 돕니다.

**필요한 것:** Python 3.9 이상(3.9와 3.14에서 시험함). 컴퓨터에 없으면 세션을 시작할 때 Claude가 알리고 무엇을 할지 묻습니다: 대신 설치(Homebrew가 있을 때만, `sudo`와 관리자 비밀번호 없이), 설치 명령 보내 주기, 지금은 넘어가기, 다시 묻지 않기. 고르기 전에는 아무것도 설치하지 않습니다. 점검은 `hooks/env-check.sh`가 하고, 이 스크립트는 아무것도 설치하지 않습니다. PATH를 먼저 보고, 없으면 pyenv, mise, asdf, Homebrew가 Python을 두는 곳도 찾아봅니다. 훅은 macOS와 Linux용입니다(`sh`로 시작). Windows는 지원하지 않습니다. 이 점검은 Claude Code 훅이라 Codex에는 없고, `python3`가 없으면 스킬이 직접 알려 줍니다. 자동 일기는 macOS에서만 켤 수 있고, 이 컴퓨터에 로그인된 `claude` 명령으로 씁니다. 이 명령이 PATH에 없으면 VS Code나 Cursor의 Claude Code 확장 안에 있는 것을 씁니다.

Codex는 `npx skills add hack-vibe-x/hack-user-skills -a codex -g -y --skill session-diary --skill session-playbook`로 받습니다(확인하지 못함).

## 쓰는 법

| 스킬 | 하는 일 |
|---|---|
| `/hack-user-skills-session-coach:session-diary` | 일기 켜기, 끄기, 상태 보기, 읽어 주기, 다시 쓰기 |
| `/hack-user-skills-session-coach:session-playbook` | 최근 세션 목록에서 여러 개를 골라 md 파일로 저장 |
| `/session-compass [처음 생각]` | Claude Code 전용. 이 세션에서 compass를 켜고 짧은 인터뷰로 대화의 목표를 정합니다. 목표가 있으면 `/session-compass <고칠 내용>`으로 고치고, 목표를 달성한 뒤에는 완료하고 다음 목표를 정합니다 |
| `/session-compass-show` | 지금 목표를 보고 패널을 엽니다 |
| `/session-compass-reset` | 목표와 경로를 지우고 이 세션에서 compass를 끕니다 |
| `/session-diary-now` | Claude Code 전용. 0시부터 지금까지로 오늘 일기를 쓸지 입력창 위 카드로 묻습니다 |

말로 요청해도 됩니다("세션 일기 켜줘", "어제 일기 보여줘", "세션에서 노하우 뽑아줘").

### 세션 일기

**쓰는 때:** 매 정각과 로그인 때 깨어나, 켠 날 이후 빠진 날을 씁니다. 컴퓨터가 꺼져 있던 날은 다음에 켜질 때 씁니다. 대화가 없던 날은 없었다고 남기고 알리지 않습니다.

**담기는 것:** 일상 언어로 쓴 본문, 내일의 계획, 내 메모 칸, 원문 근거, 통계(세션, 발화, 활동 시간, 커밋, 토큰, 쓰는 데 든 비용) 순서입니다. 점수는 매기지 않고 지난 일기와 비교합니다. 내 메모에 쓴 글은 다음 일기가 읽습니다. 그날 `/session-compass`로 정한 목표와 각 목표가 어떻게 끝났는지도 재료에 들어가서, 일기가 하려던 것과 실제로 된 것을 견줍니다.

**화면에 뜨는 내일의 계획:** Claude Code에서 세션을 시작하면 지난 일주일 안의 최신 일기(오늘 일기는 빼고)의 계획이 입력창 위에 뜹니다. 첫 턴이 끝나거나 **확인**을 누르면 사라지고, 같은 계획은 다음 세션에서 다시 뜨지 않습니다(본 날짜를 `.auto/plan-seen`에 남깁니다).

**언어:** 켤 때 정한 언어로 씁니다(Claude가 지금 쓰는 말에 맞춰 `--lang ko`나 `--lang en`을 넘깁니다). 정하지 않았으면 그날 세션의 언어로 씁니다. 언어를 더하려면 `skills/session-diary/locales/en.json`을 `<코드>.json`으로 복사해 번역하면 됩니다.

**지금 쓰기, 다시 쓰기:** Claude Code에서 `/session-diary-now`를 부르면 입력창 위에 카드가 뜹니다. **지금 쓰기**를 누르면 0시부터 그 시점까지로 오늘 일기를 쓰고, 일기가 있는 날은 자정 자동 쓰기가 건너뜁니다. 오늘 일기가 이미 있으면 이전 일기와 내 메모가 폐기된다고 알리고 **다시 쓰기**를 보여 줍니다. 말로 다시 써 달라고 해도 됩니다. 쓰지 못하면 이전 일기는 그대로 남습니다. 카드는 일기를 켜지 않습니다. 켜기는 `hack-user-skills-session-coach:session-diary` 스킬이 합니다.

오늘 대화가 아직 없으면 **지금 쓰기**는 아무것도 쓰지 않고 그렇다고 알려 줍니다. 그날은 닫히지 않고 평소처럼 자정에 써집니다.

**보내는 것:** 일기는 이 컴퓨터의 `claude -p`로 쓰지만, 글을 쓰는 모델은 Anthropic 서버에서 돕니다. 그래서 켜면 **이 컴퓨터의 모든 프로젝트 대화를 Anthropic으로 보냅니다.** Codex 대화도 포함됩니다. 키는 정해진 패턴만 가리므로 대화에 넣은 비밀값이 나갈 수 있습니다. 일기는 저장소 밖 `~/.hus-session-coach/session-diary/`에만 저장합니다.

**비용:** 구독으로 로그인했다면 별도 청구 없이 구독 사용량에서 차감됩니다. API 키로 쓰면 실제 요금이 나갑니다. 일기에 적히는 금액은 `claude`가 알려 주는 API 요금 환산치입니다. 재료 16~19만 자인 날 약 $0.7~0.9, 1만 자인 날 약 $0.15~0.25였습니다(Sonnet, 2026-10-30~11-02, 한 사람 기록). 대화가 없는 날은 AI를 부르지 않습니다. 호출 한 번의 상한은 환산치 $3입니다.

**권한:** 재료에는 웹 글이나 붙여넣은 글이 섞여 있어 숨은 지시를 따를 위험이 있습니다. 그래서 AI는 도구 없이 글만 돌려주고, 파일 읽기와 쓰기는 스크립트가 합니다.

**로그인:** 구독 로그인(`claude` 로그인)에서 확인했습니다. 자동 실행은 셸의 환경 변수를 물려받지 않으므로, 환경 변수에 둔 API 키로만 쓰고 있다면 로그인 실패로 쓰지 못할 수 있습니다.

**실패:** 다음 정각에 다시 시도하고, 6번 실패하면 그날 일기에 쓰지 못했다고 남기고 알립니다. 상태는 "일기 상태"라고 물어보면 됩니다. 켤 때 launchd가 작업을 받지 않으면 세 번까지 다시 시도하고, 모두 실패하면 꺼진 채로 두고 그렇다고 알립니다.

**업데이트와 제거:** 자동 실행은 스크립트 복사본으로 돌고, 돌 때마다 복사해 온 플러그인을 확인합니다. 플러그인이 업데이트되면 다음 실행 때 복사본을 새로 고치고, Claude Code에서는 새 세션을 열 때 바로 고칩니다(일기가 켜져 있고 복사본이 옛 버전일 때만 `diary_auto.py sync`를 실행합니다). 플러그인을 지우면 다음 실행은 아무것도 쓰지 않고, 그다음 실행(한 시간 뒤)에서 일기를 끄고 알립니다. 바로 멈추려면 지우기 전에 일기를 끕니다.

### 세션 플레이북

`/hack-user-skills-session-coach:session-playbook`을 부르면 최근 2주의 Claude Code와 Codex 세션이 제목, 프로젝트, 도구, 시각, 첫 요청, 세션 id 앞부분과 함께 번호 목록으로 나옵니다. 여러 개를 고르면 그 대화를 읽어 작업 명세, 근거 인용이 붙은 노하우(스킬의 어느 칸으로 갈지 포함), 스킬로 만들 만한 후보(켜는 말, 다 됐다의 기준, 사람에게 남길 판단 포함), 새 세션에 붙여 쓸 프롬프트를 한 파일로 `~/.hus-session-coach/session-playbook/<날짜>-<주제>.md`에 저장합니다. 파일은 Claude와 쓰는 말로 씁니다.

**보내는 것:** 고른 세션의 대화가 지금 쓰는 Claude 세션으로 들어갑니다. 고르지 않은 세션은 읽지 않습니다. 파일에 대화 일부가 인용되므로 공개 저장소에 올리지 마세요.

**고르기:** id는 어느 대화에서든 통합니다. 번호는 이 대화에서 마지막으로 만든 목록의 번호라서, 다른 대화에서 목록을 새로 만들어도 바뀌지 않습니다.

**한계:** Codex 기록에는 세션 제목이 없어 첫 요청으로 대신합니다. 긴 세션은 가운데를 줄여 읽습니다. 만든 노하우가 실제로 좋은 프롬프트가 되는지는 확인하지 못했습니다. 목록과 본문 뽑기만 실제 기록으로 확인했습니다.

### 세션 compass (Claude Code)

세션에서 `/session-compass`를 부르기 전에는 꺼져 있고, 켜도 그 세션에서만 켜집니다. Claude가 질문을 하나씩 하며 도착점(끝났을 때 손에 쥐고 있어야 할 것), "다 됐다"의 기준, 하지 말 것, 대략의 걸음 수(턴)를 정합니다. 카드를 확인하면 Claude가 저장하고 **목표 여정** 패널이 열립니다.

턴이 끝날 때마다 가벼운 모델(Haiku)이 그 턴이 목표에 가까워졌는지 판정하고(▲ 가까워짐, ▶ 제자리/옆길, ▼ 멀어짐), 패널이 이유와 함께 LED 판에 찍습니다. 2턴 연속 벗어나면 입력창 위에 알립니다. 목표의 방향 자체가 바뀐 것 같으면 패널과 입력창 위에서 묻고, **바뀐 게 맞아요**를 눌러야 새 목표로 바뀝니다.

"다 됐다"의 기준을 채운 것으로 판정되면 입력창 위에 버튼이 뜹니다. **완료하고 새 목표 정하기**, **완료만**, **아직이에요** 중에서 고르며, 고를 때까지 판정을 쉽니다. 예상 걸음 수를 다 썼다는 것만으로는 달성으로 치지 않습니다. 완료한 목표는 세션이 끝날 때까지 패널에 남습니다.

**비용:** 목표가 있고 아직 달성 전인 동안 턴마다 Haiku를 한 번 부릅니다. 목표가 없으면 부르지 않습니다. 목표를 정하거나 고친 턴은 판정하지 않습니다. 세션의 로그인으로 부릅니다.

**보내는 것:** 판정 모델은 목표, 최근 판정 몇 개, 그 턴의 메시지와 답변(줄인 것), 쓴 도구 이름을 받습니다. 세션 자체와 마찬가지로 Anthropic 서버에서 돕니다.

**판정 기록:** 판정과, 달성 판정과 목표 전환에 고른 답을 한 줄씩 `~/.hus-session-coach/session-compass/judge-log/<프로젝트>/<세션 id>.jsonl`에 남깁니다. 판정이 맞았는지 나중에 되짚는 용도입니다. 대화 일부가 이유와 목표 문장에 섞일 수 있습니다. 이 컴퓨터에만 저장하고 자동으로 지우지 않으며, 플러그인을 지워도 남습니다.

**언어:** 패널, 버튼, 명령 답은 일기에 정한 언어를 따르고, 없으면 그 세션에서 Claude에게 한국어로 쓰면 한국어, 그 밖에는 영어로 나옵니다. 글자는 `hooks/locales/`에 있습니다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `skills/session-diary/` | 일기 스킬, 스크립트(`diary_auto.py`, `day_sessions.py`, `check_quotes.py`, `i18n.py`), `references/`의 쓰는 규칙, `locales/`의 언어 파일 |
| `skills/session-playbook/` | 플레이북 스킬, 스크립트(`sessions.py`), `references/format.md`의 결과 형식 |
| `hooks/` | `env-check.sh`(세션을 시작할 때 하는 Python 점검. 아무것도 설치하지 않으며 테스트는 `test_env_check.py`)와 Claude Code mod. `hooks.json`이 점검을 실행하고 `session-coach.tsx`를 가리키고, 그 안에 `session-compass.tsx`(명령, 도구, 패널, 판정)와 `session-diary.tsx`(`/session-diary-now`와 카드, 시작할 때 보여 주는 계획, 자동 실행 복사본 갱신. `skills/session-diary/scripts/diary_auto.py`를 실행)가 있습니다. 화면 글자는 `locales/en.json`, `locales/ko.json` |
| `types/index.d.ts` | mod가 세션 동안 들고 있는 값의 형식 |
| `tests/` | mod 시험. `claude plugin test`로 돌립니다 |

시험(가짜 기록과 가짜 HOME만 씁니다. launchd 작업을 등록하지 않습니다):

```bash
(cd skills/session-diary/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_day_sessions test_diary_auto)
(cd skills/session-playbook/scripts && HOME="$(mktemp -d)" python3 -m unittest -v test_sessions)
(cd hooks && python3 -m unittest -v test_env_check)
claude plugin test .
```

## 만드는 것

| 위치 | 내용 | 지우는 법 |
|---|---|---|
| `~/.hus-session-coach/session-diary/` | 일기. 하루에 `<날짜>.md` 하나. 사용자 문서입니다 | 일기를 끈 뒤 폴더를 지웁니다 |
| `~/.hus-session-coach/session-diary/.auto/` | `state.json`(설정, 복사본을 가져온 곳), `lock`, `app/`(자동 실행이 쓰는 스크립트 복사본), `plan-seen`(화면에 마지막으로 보여 준 계획의 날짜), `logs/auto.log`, `logs/launchd.log` | 위 폴더와 함께 지워집니다 |
| `~/.hus-session-coach/session-playbook/` | 노하우 파일 `<날짜>-<주제>.md`, `.last-list.json`(대화마다 마지막 목록, 2주 보관) | 폴더를 지웁니다 |
| `~/.hus-session-coach/session-compass/judge-log/<프로젝트>/<세션 id>.jsonl` | compass 판정 기록. 세션마다 파일 하나 | 폴더를 지웁니다 |
| `~/.hus-session-coach/no-env-check` | "다시 묻지 않기"를 고를 때만: Python 점검을 멈추는 빈 파일 | 파일을 지웁니다 |
| launchd 작업 `io.github.hack-vibe-x.hus-session-coach.session-diary`와 `~/Library/LaunchAgents/io.github.hack-vibe-x.hus-session-coach.session-diary.plist` | 매 정각과 로그인 때 일기를 씁니다 | 끄기: "세션 일기 꺼줘"라고 하거나 `python3 ~/.hus-session-coach/session-diary/.auto/app/scripts/diary_auto.py off`를 실행합니다 |

mod는 목표, 경로, 일기 카드, 화면에 뜬 계획, 화면 언어를 `hack-user-skills-session-coach`의 세션 값(`compass`, `diary`, `lang`)으로 들고 있습니다. Claude Code가 그 세션 동안만 들고 있습니다. 디스크에는 판정 기록과 `plan-seen`만 쓰고, `diary_auto.py sync`를 통해 자동 실행 복사본을 고칩니다.

읽는 환경 변수: `HUS_SESSION_COACH_HOME`(`~/.hus-session-coach` 위치를 바꿈, 판정 기록 포함), `HUS_SESSION_COACH_CLAUDE_DIR`, `HUS_SESSION_COACH_CODEX_DIR`(세션 기록을 읽는 곳), `HUS_SESSION_COACH_LABEL`(시험용).

플러그인을 지우려면:

1. **일기를 먼저 끕니다.** 끄지 않으면 자동 실행이 플러그인이 없어진 것을 알아채고 두 시간쯤 안에 스스로 꺼지며, 그 사이에는 아무것도 쓰지 않습니다. 위 표의 명령을 씁니다.
2. **플러그인을 지웁니다:** `claude plugin uninstall hack-user-skills-session-coach@hack-user-skills`
3. **기록까지 지우려면** `~/.hus-session-coach`를 지웁니다. 자동으로 지워지지 않습니다.

### hack-users-for-llms에서 옮겨 올 때

이 스킬들은 원래 `hack-users-for-llms` 플러그인에 있었습니다. 그 플러그인은 계속 자기 폴더(`~/.session-diary`, `~/.session-playbook`)와 자기 작업(`co.hack-users-for-llms.session-diary`)을 씁니다. 두 일기가 함께 돌면 안 되므로, 옛 일기가 켜져 있으면 이 일기는 켜지지 않고 안내만 합니다. 옛 일기를 먼저 끕니다.

```bash
python3 ~/.session-diary/.auto/app/scripts/diary_auto.py off
```

지난 일기와 플레이북 파일을 이어 쓰려면 "옛 일기 옮겨 줘"라고 하거나 아래 명령을 직접 실행합니다. `<플러그인>`은 이 플러그인의 폴더입니다(다음 일기가 지난 일기와 비교합니다). `--dry-run`은 복사할 것만 보여 줍니다. 덮어쓰는 것은 없고, 이 일기에 언어와 모델 설정이 없으면 옛 설정도 가져옵니다.

```bash
python3 <플러그인>/skills/session-diary/scripts/diary_auto.py migrate --dry-run
python3 <플러그인>/skills/session-diary/scripts/diary_auto.py migrate
```

그다음 이 일기를 켭니다. 옛 폴더는 그대로 두며, `~/.hack-mode/`의 옛 판정 기록은 옮기지 않습니다(기준 카드의 기록이 섞여 있습니다).

화면 기능도 옮겨 왔습니다. `/compass`는 `/session-compass`가 되었고(`/compass-show`, `/compass-reset`은 `/session-compass-show`, `/session-compass-reset`), `/session-diary-now`는 이름이 그대로입니다. `/hack-mode`는 없어졌습니다. compass는 세션에서 `/session-compass`를 부르면 켜지고, 일기는 스킬로 켭니다. 옛 판정 기록은 `~/.hack-mode/`에 그대로 남고 옮기지 않습니다. 두 플러그인을 함께 설치하면 `/session-diary-now`와 compass가 두 벌 생기므로 옛 플러그인을 지우거나 끕니다.

## 라이선스

Apache License 2.0입니다. `LICENSE`와 `NOTICE`를 보세요.
