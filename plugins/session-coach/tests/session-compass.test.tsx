import { expect, test } from 'claude-code/testing'

import { BAND, HANGUL_WORD, LOG, PANE, TOOL, engine, run, start, turnEnd, verdict, withGoal } from './engine'

test('off by default: no tools, no pane, no judge call until /session-compass', async ($, on) => {
  const eng = engine(on)
  await start($)
  await ($ as any).prompt.submit({ text: 'hello' })
  await $.turn.complete(turnEnd(1, 'hi'))
  await eng.clock.advance(10)
  expect(eng.calls.length).toBe(0)
  expect(eng.tools).toEqual([])
  expect(eng.panes.opened).toBe(0)

  const saved = await $.tool.call({ tool: TOOL('set_goal'), destination: 'x', done: 'y', avoid: 'z', steps: 2 })
  expect(JSON.stringify(saved)).toContain('off in this session')

  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /\(engine\)/ })).toBeTruthy()
  await band.unmount()
})

test('turned on without a goal: the pane offers to start, and turns are not judged', async ($, on) => {
  const eng = engine(on)
  await start($)
  await run($, 'session-compass')
  await eng.clock.advance(10)
  expect(eng.tools).toEqual(['set_goal', 'adjust_goal_height', 'propose_goal_change'])
  expect(eng.sent[eng.sent.length - 1]).toContain('Start an interview to set the goal')
  await $.turn.complete(turnEnd(1, 'What should you have in hand at the end?'))
  await eng.clock.advance(10)
  expect(eng.calls.length).toBe(0)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /No goal yet/ }))?.text).toBe('No goal yet')
  await ui.unmount()
})

test('a goal, two judged turns and a confirmed pivot draw on every surface', async ($, on) => {
  const eng = engine(on, {
    verdicts: [
      verdict({ reason: 'structure decided' }),
      verdict({ move: 'down', reason: 'out-of-scope design talk', pivot: true, new_destination: 'App screen mockup', carry: 1 }),
    ],
  })
  const turn = await withGoal($, eng, 4)
  await turn(2)
  await turn(3)
  expect(eng.calls.map(c => c.model)).toEqual(['haiku', 'haiku'])

  for (const surface of ['terminal', 'vscode', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Progress 0\/4/ }))?.text).toContain('Progress 0/4')
    expect(await ui.find({ type: 'Text', text: /out-of-scope design talk/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Has the goal changed/ })).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'pivot-yes' })
  expect((await ui.find({ type: 'Text', text: /App screen mockup/ }))?.text).toContain('App screen mockup')
  expect((await ui.find({ type: 'Text', text: /Progress 1\/4/ }))?.text).toContain('Progress 1/4')
  expect(await ui.find({ type: 'Text', text: /Goal changed: App screen mockup/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Has the goal changed/ })).toBeFalsy()
  await ui.unmount()
})

test('two turns off course warn above the prompt', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ move: 'flat', reason: 'side talk' }), verdict({ move: 'down', reason: 'wrong way' })] })
  const turn = await withGoal($, eng, 4)
  await turn(2)
  await turn(3)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Off course/ }))?.text).toBe('Off course: wrong way')
  await band.unmount()
})

test('an achieved goal asks to finish, stops judging, and starts the next goal', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true, reason: 'copy approved' })] })
  const turn = await withGoal($, eng)
  await turn(2)
  expect(eng.calls.length).toBe(1)

  // Waiting for the person: no more judging, whatever happens in between.
  await turn(3)
  expect(eng.calls.length).toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Reached: Landing page copy/ })).toBeTruthy()
  await band.press({ key: 'arrive-next' })
  await eng.clock.advance(10)
  expect(eng.sent[eng.sent.length - 1]).toContain('The goal just finished: "Landing page copy"')
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeFalsy()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Text', text: /No goal yet/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /Goals finished: 1/ })).toBeTruthy()
  await pane.unmount()

  // The interview can save the next goal.
  await $.tool.call({ tool: TOOL('set_goal'), destination: 'Press release draft', done: 'CEO approval', avoid: '-', steps: 3 })
  const next = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await next.find({ type: 'Text', text: /Progress 0\/3/ }))?.text).toContain('Progress 0/3')
  await next.unmount()
})

test('"not yet" keeps the goal and judging goes on', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true })] })
  const turn = await withGoal($, eng)
  await turn(2)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await band.press({ key: 'arrive-not-yet' })
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeFalsy()
  await band.unmount()

  await turn(3)
  expect(eng.calls.length).toBe(2)
  expect(eng.calls[1]?.prompt).toContain('the user confirmed the goal is not reached yet')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await pane.find({ type: 'Text', text: /Progress 1\/2/ }))?.text).toContain('Progress 1/2')
  expect(await pane.find({ type: 'Text', text: /You said: not there yet/ })).toBeTruthy()
  await pane.unmount()
})

