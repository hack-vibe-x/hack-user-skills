import { expect, test } from 'claude-code/testing'

import { BAND, DIARIES, DIARY_STATE, NOON, PLAN_SEEN, engine, run, start, turnEnd, verdict, withGoal } from './engine'

// At the start of a session: "tomorrow's plan" from the latest diary before today, and keeping the automatic
// diary's copy of the scripts current.

const diaryFile = (plan: string, extra = '') =>
  `---\ndate: x\nsessions: 2\n${extra}${plan ? `plan: "${plan}"\n` : ''}---\n\n# Diary\n`

const at = (date: string) => `${DIARIES}/${date}.md`

test("the latest diary's plan shows above the prompt when a session starts", async ($, on) => {
  engine(on, {
    now: NOON,
    files: {
      [at('2026-11-10')]: diaryFile('An older plan'),
      [at('2026-11-11')]: diaryFile('When the AI says it is done, I run it once myself'),
    },
  })
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await band.find({ type: 'Text', text: /Plan from/ }))?.text).toBe(
    'Plan from the 11/11 diary: When the AI says it is done, I run it once myself',
  )
  expect(await band.find({ key: 'plan-ok' })).toBeTruthy()
  await band.unmount()
})

test('a diary without a plan is passed over for the one before it', async ($, on) => {
  engine(on, {
    now: NOON,
    files: {
      [at('2026-11-09')]: diaryFile('When I hand over a page, I name who reads it'),
      [at('2026-11-10')]: diaryFile('Never shown', 'failed: true\n'),
      [at('2026-11-11')]: '---\ndate: 2026-11-11\nsessions: 0\n---\n\n# No conversations\n',
    },
  })
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Plan from/ }))?.text).toContain('11/9 diary: When I hand over a page')
  await band.unmount()
})

test("no plan from today's diary or from more than a week ago, and nothing without a diary folder", async ($, on) => {
  engine(on, {
    now: NOON,
    files: {
      [at('2026-11-12')]: diaryFile("Today's own plan is for tomorrow"),
      [at('2026-11-04')]: diaryFile('Too old'),
    },
  })
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Plan from/ })).toBeFalsy()
  await band.unmount()
})

test('a plan seen in one session is not shown again in the next', async ($, on) => {
  const eng = engine(on, { now: NOON, files: { [at('2026-11-11')]: diaryFile('Ask before deleting') } })
  await start($)
  await ($ as any).prompt.submit({ text: 'first prompt' })
  expect(eng.files[PLAN_SEEN]).toBe('2026-11-11\n')

  // Still there while the turn it was seen in runs; gone when it ends.
  const during = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await during.find({ type: 'Text', text: /Plan from/ })).toBeTruthy()
  await during.unmount()
  await $.turn.complete(turnEnd(1, 'answer'))
  const after = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await after.find({ type: 'Text', text: /Plan from/ })).toBeFalsy()
  await after.unmount()

  // A new session reads the mark.
  await start($)
  const next = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await next.find({ type: 'Text', text: /Plan from/ })).toBeFalsy()
  await next.unmount()
})

test('"Got it" puts the plan away and marks it seen', async ($, on) => {
  const eng = engine(on, { now: NOON, files: { [at('2026-11-11')]: diaryFile('Ask before deleting') } })
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await band.press({ key: 'plan-ok' })
  expect(await band.find({ type: 'Text', text: /Plan from/ })).toBeFalsy()
  await band.unmount()
  expect(eng.files[PLAN_SEEN]).toBe('2026-11-11\n')
})

test('a newer diary after the seen one is shown', async ($, on) => {
  engine(on, {
    now: NOON,
    files: { [at('2026-11-11')]: diaryFile('The newer plan'), [PLAN_SEEN]: '2026-11-10\n' },
  })
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /The newer plan/ })).toBeTruthy()
  await band.unmount()
})

test('the diary card and the compass come before the plan', async ($, on) => {
  const eng = engine(on, {
    now: NOON,
    verdicts: [verdict({ done: true })],
    files: { [at('2026-11-11')]: diaryFile('Ask before deleting') },
  })
  await run($, 'session-diary-now')
  const card = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await card.find({ key: 'diary-write' })).toBeTruthy()
  expect(await card.find({ type: 'Text', text: /Plan from/ })).toBeFalsy()
  await card.press({ key: 'diary-later' })
  await card.unmount()

  const turn = await withGoal($, eng)
  await turn(2)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /Plan from/ })).toBeFalsy()
  await band.unmount()
})

test('with the diary on and an older copy of the scripts, the session start syncs it', async ($, on) => {
  const eng = engine(on, {
    pluginVersion: '0.5.0',
    files: { [DIARY_STATE]: JSON.stringify({ since: '2026-11-01', app_version: '0.4.0' }) },
  })
  await start($)
  await eng.clock.advance(10)
  expect(eng.argv.map(a => a.slice(2).join(' '))).toEqual(['sync'])
  expect(eng.argv[0]?.[1]?.endsWith('/skills/session-diary/scripts/diary_auto.py')).toBe(true)
})

test('a copy from before versions were recorded is synced too', async ($, on) => {
  const eng = engine(on, { files: { [DIARY_STATE]: JSON.stringify({ since: '2026-11-01' }) } })
  await start($)
  await eng.clock.advance(10)
  expect(eng.argv.map(a => a.slice(2).join(' '))).toEqual(['sync'])
})

const noSync = (name: string, state: Record<string, string>) =>
  test(name, async ($, on) => {
    const eng = engine(on, { pluginVersion: '0.5.0', files: { [DIARY_STATE]: JSON.stringify(state) } })
    await start($)
    await eng.clock.advance(10)
    expect(eng.argv).toEqual([])
  })

noSync('a current copy runs nothing', { since: '2026-11-01', app_version: '0.5.0' })
noSync('a newer copy (another install turned it on) is left alone', { since: '2026-11-01', app_version: '0.10.0' })
noSync('the diary off runs nothing', { app_version: '0.1.0' })
