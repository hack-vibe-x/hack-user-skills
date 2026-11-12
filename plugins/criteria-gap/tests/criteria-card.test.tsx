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
function engine(on: On, opts: { files?: Record<string, string>; verdicts?: string[]; cwd?: string }) {
  const files: Record<string, string> = { ...opts.files }
  const verdicts = [...(opts.verdicts ?? [])]
  const sent: { text: string; context: readonly string[] }[] = []
  const calls: Call[] = []
  const cwd = opts.cwd ?? '/proj'
  mock.env(on, { HOME: '/home' })
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: cwd }))
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
  // The files and folders directly in a folder.
  on('fs.list', (_, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(files)) {
      if (!path.startsWith(`${e.path}/`)) continue
      const rest = path.slice(e.path.length + 1)
      const slash = rest.indexOf('/')
      names.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? 'file' : 'dir')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0 })) }
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

test("a card answer is not the user's words: the turn it starts is not judged, and it never reaches the judge", async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: true, hook: { cooldown_turns: 0 } }), verdicts: [CHOICE, NONE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'gap-opt-1' })
  await ui.unmount()
  const answer = eng.sent.at(-1)?.text ?? ''
  expect(answer.startsWith('[hus-criteria-gap answer]')).toBe(true)

  // The kit keeps a plugin's own prompt from its own prompt.submit hook; the engine runs it through the
  // plugin's other hooks, so hand it in here as the engine would, and end the turn it starts.
  await ($ as any).prompt.submit({ text: answer, origin: { kind: 'plugin', name: 'hack-user-skills-criteria-gap' } })
  await $.turn.complete(turnEnd(2, 'redid it for paying customers'))
  await clock.advance(10)
  expect(eng.calls.length).toBe(1)

  await turn($, clock, 3, 'now draft the summary')
  expect(eng.calls.length).toBe(2)
  expect(eng.calls[1]?.prompt).toContain('now draft the summary')
  expect(eng.calls[1]?.prompt.includes('[hus-criteria-gap answer]')).toBe(false)
})

test('a turn without a prompt is not judged', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: true, hook: { cooldown_turns: 0 } }), verdicts: [CHOICE] })
  await start($)
  await $.turn.complete(turnEnd(1, 'an answer on its own'))
  await clock.advance(10)
  expect(eng.calls.length).toBe(0)
  expect(await hasCard($)).toBe(false)
})

// ---------- the judge's quote ----------

const NOV_12 = Date.UTC(2026, 10, 12, 3)
const logOf = (eng: { files: Record<string, string> }, project = '-proj') =>
  (eng.files[`/home/.hus-criteria-gap/judge-log/${project}/s1.jsonl`] ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))

