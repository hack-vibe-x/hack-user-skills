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

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// An answer long enough to be worth reading, with a point the user has to settle.
const FILLER = ' More detail follows here.'.repeat(20)
const ANSWER = `For regulars choose A; for new customers choose B.${FILLER}`
const SHORT_ANSWER = 'Done.'

const SKIPPED = JSON.stringify({
  ask: true,
  kind: 'skipped',
  question: 'Who is this page for?',
  options: ['regulars', 'new customers'],
  quote: 'for new customers choose B',
  quote_from: 'ai',
  why: 'A only fits regulars',
})

const PREMISE = JSON.stringify({
  ask: true,
  kind: 'premise',
  question: 'Where does the number 40 come from?',
  options: [],
  quote: 'go with A',
  quote_from: 'user',
  why: 'the plan rests on it',
})

const NONE = JSON.stringify({ ask: false })
const GAP = JSON.stringify({ understood: false, result: 'Claude had assumed regulars and rewrote it' })
const RIGHT = JSON.stringify({ understood: true, result: 'Same as assumed; carried on' })

// A prompt in Hangul, written as escapes so no Hangul sits in this file.
const HANGUL_PROMPT = '\uBCF4\uACE0\uC11C \uC368\uC918'

// Stand-in language files: values that show which file and key they came from.
const LOCALES: Record<string, Record<string, string>> = {
  en: {
    'command.description': 'en:description',
    'card.title': 'en:title {kind}',
    'card.quote.user': 'en:your "{quote}"',
    'card.quote.ai': 'en:claude "{quote}"',
    'card.unknown': 'en:unknown',
    'kind.skipped': 'en:skipped',
    'kind.premise': 'en:premise',
    'log.title': 'en:log',
    'log.quote.ai': 'en:based-on-claude',
    'log.quote.user': 'en:based-on-you',
    'log.question': 'en:question',
    'log.answer': 'en:answer',
    'log.result': 'en:result',
    'log.skipped': 'en:was-skipped',
    'log.expired': 'en:was-left',
    'check.off': 'en:off',
    'check.broken': 'en:broken {path}',
    'notice.welcome': 'en:welcome',
    'notice.config_broken': 'en:config-broken {path}',
    'notice.judge_failed': 'en:judge-failed',
    'check.asked': 'en:asked',
    'check.no_turn': 'en:no-turn',
    'check.none': 'en:none',
  },
  ko: { 'card.title': 'ko:title {kind}', 'card.unknown': 'ko:unknown', 'kind.skipped': 'ko:skipped', 'check.off': 'ko:off' },
}

const PROJECT_CONFIG = '/proj/.hus-criteria-gap/config.json'
const GLOBAL_CONFIG = '/home/.hus-criteria-gap/config.json'
const config = (value: object, path = PROJECT_CONFIG) => ({ [path]: JSON.stringify(value) })
const LOG_PREFIX = '/home/.hus-criteria-gap/log/-proj/'

const turnEnd = (n: number, answer: string, reason = 'answer') => ({
  answer,
  durationMs: 1000,
  isAborted: reason !== 'answer',
  turnId: `t${n}`,
  reason: reason as 'answer',
})

type Call = { model: string; system: string; prompt: string }

// Stands for the engine beneath the plugin: a project at /proj, HOME at /home, session s1,
// files from `files`, the language files above, the model answering from `verdicts`.
function engine(
  on: On,
  opts: { files?: Record<string, string>; verdicts?: string[]; env?: Record<string, string>; cwd?: string; reject?: boolean },
) {
  const files: Record<string, string> = { ...opts.files }
  const verdicts = [...(opts.verdicts ?? [])]
  const sent: { text: string; context: readonly string[] }[] = []
  const calls: Call[] = []
  const toasts: string[] = []
  mock.env(on, opts.env ?? { HOME: '/home' })
  mock.store(on)
  on('session.cwd', () => ({ value: opts.cwd ?? '/proj' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: Object.keys(files).some(p => p === e.path || p.startsWith(`${e.path}/`)) }))
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
    if (opts.reject) throw new Error('model blocked')

    return { value: { isAnswered: true, text: verdicts.shift() ?? NONE, usage: USAGE } }
  })
  on('prompt.submit', (_, e) => {
    sent.push({ text: e.text, context: e.context ?? [] })

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', () => ({ text: 'engine' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const log = () => Object.entries(files).find(([p]) => p.startsWith(LOG_PREFIX))?.[1] ?? ''

  return { sent, calls, files, log, toasts }
}

async function start($: any) {
  await $.session.start({ cwd: '/proj', surface: 'vscode', isInteractive: true })
}

async function turn($: any, clock: any, n: number, prompt: string, answer = ANSWER) {
  await $.prompt.submit({ text: prompt })
  await $.turn.complete(turnEnd(n, answer))
  await clock.advance(10)
}

// The turn Claude spends on a card answer: the plugin sent the answer itself, so no prompt from the user.
async function answerTurn($: any, clock: any, n: number, reply: string) {
  await $.turn.complete(turnEnd(n, reply))
  await clock.advance(10)
}

async function press($: any, key: string) {
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key })
  await ui.unmount()
}