test('"finish only" clears the goal without starting an interview', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true })] })
  const turn = await withGoal($, eng)
  await turn(2)
  const before = eng.sent.length
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await band.press({ key: 'arrive-finish' })
  await band.unmount()
  await eng.clock.advance(10)
  expect(eng.sent.length).toBe(before)
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Text', text: /Goals finished: 1/ })).toBeTruthy()
  await pane.unmount()
})

test('using up the estimated steps is not arriving', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict(), verdict(), verdict()] })
  const turn = await withGoal($, eng)
  await turn(2)
  await turn(3)
  await turn(4)
  expect(eng.calls.length).toBe(3)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeFalsy()
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await pane.find({ type: 'Text', text: /Progress 1\/2/ }))?.text).toContain('Progress 1/2')
  await pane.unmount()
})

test('/session-compass after an achieved goal finishes it and starts from the new words', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true })] })
  const turn = await withGoal($, eng)
  await turn(2)
  await run($, 'session-compass', 'Press release draft')
  await eng.clock.advance(10)
  const last = eng.sent[eng.sent.length - 1]
  expect(last).toContain('The goal just finished: "Landing page copy"')
  expect(last).toContain('What the user said first: "Press release draft"')
})

// The engine refuses a prompt.submit made while a command runs. This test catches that refusal.
test('/session-compass really starts the interview, and with words really starts a change', async ($, on) => {
  const eng = engine(on)
  await start($)
  await run($, 'session-compass')
  await eng.clock.advance(10)
  expect(eng.sent[eng.sent.length - 1]).toContain('Start an interview to set the goal')
  expect(eng.sent[eng.sent.length - 1]).toContain(TOOL('set_goal'))

  await $.tool.call({ tool: TOOL('set_goal'), destination: 'Copy', done: 'Approved', avoid: '-', steps: 2 })
  await run($, 'session-compass', 'widen the scope')
  await eng.clock.advance(10)
  expect(eng.sent[eng.sent.length - 1]).toContain('The user wants to change the goal')
  expect(eng.sent[eng.sent.length - 1]).toContain(TOOL('propose_goal_change'))
})

test('/session-compass-reset clears the goal, closes the pane and stops judging', async ($, on) => {
  const eng = engine(on)
  const turn = await withGoal($, eng)
  await run($, 'session-compass-reset')
  expect(eng.panes.closed).toBe(1)
  await turn(2)
  expect(eng.calls.length).toBe(0)
  const shown = await run($, 'session-compass-show')
  expect(shown.text).toContain('No goal yet')
  const saved = await $.tool.call({ tool: TOOL('set_goal'), destination: 'x', done: 'y', avoid: 'z', steps: 2 })
  expect(JSON.stringify(saved)).toContain('off in this session')
})

test('the model reads English command replies; the row is drawn from the language file', async ($, on) => {
  const eng = engine(on)
  await start($)
  const started = await run($, 'session-compass')
  await eng.clock.advance(10)
  expect(started.text).toBe('The goal interview starts now.')
  const row = await $.ui.mount({
    plugin: 'hack-user-skills-session-coach',
    component: 'CommandOutput',
    requestId: 'm1',
    surface: 'terminal',
    props: { command: 'session-compass', args: '', text: started.text, isErrored: false },
  })
  expect((await row.find({ type: 'Text' }))?.text).toBe('Interview starts.')
  await row.unmount()

  await $.tool.call({ tool: TOOL('set_goal'), destination: 'Copy', done: 'Approved', avoid: 'Design', steps: 2 })
  const shown = await run($, 'session-compass-show')
  expect(shown.text).toBe('Goal: Copy\nDone when: Approved\nAvoid: Design')
  const goalRow = await $.ui.mount({
    plugin: 'hack-user-skills-session-coach',
    component: 'CommandOutput',
    requestId: 'm2',
    surface: 'desktop',
    props: { command: 'session-compass-show', args: '', text: shown.text, isErrored: false },
  })
  expect((await goalRow.find({ type: 'Text' }))?.text).toBe('Goal: Copy / Approved / Design')
  await goalRow.unmount()
})

test('a Hangul prompt turns the screen Korean and asks the judge for reasons in Korean', async ($, on) => {
  const eng = engine(on)
  const turn = await withGoal($, eng)
  await turn(2, `${HANGUL_WORD} copy`)
  expect(eng.calls[0]?.system).toContain('language code: ko')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Text', text: /KO progress 1\/2/ })).toBeTruthy()
  await pane.unmount()
})

test('the diary language setting wins over the prompts', async ($, on) => {
  const eng = engine(on, {
    files: { '/home/me/.hus-session-coach/session-diary/.auto/state.json': JSON.stringify({ lang: 'ko' }) },
  })
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Text', text: /KO no goal/ })).toBeTruthy()
  await pane.unmount()
  expect(eng.calls.length).toBe(0)
})

test('an unknown or unsafe language code falls back to English', async ($, on) => {
  engine(on, {
    files: { '/home/me/.hus-session-coach/session-diary/.auto/state.json': JSON.stringify({ lang: '../x' }) },
  })
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Text', text: /^No goal yet$/ })).toBeTruthy()
  await pane.unmount()
})

