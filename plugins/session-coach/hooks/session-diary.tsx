import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diary } from '../types'
import { clip, reply, strings } from './shared'
import type { T } from './shared'

// session-diary-now: a card above the prompt that offers to write today's session diary from 00:00 until now,
// and asks before replacing one already written. Writing is done by this plugin's own diary script.
// Turning the automatic diary on and off stays with the hack-user-skills-session-coach:session-diary skill.

const DIARY_SCRIPT = 'skills/session-diary/scripts/diary_auto.py'
const DIARY_TIMEOUT_MS = 10 * 60 * 1000

const EMPTY: Diary = { isAsking: false, isOn: false, isTodayWritten: false, isWriting: false }

export const diary = atom({ plugin: 'hack-user-skills-session-coach', key: 'diary' } as const, EMPTY, {
  shape: 'diary-1',
})

function runDiary($: EngineInterface, args: string[]) {
  return $.process.run(['python3', `${$.plugin.root}/${DIARY_SCRIPT}`, ...args], { timeoutMs: DIARY_TIMEOUT_MS })
}

const firstLine = (text: string) => clip(text.trim().split('\n')[0] ?? '', 160)

// Reads whether the automatic diary is on and today's is written. If the script cannot run, both are off.
async function refresh($: EngineInterface) {
  let status = { on: false, today_written: false }
  try {
    const res = await runDiary($, ['status', '--json'])
    if (res.exitCode === 0) status = JSON.parse(res.stdout)
  } catch {
    // Left as off.
  }

  return update($, diary, cur => ({ ...cur, isOn: status.on === true, isTodayWritten: status.today_written === true }))
}

async function writeNow($: EngineInterface) {
  const t = await strings($)
  await update($, diary, cur => ({ ...cur, isAsking: false, isWriting: true }))
  $.ui.toast(t('diary.toast.writing'))
  const res = await runDiary($, ['write', '--force']).catch(() => null)
  const isWritten = !!res && res.exitCode === 0
  await update($, diary, cur => ({ ...cur, isWriting: false, isTodayWritten: isWritten || cur.isTodayWritten }))
  $.ui.toast(
    isWritten
      ? t('diary.toast.written')
      : t('diary.toast.failed', { detail: res ? firstLine(res.stdout || res.stderr) : t('diary.failed.no_run') }),
  )
}

function card($: EngineInterface, t: T, els: Record<string, any>, d: Diary) {
  const { Box, Text, Button } = els
  const isLeftToMidnight = d.isOn && !d.isTodayWritten

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#7aa2f7" paddingX={1}>
      <Text bold color="#7aa2f7">
        {t(d.isTodayWritten ? 'diary.card.title_again' : 'diary.card.title_new')}
      </Text>
      <Text>{t(d.isTodayWritten ? 'diary.card.body_again' : 'diary.card.body_new')}</Text>
      <Text dimColor>{t(isLeftToMidnight ? 'diary.card.note_midnight' : 'diary.card.note')}</Text>
      <Box flexDirection="row" gap={1}>
        <Button
          key="diary-write"
          label={t(d.isTodayWritten ? 'diary.btn.rewrite' : 'diary.btn.write')}
          hotkey="1"
          onPress={() => writeNow($)}
        />
        <Button
          key="diary-later"
          label={t(isLeftToMidnight ? 'diary.btn.midnight' : 'diary.btn.skip')}
          hotkey="2"
          onPress={() => update($, diary, cur => ({ ...cur, isAsking: false }))}
        />
      </Box>
    </Box>
  )
}

// From the module's session.start.
export async function startDiary($: EngineInterface) {
  await $.command.register({
    name: 'session-diary-now',
    description: "Write today's session diary from 00:00 until now (asks first, and before replacing one)",
  })
}

// The diary's part of the seat above the prompt, or null when no card is up.
export async function diaryBand($: EngineInterface, e: any) {
  const d = await read($, diary)
  if (!d.isAsking) return null

  return card($, await strings($), $.ui.resolve(e), d)
}

export const registerDiary: Register = on => {

  on('command.run', { command: 'session-diary-now' }, async $ => {
    if ((await read($, diary)).isWriting) {
      return reply("Today's diary is being written already.", 'cmd.diary.busy')
    }
    await refresh($)
    await update($, diary, cur => ({ ...cur, isAsking: true }))

    return reply(
      "Showed the user a card above the prompt asking whether to write today's diary now. Nothing is written unless they choose to.",
      'cmd.diary.ask',
    )
  })
}