const check = ($: any) => $.command.run({ command: 'criteria-check', args: '' })

async function hasCard($: any, surface: (typeof SURFACES)[number] = 'vscode') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const found = !!(await ui.find({ key: 'gap-unknown' }))
  await ui.unmount()

  return found
}

// ---------- on, off, and what is judged ----------

test('on by default: the judge reads the previous answer, the message and the new answer; the card shows everywhere', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: [NONE, SKIPPED] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  await turn($, clock, 2, 'go with A', `Done with A.${FILLER}`)
  expect(eng.calls.map(c => c.model)).toEqual(['sonnet', 'sonnet'])
  const prompt = eng.calls[1]!.prompt
  expect(prompt).toContain("The AI's previous answer:\nFor regulars choose A")
  expect(prompt).toContain("The user's message:\ngo with A")
  expect(prompt).toContain("The AI's answer to it:\nDone with A.")
  expect(eng.calls[1]!.system).toContain('Never ask whether they understood')
  expect(eng.sent.at(-1)?.context.join('')).toContain('[hus-criteria-gap]')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /en:title/ }))?.text).toBe('en:title en:skipped')
    expect((await ui.find({ type: 'Text', text: /en:claude/ }))?.text).toBe('en:claude "for new customers choose B"')
    expect(await ui.find({ type: 'Text', text: /Who is this page for/ })).toBeTruthy()
    expect(await ui.find({ key: 'gap-opt-1' })).toBeTruthy()
    await ui.unmount()
  }
})

test('"card": false turns it off: no call, no note, nothing drawn, and /criteria-check says so', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: false }), verdicts: [SKIPPED] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(eng.calls.length).toBe(0)
  expect(eng.sent[0]?.context.length).toBe(0)
  expect(await hasCard($)).toBe(false)
  const res = await check($)
  expect(res.text).toBe('en:off')
  expect(res.context?.join('')).toContain('hack-user-skills-criteria-gap:criteria-gap')
})

test('a project setting wins over the global one, and a broken file counts as off', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: { ...config({ card: false }, GLOBAL_CONFIG), ...config({ card: true }) }, verdicts: [NONE] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(eng.calls.length).toBe(1)
  eng.files[PROJECT_CONFIG] = '{ card: true'
  await turn($, clock, 2, 'plan it again')
  expect(eng.calls.length).toBe(1)
})

test('a short exchange, a turn without an answer and a turn without a prompt are not judged', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: [SKIPPED] })
  await start($)
  await turn($, clock, 1, 'thanks', SHORT_ANSWER)
  await $.prompt.submit({ text: 'plan the page' })
  await $.turn.complete(turnEnd(2, ANSWER, 'aborted'))
  await clock.advance(10)
  await $.turn.complete(turnEnd(3, ANSWER))
  await clock.advance(10)
  expect(eng.calls.length).toBe(0)
})

// ---------- quotes ----------

test('a quote must be in the words it names: from the answer for "ai", from the message for "user"', async ($, on) => {
  const clock = mock.clock(on)
  const wrongSide = JSON.stringify({ ...JSON.parse(SKIPPED), quote_from: 'user' })
  const eng = engine(on, { files: config({ pace: 3 }), verdicts: [wrongSide, PREMISE] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(await hasCard($)).toBe(false)
  await turn($, clock, 2, 'go with A')
  expect(eng.calls.length).toBe(2)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /en:your/ }))?.text).toBe('en:your "go with A"')
  await ui.unmount()
})