test('every judgement and the answer to it land in the session log, in order', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ reason: 'headline decided' }), verdict({ done: true, reason: 'approved' })] })
  const turn = await withGoal($, eng)
  await turn(2)
  await turn(3)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await band.press({ key: 'arrive-not-yet' })
  await band.unmount()

  const log = eng.lines()
  expect(log.map(l => l.event)).toEqual(['goal-set', 'judge', 'judge', 'arrive-not-yet'])
  expect(log[1]).toMatchObject({ ok: true, model: 'haiku', kind: 'up', height: 1, rows: 2, reason: 'headline decided', goal: 'Landing page copy' })
  expect(log[1].tokens.input_tokens).toBe(10)
  expect(log[2]).toMatchObject({ kind: 'arrive', height: 2, done: true })
  expect(log[3].goal).toBe('Landing page copy')
  expect(typeof log[0].at).toBe('string')
})

test('HUS_SESSION_COACH_HOME moves the judge log', async ($, on) => {
  const eng = engine(on, { env: { HUS_SESSION_COACH_HOME: '~/coach' } })
  const turn = await withGoal($, eng)
  await turn(2)
  expect(eng.lines(LOG)).toEqual([])
  expect(eng.lines('/home/me/coach/session-compass/judge-log/-proj/s1.jsonl').map(l => l.event)).toEqual(['goal-set', 'judge'])
})

test('an unreadable verdict is logged with what came back', async ($, on) => {
  const eng = engine(on, { verdicts: ['not JSON'] })
  const turn = await withGoal($, eng)
  await turn(2)
  expect(eng.lines().find(l => l.event === 'judge')).toMatchObject({ ok: false, why: 'unparsed', text: 'not JSON' })
})

test('a log that cannot be written changes nothing else', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true })], isWriteRefused: true })
  const turn = await withGoal($, eng)
  await turn(2)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeTruthy()
  await band.unmount()
})

test("a turn started only by another plugin's prompt is not judged, and its words never reach the judge", async ($, on) => {
  const eng = engine(on)
  const turn = await withGoal($, eng)
  await ($ as any).prompt.submit({ text: 'Brief from a plugin', origin: { kind: 'plugin', name: 'other-plugin' } })
  await $.turn.complete(turnEnd(2, 'Did what the plugin asked'))
  await eng.clock.advance(10)
  expect(eng.calls.length).toBe(0)

  await turn(3, 'Words of the user')
  expect(eng.calls.length).toBe(1)
  expect(eng.calls[0]?.prompt).toContain('Words of the user')
  expect(eng.calls[0]?.prompt.includes('Brief from a plugin')).toBe(false)
})

test('"not yet" and one flat turn after it is not off course; two flat turns are', async ($, on) => {
  const eng = engine(on, {
    verdicts: [verdict({ done: true }), verdict({ move: 'flat', reason: 'side talk' }), verdict({ move: 'flat', reason: 'more side talk' })],
  })
  const turn = await withGoal($, eng)
  await turn(2)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await band.press({ key: 'arrive-not-yet' })
  await band.unmount()

  await turn(3)
  const calm = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await calm.find({ type: 'Text', text: /Off course/ })).toBeFalsy()
  await calm.unmount()

  await turn(4)
  const warned = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await warned.find({ type: 'Text', text: /Off course/ }))?.text).toBe('Off course: more side talk')
  await warned.unmount()
})

test('a judge call that throws leaves a note, and the next turn is judged again', async ($, on) => {
  const eng = engine(on, { isJudgeBroken: true })
  const turn = await withGoal($, eng)
  await turn(2)
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Text', text: /Could not judge turn 2/ })).toBeTruthy()
  expect((await pane.find({ type: 'Text', text: /Progress 0\/2/ }))?.text).toContain('Progress 0/2')
  await pane.unmount()

  await turn(3)
  expect(eng.calls.length).toBe(2)
})

test('a verdict that arrives after the goal changed is dropped', async ($, on) => {
  const eng = engine(on, { verdicts: [verdict({ done: true, reason: 'old goal reached' })], isJudgeHeld: true })
  const turn = await withGoal($, eng)
  await turn(2)
  expect(eng.calls.length).toBe(1)

  await run($, 'session-compass-reset')
  await run($, 'session-compass')
  await eng.clock.advance(10)
  await $.tool.call({ tool: TOOL('set_goal'), destination: 'Press release draft', done: 'CEO approval', avoid: '-', steps: 3 })
  eng.release()
  await eng.clock.advance(10)

  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Reached:/ })).toBeFalsy()
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await pane.find({ type: 'Text', text: /Progress 0\/3/ }))?.text).toContain('Progress 0/3')
  expect(await pane.find({ type: 'Text', text: /old goal reached/ })).toBeFalsy()
  await pane.unmount()
})
