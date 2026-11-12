import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diary, Plan } from '../types'
import { clip, dataHome, reply, strings } from './shared'
import type { T } from './shared'

// session-diary-now: a card above the prompt that offers to write today's session diary from 00:00 until now,
// and asks before replacing one already written. Writing is done by this plugin's own diary script.
// Turning the automatic diary on and off stays with the hack-user-skills-session-coach:session-diary skill.
//
// Also, at the start of a session: "tomorrow's plan" from the latest diary before today, shown above the prompt
// once (until the first turn ends or the person presses "Got it"), and, when the automatic diary is on and its
// copy of the scripts is older than this plugin, `diary_auto.py sync` so the job runs this version.

const DIARY_SCRIPT = 'skills/session-diary/scripts/diary_auto.py'
const DIARY_TIMEOUT_MS = 10 * 60 * 1000
const SYNC_TIMEOUT_MS = 60 * 1000
// diary_auto.py write exits with this when today has no conversations yet.
const NOTHING_TO_WRITE = 3
// Paths under the plugin's home folder, as the diary script keeps them.
const DIARY_DIR = 'session-diary'
const DIARY_STATE = 'session-diary/.auto/state.json'
// The date of the last diary whose plan was seen, so later sessions do not show it again.
const PLAN_SEEN = 'session-diary/.auto/plan-seen'
const DIARY_NAME = /^(\d{4}-\d\d-\d\d)\.md$/
// A plan older than this is not brought up.
const PLAN_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const EMPTY: Diary = { isAsking: false, isOn: false, isTodayWritten: false, isWriting: false, plan: null }

// Bump the tag when Diary changes shape: older stored values read as EMPTY.
export const diary = atom({ plugin: 'hack-user-skills-session-coach', key: 'diary' } as const, EMPTY, {
  shape: 'diary-2',
})

function runDiary($: EngineInterface, args: string[], timeoutMs = DIARY_TIMEOUT_MS) {
  return $.process.run(['python3', `${$.plugin.root}/${DIARY_SCRIPT}`, ...args], { timeoutMs })
}

