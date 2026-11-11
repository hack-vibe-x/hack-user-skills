import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'hack-user-skills-criteria-gap',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'vscode', 'desktop', 'mobile'] as const

const USAGE = {
  input_tokens: 10,
  output_tokens: 10,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const CHOICE = JSON.stringify({
  ask: true,
  kind: 'distinction',
  question: 'By "users" here, do you mean sign-ups or paying customers?',
  options: ['sign-ups', 'paying customers'],
  quote: 'sum up why users leave',
  why: 'the analysis depends on who',
})

const FREE = JSON.stringify({
  ask: true,
  kind: 'premise',
  question: 'Which readers is this magazine plan for?',
  options: [],
  quote: 'plan a magazine',
  why: 'the reader premise is missing',
})

const NONE = JSON.stringify({ ask: false })

// A prompt in Hangul, written as escapes so no Hangul sits in this file.
const HANGUL_PROMPT = '\uBCF4\uACE0\uC11C \uC368\uC918'

// Stand-in language files: values that show which file and key they came from.
// The real strings live in hooks/locales/ alone.
const LOCALES: Record<string, Record<string, string>> = {
  en: {
    'command.description': 'en:description',
    'card.title': 'en:title {kind}',
    'card.quote': 'en:quote "{quote}"',
    'card.unknown': 'en:unknown',
    'kind.distinction': 'en:distinction',
    'kind.premise': 'en:premise',
    'check.off': 'en:off',
    'check.asked': 'en:asked',
    'check.no_turn': 'en:no-turn',
    'check.none': 'en:none',
  },
  ko: {
    'card.title': 'ko:title {kind}',
    'card.unknown': 'ko:unknown',
    'kind.distinction': 'ko:distinction',
    'check.off': 'ko:off',
  },
}

const PROJECT_CONFIG = '/proj/.hus-criteria-gap/config.json'
const GLOBAL_CONFIG = '/home/.hus-criteria-gap/config.json'
const config = (value: object, path = PROJECT_CONFIG) => ({ [path]: JSON.stringify(value) })
const ON = config({ card: true })

const turnEnd = (n: number, answer: string) => ({
  answer,
  durationMs: 1000,
  isAborted: false,
  turnId: `t${n}`,
  reason: 'answer' as const,
})

type Call = { model: string; system: string; prompt: string }

// Stands for the engine beneath the plugin: a project at /proj, HOME at /home, session s1,
// files from `files`, the language files above, the judge answering from `verdicts`.
function engine(on: On, opts: { files?: Record<string, string>; verdicts?: string[] }) {
  const files: Record<string, string> = { ...opts.files }
  const verdicts = [...(opts.verdicts ?? [])]
  const sent: { text: string; context: readonly string[] }[] = []
  const calls: Call[] = []
  mock.env(on, { HOME: '/home' })
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({
    value: Object.keys(files).some(p => p === e.path || p.startsWith(`${e.path}/`)),
  }))
  on('fs.read', (_, e) => {
    const locale = e.path.match(/\/hooks\/locales\/([^/]+)\.json$/)
    if (locale) return { value: LOCALES[locale[1]!] ? JSON.stringify(LOCALES[locale[1]!]) : '' }

    return { value: files[e.path] ?? '' }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    calls.push({ model: e.model, system: e.system ?? '', prompt: e.prompt })

    return { value: { isAnswered: true, text: verdicts.shift() ?? NONE, usage: USAGE } }
  })
  on('prompt.submit', (_, e) => {
    sent.push({ text: e.text, context: e.context ?? [] })

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', () => ({ text: 'engine' }))
  // The engine's own band, drawn when the plugin has nothing to show.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return { sent, calls, files }
}

async function start($: any) {
  await $.session.start({ cwd: '/proj', surface: 'vscode', isInteractive: true })
}

async function turn($: any, clock: any, n: number, prompt: string) {
  await $.prompt.submit({ text: prompt })
  await $.turn.complete(turnEnd(n, 'an answer'))
  await clock.advance(10)
}

const check = ($: any) => $.command.run({ command: 'criteria-check', args: '' })

async function hasCard($: any, surface: (typeof SURFACES)[number] = 'vscode') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const found = !!(await ui.find({ key: 'gap-unknown' }))
  await ui.unmount()

  return found
}

test('off by default: no judge call, no note, nothing drawn, and /criteria-check says how to turn it on', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: [CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(eng.calls.length).toBe(0)
  expect(eng.sent[0]?.context.length).toBe(0)

  const res = await check($)
  expect(res.text).toBe('en:off')
  expect(res.context?.join('')).toContain('hack-user-skills-criteria-gap:criteria-init')
  expect(eng.calls.length).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('the command hook being on does not turn the card on', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ hook: { enabled: true } }), verdicts: [CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(eng.calls.length).toBe(0)
  expect(await hasCard($)).toBe(false)
})

test('card on: a choice question appears on every surface and an option answers it', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: ON, verdicts: [CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(eng.calls.map(c => c.model)).toEqual(['sonnet'])
  expect(eng.calls[0]?.system).toContain('## Gap check')
  expect(eng.calls[0]?.system).toContain("in the language the user writes in")
  expect(eng.calls[0]?.system.toLowerCase()).not.toContain('goal')
  expect(eng.calls[0]?.prompt).toContain('sum up why users leave')
  expect(eng.sent.at(-1)?.context.join('')).toContain('[hus-criteria-gap]')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /sign-ups or paying customers/ })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /en:title/ }))?.text).toBe('en:title en:distinction')
    expect((await ui.find({ type: 'Text', text: /en:quote/ }))?.text).toBe('en:quote "sum up why users leave"')
    expect(await ui.find({ key: 'gap-opt-1' })).toBeTruthy()
    expect((await ui.find({ key: 'gap-unknown' }))?.props.label).toBe('en:unknown')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'gap-opt-1' })
  await ui.unmount()
  const answer = eng.sent.find(s => s.text.startsWith('[hus-criteria-gap answer]'))?.text ?? ''
  expect(answer).toContain('Kind: distinction')
  expect(answer).toContain('Options: sign-ups / paying customers')
  expect(answer).toContain('My answer: paying customers')
  expect(answer).toContain('My words it rests on: "sum up why users leave"')
  expect(answer).toContain('hack-user-skills-criteria-gap:criteria-gap')
  expect(await hasCard($)).toBe(false)
})