test('a quote matches across case, spacing, curly quotation marks and a "…" where words were left out', async ($, on) => {
  const clock = mock.clock(on)
  const loose = JSON.stringify({ ...JSON.parse(SKIPPED), quote: '“For regulars … new   customers”' })
  engine(on, { verdicts: [loose] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(await hasCard($)).toBe(true)
})

// ---------- answers, what came of them, and the log ----------

test('an option answers; the answer goes to Claude; what came of it is judged and logged', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: [SKIPPED, GAP] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  await press($, 'gap-opt-1')
  const answer = eng.sent.at(-1)?.text ?? ''
  expect(answer.startsWith('[hus-criteria-gap answer]')).toBe(true)
  expect(answer).toContain('Question: Who is this page for?')
  expect(answer).toContain('It points at your answer: "for new customers choose B"')
  expect(answer).toContain('My answer: new customers')
  expect(answer).toContain('hack-user-skills-criteria-gap:criteria-gap')
  expect(await hasCard($)).toBe(false)

  await answerTurn($, clock, 2, 'I had assumed regulars; rewriting for new customers.')
  // The answer turn is checked for what came of it, not judged for a new question.
  expect(eng.calls.length).toBe(2)
  expect(eng.calls[1]!.prompt).toContain("The person's answer: new customers")
  const log = eng.log()
  expect(log).toContain('# en:log · ')
  expect(log).toContain('/proj')
  expect(log).toContain('· en:skipped')
  expect(log).toContain('- en:based-on-claude: "for new customers choose B"')
  expect(log).toContain('- en:question: Who is this page for?')
  expect(log).toContain('- en:answer: new customers')
  expect(log).toContain('- en:result: Claude had assumed regulars and rewrote it')
})

test('a free answer and "don\'t know"; a skipped and an unanswered question are logged as such', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ pace: 3 }), verdicts: [PREMISE, GAP, SKIPPED, SKIPPED] })
  await start($)
  await turn($, clock, 1, 'go with A')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'gap-opt-0' })).toBeFalsy()
  await ui.press({ key: 'gap-unknown' })
  await ui.unmount()
  expect(eng.sent.at(-1)?.text).toContain("My answer: I don't know")
  await answerTurn($, clock, 2, 'Here is where 40 came from...')
  expect(eng.log()).toContain('- en:answer: en:unknown')

  await turn($, clock, 3, 'plan the page')
  await turn($, clock, 4, 'plan the page')
  await press($, 'gap-skip')
  expect(eng.log()).toContain('- en:answer: en:was-skipped')

  await turn($, clock, 5, 'plan the page')
  await turn($, clock, 6, 'plan the page')
  await turn($, clock, 7, 'plan the page') // asked after turn 7
  await turn($, clock, 8, 'plan the page')
  await turn($, clock, 9, 'plan the page')
  expect(await hasCard($)).toBe(true)
  await turn($, clock, 10, 'plan the page') // 3 turns later: taken down
  expect(await hasCard($)).toBe(false)
  expect(eng.log()).toContain('- en:answer: en:was-left')
})

// ---------- how many ----------

test('questions are at least 2 turns apart, and skips lower the allowance until the block resets', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: Array(10).fill(SKIPPED) })
  await start($)
  let n = 0
  const next = () => turn($, clock, ++n, 'plan the page')

  await next() // turn 1: asked (1 of 3)
  await press($, 'gap-skip') // allowance 2
  await next() // turn 2: too soon
  await next() // turn 3: too soon
  expect(eng.calls.length).toBe(1)
  await next() // turn 4: asked (2 of 2)
  await press($, 'gap-skip') // allowance 1
  expect(eng.calls.length).toBe(2)
  while (n < 30) await next() // used up: no more calls in this block
  expect(eng.calls.length).toBe(2)
  await next() // turn 31: a new block with 3 again
  expect(eng.calls.length).toBe(3)
  expect(await hasCard($)).toBe(true)
})

