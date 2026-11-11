import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stands for the engine beneath the plugin in the tests: a project at /proj, HOME at /home/me, files in
// memory, the judge answering from `verdicts`, the diary script answering from `diary`.
// The language files are served from the fixtures below (a test has no disk), so the tests read these
// short strings, not the shipped ones.

export const PLUGIN = 'hack-user-skills-session-coach'
export const TOOL = (name: string) => `mcp__${PLUGIN}__${name}` as `mcp__${string}__${string}`

export const EN: Record<string, string> = {
  'pane.title': 'Goal journey',
  'pane.no_goal': 'No goal yet',
  'pane.start': 'Set a goal',
  'pane.finished': 'Goals finished: {n}',
  'pane.progress': 'Progress {height}/{rows}',
  'pane.pivot_title': 'Has the goal changed?',
  'band.arrived': 'Reached: {destination}',
  'band.drift': 'Off course: {reason}',
  'step.not_yet': 'You said: not there yet',
  'step.pivot': 'Goal changed: {destination}',
  'cmd.compass.start': 'Interview starts.',
  'cmd.show.goal': 'Goal: {destination} / {done} / {avoid}',
  'diary.card.title_new': 'Write today now?',
  'diary.card.title_again': 'Write today again?',
  'diary.card.body_new': 'Today ends here.',
  'diary.card.body_again': 'The earlier diary is thrown away.',
  'diary.card.note': 'Uses AI.',
  'diary.card.note_midnight': 'Uses AI. Else written at midnight.',
  'diary.btn.write': 'Write now',
  'diary.btn.rewrite': 'Write again',
  'diary.btn.midnight': 'Write at midnight',
  'diary.btn.skip': "Don't write",
  'diary.toast.writing': 'Writing.',
  'diary.toast.written': 'Written.',
  'diary.toast.failed': 'Failed: {detail}',
}

export const KO: Record<string, string> = {
  'pane.no_goal': 'KO no goal',
  'pane.progress': 'KO progress {height}/{rows}',
}

// "Hangul" written in Hangul, escaped so the test files stay in English.
export const HANGUL_WORD = '\uD55C\uAE00'

export const USAGE = {
  input_tokens: 10,
  output_tokens: 10,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

export const MOVE = { move: 'up', reason: 'progress', done: false, pivot: false, new_destination: '', carry: 0 }
export const verdict = (over: Record<string, unknown> = {}) => JSON.stringify({ ...MOVE, ...over })

export const turnEnd = (n: number, answer: string) => ({
  answer,
  durationMs: 1000,
  isAborted: false,
  turnId: `t${n}`,
  reason: 'answer' as const,
})

export const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'session-compass',
  props: {
    title: 'Goal journey',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

export const BAND = {
  plugin: PLUGIN,
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

export const LOG = '/home/me/.hus-session-coach/session-compass/judge-log/-proj/s1.jsonl'

type DiaryOpts = { isOn?: boolean; isTodayWritten?: boolean; isWriteRefused?: boolean }

type Opts = {
  verdicts?: string[]
  files?: Record<string, string>
  env?: Record<string, string>
  isWriteRefused?: boolean
  diary?: DiaryOpts
}

export function engine(on: On, opts: Opts = {}) {
  const clock = mock.clock(on)
  const files: Record<string, string> = { ...(opts.files ?? {}) }
  const verdicts = [...(opts.verdicts ?? [])]
  const sent: string[] = []
  const calls: { model: string; system: string; prompt: string }[] = []
  const tools: string[] = []
  const toasts: string[] = []
  const argv: string[][] = []
  const panes = { opened: 0, closed: 0 }
  const diary = { isOn: false, isTodayWritten: false, ...opts.diary }
  const locale = (path: string) =>
    path.endsWith('/hooks/locales/en.json') ? EN : path.endsWith('/hooks/locales/ko.json') ? KO : null

  mock.env(on, { HOME: '/home/me', ...(opts.env ?? {}) })
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_, e) => ({ value: e.path in files || locale(e.path) !== null }))
  on('fs.read', (_, e) => {
    const table = locale(e.path)
    if (table) return { value: JSON.stringify(table) }
    if (!(e.path in files)) throw new Error('no such file')

    return { value: files[e.path] ?? '' }
  })
  on('fs.write', (_, e) => {
    if (opts.isWriteRefused) throw new Error('disk full')
    files[e.path] = String(e.text)

    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    tools.push(e.name)

    return { value: { tool: TOOL(e.name) } }
  })
  on('ui.open', () => {
    panes.opened += 1

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    panes.closed += 1

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))

    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    calls.push({ model: e.model, system: e.system ?? '', prompt: e.prompt })

    return { value: { isAnswered: true, text: verdicts.shift() ?? verdict(), usage: USAGE } }
  })
  on('process.run', (_, e) => {
    argv.push([...e.argv])
    const args = e.argv.slice(2)
    const result = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (args[0] === 'status') return result(JSON.stringify({ on: diary.isOn, today_written: diary.isTodayWritten }))
    if (args[0] === 'write') {
      if (opts.diary?.isWriteRefused) return result('[hus-session-coach] Could not write it: busy', 1)
      diary.isTodayWritten = true
    }

    return result('[hus-session-coach] Written')
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', () => ({ text: 'engine' }))
  // The engine's own drawing when the plugin hands the draw on; a command row shows its text.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const text = (e.props as { text?: unknown }).text

    return <Text>{typeof text === 'string' ? text : '(engine)'}</Text>
  })

  const lines = (path = LOG) =>
    (files[path] ?? '')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))

  return { clock, files, sent, calls, tools, toasts, argv, panes, lines }
}

export async function start($: any) {
  await $.session.start({ cwd: '/proj', surface: 'vscode', isInteractive: true })
}

export const run = ($: any, command: string, args = '') => $.command.run({ command, args })

// Turns compass on with /session-compass and saves a goal, as the interview would end.
export async function withGoal($: any, eng: ReturnType<typeof engine>, steps = 2) {
  await start($)
  await run($, 'session-compass')
  await eng.clock.advance(10)
  await $.tool.call({
    tool: TOOL('set_goal'),
    destination: 'Landing page copy',
    done: 'Headline and CTA approved',
    avoid: 'Design talk',
    steps,
  })
  await $.turn.complete(turnEnd(1, 'Saved the goal'))
  await eng.clock.advance(10)

  return async (n: number, prompt = '') => {
    if (prompt) await $.prompt.submit({ text: prompt })
    await $.turn.complete(turnEnd(n, 'Worked on it'))
    await eng.clock.advance(10)
  }
}