test('a free question is answered in the field, and "don\'t know" sends that', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: true, hook: { cooldown_turns: 0 } }), verdicts: [FREE, FREE] })
  await start($)
  await turn($, clock, 1, 'plan a magazine')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'gap-opt-0' })).toBeFalsy()
  await ui.input({ key: 'gap-free', text: 'first-time parents in their 30s' })
  await ui.unmount()
  expect(eng.sent.at(-1)?.text).toContain('My answer: first-time parents in their 30s')
  expect(eng.sent.at(-1)?.text).toContain('Kind: omitted premise')

  await turn($, clock, 2, 'plan a magazine')
  const again = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await again.press({ key: 'gap-unknown' })
  await again.unmount()
  expect(eng.sent.at(-1)?.text).toContain("My answer: I don't know")
})

test('the cooldown and the session cap from the config hold', async ($, on) => {
  const clock = mock.clock(on)
  const files = config({ card: true, hook: { max_per_session: 2, cooldown_turns: 1 } })
  const eng = engine(on, { files, verdicts: [CHOICE, FREE] })
  await start($)

  await turn($, clock, 1, 'sum up why users leave')
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'gap-skip' })
  await ui.unmount()
  await turn($, clock, 2, 'next step')
  await turn($, clock, 3, 'plan a magazine')
  const second = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await second.press({ key: 'gap-skip' })
  await second.unmount()
  await turn($, clock, 4, 'go on')
  await turn($, clock, 5, 'go on')
  // Turn 2 is in the cooldown, turns 4 and 5 are past the cap: no call on them.
  expect(eng.calls.length).toBe(2)
  const log = eng.files['/home/.hus-criteria-gap/judge-log/-proj/s1.jsonl'] ?? ''
  expect(log.split('\n').filter(l => l.includes('"question-skipped"')).length).toBe(2)
})

