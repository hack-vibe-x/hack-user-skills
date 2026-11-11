import { expect, test } from 'claude-code/testing'

import { BAND, engine, run, start, turnEnd, verdict, withGoal } from './engine'

const SCRIPT = '/skills/session-diary/scripts/diary_auto.py'

test('nothing runs until /session-diary-now', async ($, on) => {
  const eng = engine(on)
  await start($)
  await $.turn.complete(turnEnd(1, 'hi'))
  expect(eng.argv).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ key: 'diary-write' })).toBeFalsy()
  await band.unmount()
})

test("/session-diary-now asks first; agreeing runs this plugin's script with write --force", async ($, on) => {
  const eng = engine(on)
  await start($)
  const asked = await run($, 'session-diary-now')
  expect(asked.text).toContain('Nothing is written unless they choose to')
  expect(eng.argv.map(a => a.slice(2).join(' '))).toEqual(['status --json'])

  const card = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await card.find({ type: 'Text', text: /Write today now\?/ })).toBeTruthy()
  expect(await card.find({ type: 'Text', text: /Today ends here/ })).toBeTruthy()
  expect(await card.find({ type: 'Text', text: /^Uses AI\.$/ })).toBeTruthy()
  await card.press({ key: 'diary-write' })
  await card.unmount()

  const write = eng.argv[1] ?? []
  expect(write[0]).toBe('python3')
  expect(write[1]?.endsWith(SCRIPT)).toBe(true)
  expect(write[1]?.includes('..')).toBe(false)
  expect(write.slice(2)).toEqual(['write', '--force'])
  expect(eng.toasts).toEqual(['Writing.', 'Written.'])

  const after = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await after.find({ key: 'diary-write' })).toBeFalsy()
  await after.unmount()
})

test('with the diary on, saying no leaves it to midnight and writes nothing', async ($, on) => {
  const eng = engine(on, { diary: { isOn: true } })
  await start($)
  await run($, 'session-diary-now')
  const card = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await card.find({ type: 'Text', text: /Else written at midnight/ })).toBeTruthy()
  await card.press({ key: 'diary-later' })
  await card.unmount()
  expect(eng.argv.map(a => a.slice(2).join(' '))).toEqual(['status --json'])
})

test('a diary already written today is replaced only after the warning', async ($, on) => {
  const eng = engine(on, { diary: { isOn: true, isTodayWritten: true } })
  await start($)
  await run($, 'session-diary-now')
  const card = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await card.find({ type: 'Text', text: /Write today again\?/ })).toBeTruthy()
  expect(await card.find({ type: 'Text', text: /thrown away/ })).toBeTruthy()
  await card.press({ key: 'diary-write' })
  await card.unmount()
  expect(eng.argv.map(a => a.slice(2).join(' '))).toEqual(['status --json', 'write --force'])
})

test('a failed write says why', async ($, on) => {
  const eng = engine(on, { diary: { isWriteRefused: true } })
  await start($)
  await run($, 'session-diary-now')
  const card = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await card.press({ key: 'diary-write' })
  await card.unmount()
  expect(eng.toasts[eng.toasts.length - 1]).toBe('Failed: [hus-session-coach] Could not write it: busy')
})

test('the diary card comes before the compass band, which returns after it', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true })] })
  const turn = await withGoal($, eng)
  await turn(2)
  await run($, 'session-diary-now')
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ key: 'diary-write' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeFalsy()
  await band.press({ key: 'diary-later' })
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeTruthy()
  await band.unmount()
})