test('a quote that is not in the user\'s message drops the question and is logged as dropped', async ($, on) => {
  const clock = mock.clock(on)
  // The quote is from the AI's answer, not from what the user wrote.
  const fromAnswer = JSON.stringify({ ...JSON.parse(CHOICE), quote: 'an answer' })
  const eng = engine(on, { files: config({ card: true, hook: { cooldown_turns: 0 } }), verdicts: [fromAnswer] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(eng.calls.length).toBe(1)
  expect(await hasCard($)).toBe(false)
  const [judged] = logOf(eng)
  expect(judged).toMatchObject({ event: 'judge', ok: true, question: null, dropped: 'quote-not-in-prompt' })
  expect(judged.rejected.quote).toBe('an answer')
})

test('a quote matches across case, spacing, curly quotation marks and a "…" where words were left out', async ($, on) => {
  const clock = mock.clock(on)
  const loose = JSON.stringify({ ...JSON.parse(CHOICE), quote: '“Sum up … users   leave”' })
  const eng = engine(on, { files: ON, verdicts: [loose] })
  await start($)
  await turn($, clock, 1, 'sum up why users\nleave')
  expect(await hasCard($)).toBe(true)
  expect(logOf(eng)[0].dropped).toBeUndefined()
})

test('pieces of a quote out of order do not match', async ($, on) => {
  const clock = mock.clock(on)
  const shuffled = JSON.stringify({ ...JSON.parse(CHOICE), quote: 'users leave … sum up' })
  engine(on, { files: ON, verdicts: [shuffled] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  expect(await hasCard($)).toBe(false)
})

// ---------- the criteria the judge is told about ----------

const criterionFile = (fields: Record<string, string>, body: string) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body}\n`

const crit = (decision: string, extra: Record<string, string> = {}, body = `${decision} rule`) =>
  criterionFile(
    { id: `mag-${decision}-1`, area: 'magazine', decision, status: 'confirmed', source: 'user', confirmed_at: '2026-10-01', ...extra },
    body,
  )

test('the judge is told the confirmed criteria from the files, not from INDEX.md, by the hook\'s rules', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_12 })
  const eng = engine(on, {
    files: {
      ...ON,
      '/proj/.hus-criteria-gap/mag-ok-1.md': crit('ok', { review_after: '2027-01-01 # a comment' }),
      '/proj/.hus-criteria-gap/mag-inferred-1.md': crit('inferred', { source: 'ai-inferred' }),
      '/proj/.hus-criteria-gap/mag-stale-1.md': crit('stale', { confirmed_at: '2026-01-01' }),
      '/proj/.hus-criteria-gap/mag-draft-1.md': crit('draft', { status: 'draft' }),
      '/proj/.hus-criteria-gap/mag-old-1.md': crit('old', { status: 'superseded' }),
      // The same decision globally: the project's version wins.
      '/home/.hus-criteria-gap/mag-ok-1.md': crit('ok', {}, 'the global wording'),
      '/home/.hus-criteria-gap/mag-shared-1.md': crit('shared'),
      // An INDEX.md that still calls the inferred and stale ones confirmed is not read.
      '/proj/.hus-criteria-gap/INDEX.md':
        '- [mag-inferred-1](mag-inferred-1.md) · magazine/inferred · confirmed · inferred rule\n' +
        '- [mag-stale-1](mag-stale-1.md) · magazine/stale · confirmed · stale rule\n',
    },
    verdicts: [NONE],
  })
  await start($)
  await turn($, clock, 1, 'plan a magazine')
  const prompt = eng.calls[0]?.prompt ?? ''
  const known = prompt.slice(prompt.indexOf('Confirmed criteria:'), prompt.indexOf("The user's message"))
  expect(known).toContain('[magazine/ok] ok rule (project)')
  expect(known).toContain('[magazine/shared] shared rule (global)')
  for (const left of ['inferred', 'stale', 'draft', 'old', 'the global wording']) expect(known).not.toContain(left)
})

test('with no criterion files the judge is told there are none', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_12 })
  const eng = engine(on, { files: ON, verdicts: [NONE] })
  await start($)
  await turn($, clock, 1, 'plan a magazine')
  expect(eng.calls[0]?.prompt).toContain('Confirmed criteria:\n(none)')
})

test('in a folder under HOME the global folder is not taken for a project', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_12 })
  const eng = engine(on, {
    cwd: '/home/work',
    files: { ...config({ card: true }, GLOBAL_CONFIG), '/home/.hus-criteria-gap/mag-ok-1.md': crit('ok') },
    verdicts: [NONE],
  })
  await start($)
  await turn($, clock, 1, 'plan a magazine')
  expect(eng.calls.length).toBe(1)
  expect(eng.calls[0]?.prompt).toContain('[magazine/ok] ok rule (global)')
})

// ---------- what the judge reads ----------

test('a turn ended by something other than an answer is not judged', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: ON, verdicts: [CHOICE] })
  await start($)
  await $.prompt.submit({ text: 'sum up why users leave' })
  await $.turn.complete({ ...turnEnd(1, ''), reason: 'aborted' as any, isAborted: true })
  await clock.advance(10)
  expect(eng.calls.length).toBe(0)
})

// ---------- the judge log ----------

test('the log records "don\'t know", expiry, and a question withdrawn when the card is turned off', async ($, on) => {
  const clock = mock.clock(on)
  const files = config({ card: true, hook: { cooldown_turns: 0, max_per_session: 9 } })
  const eng = engine(on, { files, verdicts: [CHOICE, FREE, NONE, CHOICE] })
  await start($)
  await turn($, clock, 1, 'sum up why users leave')
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'gap-unknown' })
  await ui.unmount()
  const answered = logOf(eng).find(l => l.event === 'question-answered')
  expect(answered).toMatchObject({ kind: 'distinction', answer: "I don't know", unknown: true, turn: 1 })

  // A question left alone for 3 turns goes, and the log says so.
  await turn($, clock, 2, 'plan a magazine')
  await turn($, clock, 3, 'keep going')
  await turn($, clock, 4, 'keep going')
  expect(await hasCard($)).toBe(true)
  await turn($, clock, 5, 'keep going')
  expect(await hasCard($)).toBe(false)
  expect(logOf(eng).filter(l => l.event === 'question-expired')).toEqual([
    expect.objectContaining({ kind: 'premise', turn: 2 }),
  ])

  // Turned off while a question waits: it is taken down and logged as withdrawn.
  await turn($, clock, 6, 'sum up why users leave')
  expect(await hasCard($)).toBe(true)
  eng.files[PROJECT_CONFIG] = JSON.stringify({ card: false })
  await turn($, clock, 7, 'keep going')
  expect(logOf(eng).at(-1)).toMatchObject({ event: 'question-withdrawn', kind: 'distinction', turn: 6 })
})