test('an answer that shows a gap raises the allowance; one that shows understanding lowers it', async ($, on) => {
  const clock = mock.clock(on)
  // Base 1 ("pace": -2): one question per block unless an answer shows a gap.
  const eng = engine(on, { files: config({ pace: -2 }), verdicts: [SKIPPED, GAP, SKIPPED, RIGHT, SKIPPED] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  await press($, 'gap-opt-0')
  await answerTurn($, clock, 2, 'rewrote it')
  expect(eng.calls.length).toBe(2)
  await turn($, clock, 3, 'plan the page')
  await turn($, clock, 4, 'plan the page')
  // Allowance 2 after the gap: asked again.
  expect(eng.calls.length).toBe(3)
  await press($, 'gap-opt-0')
  await answerTurn($, clock, 5, 'right, carrying on')
  for (let n = 6; n <= 12; n++) await turn($, clock, n, 'plan the page')
  // Understood: back to 1, and 2 were asked.
  expect(eng.calls.length).toBe(4)
})

test('/criteria-check asks now, past the spacing', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { verdicts: [SKIPPED, SKIPPED] })
  await start($)
  expect((await check($)).text).toBe('en:no-turn')
  await turn($, clock, 1, 'plan the page')
  await press($, 'gap-skip')
  await turn($, clock, 2, 'plan the page')
  expect(eng.calls.length).toBe(1)
  const res = await check($)
  expect(res.text).toBe('en:asked')
  expect(res.context?.join('')).toContain('[hus-criteria-gap answer]')
  expect(eng.calls.length).toBe(2)
})

// ---------- language, and the questions asked before ----------

test('Korean strings follow Hangul prompts; English fills missing keys', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { verdicts: [SKIPPED] })
  await start($)
  await turn($, clock, 1, HANGUL_PROMPT)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /title/ }))?.text).toBe('ko:title ko:skipped')
  expect((await ui.find({ type: 'Text', text: /en:claude/ }))?.text).toBe('en:claude "for new customers choose B"')
  expect((await ui.find({ key: 'gap-unknown' }))?.props.label).toBe('ko:unknown')
  await ui.unmount()
})

test('the judge is told the questions already asked, and a card answer never reaches it', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ pace: 3 }), verdicts: [SKIPPED, GAP, NONE] })
  await start($)
  await turn($, clock, 1, 'plan the page')
  await press($, 'gap-opt-1')
  await answerTurn($, clock, 2, 'rewrote it')
  await turn($, clock, 3, 'now draft the summary')
  await turn($, clock, 4, 'now draft the summary')
  const last = eng.calls.at(-1)!.prompt
  expect(last).toContain('- Who is this page for? → new customers')
  expect(last.includes('[hus-criteria-gap answer]')).toBe(false)
})

// ---------- what the user is told when something is in the way ----------

test('the first prompt says once that the card is on, and never again on this computer', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, {})
  await start($)
  await turn($, clock, 1, 'plan the page', SHORT_ANSWER)
  await turn($, clock, 2, 'go on', SHORT_ANSWER)
  expect(eng.toasts).toEqual(['en:welcome'])
})

test('no welcome where the card is off', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: config({ card: false }) })
  await start($)
  await turn($, clock, 1, 'plan the page', SHORT_ANSWER)
  expect(eng.toasts).toEqual([])
})

test('a settings file that cannot be read is said once, and /criteria-check names it', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { files: { [PROJECT_CONFIG]: '{ not json' } })
  await start($)
  await turn($, clock, 1, 'plan the page', SHORT_ANSWER)
  await turn($, clock, 2, 'go on', SHORT_ANSWER)
  expect(eng.toasts.filter(t => t.startsWith('en:config-broken'))).toEqual([`en:config-broken ${PROJECT_CONFIG}`])
  const res = await check($)
  expect(res.text).toBe(`en:broken ${PROJECT_CONFIG}`)
})

test('the judge failing twice in a row is said once; a blocked model does not break the turn', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { reject: true })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(eng.toasts.filter(t => t === 'en:judge-failed')).toEqual([])
  await turn($, clock, 2, 'go with A')
  await turn($, clock, 3, 'and then')
  expect(eng.toasts.filter(t => t === 'en:judge-failed')).toEqual(['en:judge-failed'])
  expect(await hasCard($)).toBe(false)
})

// The engine here is a POSIX one, so a drive letter cannot be mocked; backslashes and USERPROFILE can.
test('a Windows-style working directory finds the project folder', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { cwd: '\\proj\\sub', files: config({ card: false }) })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(eng.calls).toEqual([])
})

test('without HOME, USERPROFILE is the home folder: the global settings and the log are found there', async ($, on) => {
  const clock = mock.clock(on)
  const eng = engine(on, { env: { USERPROFILE: '\\home' }, files: config({ card: false }, GLOBAL_CONFIG) })
  await start($)
  await turn($, clock, 1, 'plan the page')
  expect(eng.calls).toEqual([])
})