test('a verdict without the user quote asks nothing; an unanswered question expires after 3 turns', async ($, on) => {
  const clock = mock.clock(on)
  const noQuote = JSON.stringify({ ...JSON.parse(FREE), quote: '' })
  engine(on, { files: config({ card: true, hook: { cooldown_turns: 0 } }), verdicts: [noQuote, FREE] })
  await start($)
  await turn($, clock, 1, 'plan a magazine')
  expect(await hasCard($)).toBe(false)

  await turn($, clock, 2, 'plan a magazine')
  expect(await hasCard($)).toBe(true)

  await turn($, clock, 3, 'keep going')
  await turn($, clock, 4, 'keep going')
  expect(await hasCard($)).toBe(true)
  await turn($, clock, 5, 'keep going')
  expect(await hasCard($)).toBe(false)
})

test('/criteria-check asks now, past the cooldown', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: true, hook: { cooldown_turns: 5 } }), verdicts: [NONE, CHOICE] })
  await start($)
  expect((await check($)).text).toBe('en:no-turn')

  await turn($, clock, 1, 'sum up why users leave')
  const res = await check($)
  expect(res.text).toBe('en:asked')
  expect(res.context?.join('')).toContain('[hus-criteria-gap answer]')
  expect(eng.calls.length).toBe(2)
  expect(await hasCard($)).toBe(true)
})

test('the global config counts where the project has none; a project config wins over it', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: true }, GLOBAL_CONFIG), verdicts: [CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(eng.calls.length).toBe(1)
  expect(await hasCard($)).toBe(true)

  // The project's own config says nothing of the card: off here, and the waiting card goes.
  eng.files[PROJECT_CONFIG] = JSON.stringify({ hook: { enabled: true } })
  expect(await hasCard($)).toBe(false)
  await turn($, clock, 2, 'sum up why users leave')
  expect(eng.calls.length).toBe(1)
  expect((await check($)).text).toBe('en:off')
})

test('a broken config counts as off', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: { [PROJECT_CONFIG]: '{ card: true' }, verdicts: [CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(eng.calls.length).toBe(0)
})

test('Korean strings follow Hangul prompts; English fills missing keys; "lang" in the config wins', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: [CHOICE] })
  await start($)
  expect((await check($)).text).toBe('en:off')
  await turn($, clock, 1, HANGUL_PROMPT)
  expect((await check($)).text).toBe('ko:off')

  eng.files[PROJECT_CONFIG] = JSON.stringify({ card: true, hook: { cooldown_turns: 0 } })
  await turn($, clock, 2, `${HANGUL_PROMPT} sum up why users leave`)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /title/ }))?.text).toBe('ko:title ko:distinction')
  expect((await ui.find({ type: 'Text', text: /quote/ }))?.text).toBe('en:quote "sum up why users leave"')
  expect((await ui.find({ key: 'gap-unknown' }))?.props.label).toBe('ko:unknown')
  await ui.unmount()

  eng.files[PROJECT_CONFIG] = JSON.stringify({ card: true, lang: 'en' })
  const english = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await english.find({ key: 'gap-unknown' }))?.props.label).toBe('en:unknown')
  await english.unmount()

  // A code that is not a language file falls back to the next choice.
  eng.files[PROJECT_CONFIG] = JSON.stringify({ card: true, lang: '../x' })
  const fallback = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await fallback.find({ key: 'gap-unknown' }))?.props.label).toBe('ko:unknown')
  await fallback.unmount()
})

test('each judgement and answer is a line in the judge log under ~/.hus-criteria-gap/judge-log/', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: ON, verdicts: [CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'gap-opt-0' })
  await ui.unmount()

  const lines = (eng.files['/home/.hus-criteria-gap/judge-log/-proj/s1.jsonl'] ?? '').trim().split('\n').map(l => JSON.parse(l))
  expect(lines.map(l => l.event)).toEqual(['judge', 'question-answered'])
  expect(lines[0]).toMatchObject({ turn: 1, model: 'sonnet', ok: true, question: { kind: 'distinction' } })
})