const pad = (n: number) => String(n).padStart(2, '0')
// The local date, as the diary script names its files.
const localDay = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function readJson($: EngineInterface, path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    const value = JSON.parse(await $.fs.read(path))

    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------- tomorrow's plan ----------

// The front matter's `plan:` line, as diary_auto.py writes it ("plan" in quotes, inner quotes escaped).
function planOf(text: string): string {
  const head = text.startsWith('---') ? text.slice(0, text.indexOf('\n---', 3) + 1 || 600) : ''
  if (/^failed:\s*true\s*$/m.test(head)) return ''
  const found = head.match(/^plan:\s*"?(.*?)"?\s*$/m)

  return found ? (found[1] ?? '').replace(/\\"/g, '"').trim() : ''
}

// The plan of the latest diary from the last week before today; a day without one (no conversations, a
// failed run) is passed over for the day before it. Null when there is none, or it was seen already.
async function latestPlan($: EngineInterface): Promise<Plan | null> {
  const home = await dataHome($)
  if (!home) return null
  let names: string[]
  try {
    names = (await $.fs.list(`${home}/${DIARY_DIR}`)).filter(e => e.kind === 'file').map(e => e.name)
  } catch {
    return null
  }
  const now = await $.clock.now()
  const today = localDay(now)
  const since = localDay(now - PLAN_DAYS * DAY_MS)
  const dates = names
    .map(n => n.match(DIARY_NAME)?.[1])
    .filter((d): d is string => !!d && d < today && d >= since)
    .sort()
    .reverse()
  let seen = ''
  try {
    if (await $.fs.exists(`${home}/${PLAN_SEEN}`)) seen = (await $.fs.read(`${home}/${PLAN_SEEN}`)).trim()
  } catch {
    // Not seen.
  }
  for (const date of dates) {
    let text = ''
    try {
      text = planOf(await $.fs.read(`${home}/${DIARY_DIR}/${date}.md`))
    } catch {
      continue
    }
    if (!text) continue
    if (date <= seen) return null

    return { date, text: clip(text, 200), isSeen: false }
  }

  return null
}

async function markPlanSeen($: EngineInterface, plan: Plan) {
  try {
    const home = await dataHome($)
    if (home) await $.fs.write(`${home}/${PLAN_SEEN}`, `${plan.date}\n`)
  } catch {
    // Shown again next session; nothing else changes.
  }
}

// From the module's prompt.submit, for the person's own prompts: a plan on screen counts as seen.
export async function diaryPrompt($: EngineInterface) {
  const { plan } = await read($, diary)
  if (!plan || plan.isSeen) return
  await update($, diary, cur => (cur.plan ? { ...cur, plan: { ...cur.plan, isSeen: true } } : cur))
  await markPlanSeen($, plan)
}

async function dismissPlan($: EngineInterface) {
  const { plan } = await read($, diary)
  await update($, diary, cur => ({ ...cur, plan: null }))
  if (plan && !plan.isSeen) await markPlanSeen($, plan)
}

function planBand($: EngineInterface, t: T, els: Record<string, any>, plan: Plan) {
  const { Box, Text, Button } = els
  const [, month, day] = plan.date.split('-').map(Number)
  const date = t('date.month_day', { month: month ?? '', day: day ?? '' })

  return (
    <Box flexDirection="row" gap={1}>
      <Text color="#7aa2f7">{t('diary.plan.band', { date, plan: plan.text })}</Text>
      <Button key="plan-ok" label={t('diary.plan.ok')} onPress={() => dismissPlan($)} />
    </Box>
  )
}

// ---------- the copy the automatic diary runs ----------

// "0.10.0" is newer than "0.9.1". A copy with no version recorded is older than any.
const isNewer = (version: string, than: unknown) => {
  if (typeof than !== 'string') return true
  const a = version.split('.').map(n => parseInt(n, 10) || 0)
  const b = than.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }

  return false
}

// The automatic diary runs a copy of the scripts made when it was turned on. After the plugin updates, bring
// that copy up to this version; the script itself does the copying. Nothing runs while the diary is off.
async function syncCopy($: EngineInterface) {
  const home = await dataHome($)
  if (!home) return
  const state = await readJson($, `${home}/${DIARY_STATE}`)
  if (!state?.since) return
  const version = (await readJson($, `${$.plugin.root}/.claude-plugin/plugin.json`))?.version
  if (typeof version !== 'string' || !isNewer(version, state.app_version)) return
  await runDiary($, ['sync'], SYNC_TIMEOUT_MS)
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
  // Exit code 3: no conversations yet today, so nothing was written and the day stays open for midnight.
  const isEmpty = !!res && res.exitCode === NOTHING_TO_WRITE
  await update($, diary, cur => ({ ...cur, isWriting: false, isTodayWritten: isWritten || cur.isTodayWritten }))
  $.ui.toast(
    isWritten
      ? t('diary.toast.written')
      : isEmpty
        ? t('diary.toast.empty')
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
  const plan = await latestPlan($)
  await update($, diary, cur => ({ ...cur, plan }))
  // Outside the start, so the session does not wait on python3.
  $.clock.after(1, () => {
    void syncCopy($).catch(() => undefined)
  })
}

// The diary's part of the seat above the prompt, or null when no card is up.
export async function diaryBand($: EngineInterface, e: any) {
  const d = await read($, diary)
  if (!d.isAsking) return null

  return card($, await strings($), $.ui.resolve(e), d)
}

// Yesterday's plan, below everything else in the seat above the prompt; null when there is none to show.
export async function planBandFor($: EngineInterface, e: any) {
  const { plan } = await read($, diary)
  if (!plan) return null

  return planBand($, await strings($), $.ui.resolve(e), plan)
}

// From the module's turn.complete, for a turn of the main conversation: once the turn in which the plan was
// seen has ended, it leaves the seat.
export async function diaryTurnEnd($: EngineInterface) {
  if ((await read($, diary)).plan?.isSeen) await update($, diary, cur => ({ ...cur, plan: null }))
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
