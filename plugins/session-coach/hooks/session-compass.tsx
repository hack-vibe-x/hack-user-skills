import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Compass, Goal, Proposal, Step, StepKind, StepMark } from '../types'
import { TOOL, clip, dataHome, langCode, reply, strings } from './shared'
import type { T } from './shared'

// session-compass: once the user sets a goal for the conversation with /session-compass, a light model
// judges every turn against it and the pane draws the path on an LED board. Off until the user runs
// /session-compass in a session; with no goal it does nothing and calls no model.

const PANE = 'session-compass'
const MAX_ROWS = 12
// Progress only needs the light model.
const JUDGE_MODEL = 'haiku'
// Where each judgement is logged, under the plugin's home folder: <project>/<session id>.jsonl.
const JUDGE_LOG_DIR = 'session-compass/judge-log'

const EMPTY: Compass = {
  isActive: false,
  goal: null,
  steps: [],
  segments: [],
  proposal: null,
  isJudging: false,
  turn: 0,
  note: null,
  finished: [],
}

// Bump the tag when Compass changes shape: older stored values read as EMPTY.
const compass = atom({ plugin: 'hack-user-skills-session-coach', key: 'compass' } as const, EMPTY, {
  shape: 'compass-1',
})

const COLORS: Record<StepKind, string> = {
  start: '#cfd8dc',
  up: '#39e67a',
  flat: '#ffb627',
  down: '#ff4b4b',
  pivot: '#4da3ff',
  arrive: '#ffd700',
}

const ARROWS: Record<StepKind, string> = {
  start: '●',
  up: '▲',
  flat: '▶',
  down: '▼',
  pivot: '↺',
  arrive: '★',
}

const clampRows = (n: unknown) => Math.max(1, Math.min(MAX_ROWS, Math.round(Number(n) || 5)))

const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

// ---------- prompts (model-facing, English) ----------

const interviewPrompt = (seed: string, previous = '') =>
  [
    '[session-compass] Start an interview to set the goal of this conversation.',
    previous
      ? `The goal just finished: "${previous}". You may suggest what could come next, but ask the user to decide the new goal.`
      : '',
    seed ? `What the user said first: "${seed}"` : '',
    '',
    'Rules:',
    '- Ask one question at a time, and move to the next only after the answer.',
    '- Find out: (1) destination: what the user should have in hand when this conversation ends, (2) done when: a condition that can be checked, (3) avoid: what is out of scope or a path to stay off, (4) about how many steps (turns) it takes to get there (1-12).',
    '- When an answer is vague, narrow it with a concrete example. Offer a recommendation where you can.',
    '- Once you have all four, show a short goal card and ask the user to confirm it.',
    `- When the user confirms, call the ${TOOL('set_goal')} tool to save the card. Do not call it before they confirm.`,
    '- Talk with the user in the language they use, and write the card in it.',
  ]
    .filter(Boolean)
    .join('\n')

const changePrompt = (goal: Goal, ask: string) =>
  [
    '[session-compass] The user wants to change the goal.',
    `Current goal: ${goal.destination} (done when: ${goal.done} / avoid: ${goal.avoid} / ${goal.rows} steps)`,
    `What the user said: "${ask}"`,
    '',
    'First confirm with the user which kind of change this is.',
    `- The same direction with the goal raised or lowered (only the number of steps changes): after they confirm, call ${TOOL('adjust_goal_height')}.`,
    `- The direction of the goal itself changes: put together a new goal card, estimate how many steps of the work so far still count toward the new goal (carry), and call ${TOOL('propose_goal_change')}. Tell the user the change takes effect only when they confirm it with the button in the pane.`,
    '- Talk with the user in the language they use.',
  ].join('\n')

const MARK_FOR_JUDGE: Record<StepMark, (s: Step) => string> = {
  start: () => 'start',
  pivot: s => `goal changed to: ${s.reason}`,
  'not-yet': () => 'the user confirmed the goal is not reached yet',
}

const judgeSystem = (lang: string) =>
  [
    'You judge the journey of a conversation between a person and an AI. Look only at the turn that just ended and judge whether the conversation is moving toward the goal that was set.',
    `## Progress
- "up": this turn brought the conversation a real step closer to the goal (a decision was made, the deliverable moved forward, a blocking problem was solved).
- "flat": standing still or a side road (only checking, talk unrelated to the goal, repeating the same thing).
- "down": moved away from the goal (did what is to be avoided, something built in the wrong direction must be undone, confusion grew).
- done: true when this turn met the "done when" condition. Having used up the estimated steps is not enough. If the recent path records that the user confirmed the goal is not reached yet, true only when the condition was newly met after that.
- pivot: true when there is a clear sign that the user wants to move the goal itself in another direction. The AI wandering off is not a pivot; that is flat or down.
- When pivot is true, fill new_destination (the new destination in one sentence) and carry (how many steps of the work so far still count toward the new goal, 0 or more).`,
    `Write "reason" (one line, 40 characters or fewer) and "new_destination" in the user's language (language code: ${lang}).`,
    'Output one JSON object and nothing else.\n{"move":"up|flat|down","reason":"","done":false,"pivot":false,"new_destination":"","carry":0}',
  ].join('\n\n')

type TurnSnapshot = { turn: number; prompt: string; answer: string; tools: string[] }

const judgePrompt = (c: Compass, turn: TurnSnapshot) => {
  const goal = c.goal!
  const here = c.steps[c.steps.length - 1]
  const recent = c.steps
    .slice(-6)
    .map(s => `T${s.turn} ${s.kind}: ${s.mark ? MARK_FOR_JUDGE[s.mark](s) : s.reason}`)
    .join('\n')

  return [
    `Destination: ${goal.destination}`,
    `Done when: ${goal.done}`,
    `Avoid: ${goal.avoid}`,
    `Current height: ${here?.height ?? 0} / ${goal.rows}`,
    '',
    'Recent path:',
    recent || '(none)',
    '',
    `The user's message this turn:\n${clip(turn.prompt || '(none)', 2500)}`,
    '',
    `The AI's answer this turn:\n${clip(turn.answer || '(none)', 3500)}`,
    turn.tools.length ? `\nTools used this turn: ${turn.tools.slice(0, 30).join(', ')}` : '',
  ].join('\n')
}

// ---------- log ----------

// A record to check later whether the judgements were right: one file per session, outside any repository.
// The engine cannot append, so each write reads and rewrites; a queue keeps the lines in order.
// A log that cannot be written must never stop the judging.
let logQueue: Promise<void> = Promise.resolve()

function logEvent($: EngineInterface, event: string, fields: Record<string, unknown>): Promise<void> {
  logQueue = logQueue.then(async () => {
    try {
      const home = await dataHome($)
      if (!home) return
      const project = (await $.session.root()).replace(/[^A-Za-z0-9._-]+/g, '-')
      const session = await $.session.id()
      const path = `${home}/${JUDGE_LOG_DIR}/${project}/${session}.jsonl`
      const old = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
      const at = new Date(await $.clock.now()).toISOString()
      await $.fs.write(path, `${old}${JSON.stringify({ at, event, ...fields })}\n`)
    } catch {
      // Not logged; the session goes on.
    }
  })

  return logQueue
}

// ---------- state changes ----------

type Verdict = {
  move: 'up' | 'flat' | 'down'
  reason: string
  done: boolean
  pivot: boolean
  newDestination: string
  carry: number
}

const parseVerdict = (text: string): Verdict | null => {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>
    const move = raw.move === 'up' || raw.move === 'down' ? raw.move : 'flat'

    return {
      move,
      reason: clip(str(raw.reason), 60),
      done: raw.done === true,
      pivot: raw.pivot === true,
      newDestination: str(raw.new_destination),
      carry: Math.max(0, Math.round(Number(raw.carry) || 0)),
    }
  } catch {
    return null
  }
}

const currentSegment = (c: Compass) => Math.max(0, c.segments.length - 1)

// Arriving is only a judgement: it waits in this state until the user finishes or says "not yet".
const isArrived = (c: Compass) => c.goal !== null && c.steps[c.steps.length - 1]?.kind === 'arrive'

const applyVerdict = (c: Compass, turn: number, v: Verdict): Compass => {
  if (!c.goal) return c
  const height = c.steps[c.steps.length - 1]?.height ?? 0
  const rows = c.goal.rows
  let next = v.move === 'up' ? height + 1 : v.move === 'down' ? height - 1 : height
  // The step count is an estimate, so the top row is reached only by meeting "done when".
  next = Math.max(0, Math.min(rows - 1, next))
  let kind: StepKind = v.move
  if (v.done) {
    next = rows
    kind = 'arrive'
  }
  const step: Step = { kind, height: next, segment: currentSegment(c), turn, reason: v.reason }
  const proposal: Proposal | null =
    c.proposal ??
    (!v.done && v.pivot && v.newDestination
      ? {
          destination: v.newDestination,
          done: c.goal.done,
          avoid: c.goal.avoid,
          rows,
          carry: Math.min(rows, v.carry),
          reason: v.reason,
          from: 'judge',
        }
      : null)

  return { ...c, steps: [...c.steps, step].slice(-300), proposal }
}

const confirmProposal = (c: Compass): Compass => {
  const p = c.proposal
  if (!p || !c.goal) return { ...c, proposal: null }
  const goal: Goal = { destination: p.destination, done: p.done, avoid: p.avoid, rows: p.rows }
  const step: Step = {
    kind: 'pivot',
    height: Math.min(p.rows, p.carry),
    segment: c.segments.length,
    turn: c.turn,
    reason: clip(p.destination, 40),
    mark: 'pivot',
  }

  return {
    ...c,
    goal,
    segments: [...c.segments, { destination: p.destination, rows: p.rows }],
    steps: [...c.steps, step],
    proposal: null,
    note: { key: 'note.pivot_confirmed', vars: { turn: c.turn } },
  }
}

const finishGoal = (c: Compass): Compass => ({
  ...c,
  goal: null,
  steps: [],
  segments: [],
  proposal: null,
  note: null,
  finished: c.goal ? [...c.finished, c.goal.destination] : c.finished,
})

const notArrivedYet = (c: Compass): Compass => {
  if (!c.goal) return c
  const step: Step = {
    kind: 'flat',
    height: Math.max(0, c.goal.rows - 1),
    segment: currentSegment(c),
    turn: c.turn,
    reason: '',
    mark: 'not-yet',
  }

  return { ...c, steps: [...c.steps, step].slice(-300) }
}

// ---------- judging ----------

// One light-model call per turn while a goal is set and not yet reached; none otherwise.
async function judge($: EngineInterface, snap: TurnSnapshot) {
  const before = await read($, compass)
  if (!before.isActive || !before.goal || isArrived(before)) return

  await update($, compass, c => ({ ...c, isJudging: true }))
  let res: Awaited<ReturnType<typeof $.model.complete>>
  try {
    res = await $.model.complete({
      model: JUDGE_MODEL,
      system: judgeSystem(await langCode($)),
      prompt: judgePrompt(before, snap),
      maxTokens: 300,
      effort: 'low',
    })
  } catch {
    await update($, compass, c => ({ ...c, isJudging: false, note: { key: 'note.judge_failed', vars: { turn: snap.turn } } }))

    return
  }
  const verdict = res.isAnswered ? parseVerdict(res.text) : null
  // The goal may have changed while the judge was thinking; a verdict on the old goal is dropped.
  const isSameGoal = (c: Compass) =>
    c.isActive && c.goal?.destination === before.goal?.destination && currentSegment(c) === currentSegment(before)
  const after = await update($, compass, c =>
    !isSameGoal(c)
      ? { ...c, isJudging: false }
      : verdict
        ? { ...applyVerdict({ ...c, isJudging: false }, snap.turn, verdict), note: null }
        : { ...c, isJudging: false, note: { key: 'note.judge_failed', vars: { turn: snap.turn } } },
  )
  const last = after.steps[after.steps.length - 1]
  await logEvent($, 'judge', {
    turn: snap.turn,
    model: JUDGE_MODEL,
    ok: verdict !== null,
    ...(res.isAnswered ? (verdict ? {} : { why: 'unparsed', text: clip(res.text, 300) }) : { why: res.reason }),
    goal: before.goal.destination,
    kind: verdict ? last?.kind : undefined,
    height: last?.height,
    rows: before.goal.rows,
    reason: verdict?.reason,
    done: verdict?.done,
    pivot: verdict?.pivot,
    new_destination: verdict?.newDestination || undefined,
    tokens: res.usage,
  })
  if (last?.kind === 'arrive' && before.steps[before.steps.length - 1]?.kind !== 'arrive') {
    $.ui.toast((await strings($))('toast.arrived'))
  }
}

// ---------- tools ----------

// The tools are registered only once compass is turned on in a session. A registration lasts the session.
let isToolsRegistered = false

async function registerTools($: EngineInterface) {
  if (isToolsRegistered) return
  isToolsRegistered = true
  await $.tool.register({
    name: 'set_goal',
    description:
      "Saves the conversation's goal card for session-compass. Call it only when the /session-compass interview is over and the user has confirmed the card.",
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'Destination: what the user should have in hand when the conversation ends' },
        done: { type: 'string', description: 'A checkable condition for "done"' },
        avoid: { type: 'string', description: 'What to avoid; out of scope' },
        steps: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Estimated steps (turns) to the destination' },
      },
      required: ['destination', 'done', 'avoid', 'steps'],
    },
  })
  await $.tool.register({
    name: 'adjust_goal_height',
    description:
      'Changes only the number of steps when the goal is raised or lowered in the same direction. Call it only after the user confirms.',
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
        reason: { type: 'string', description: "Why, in the user's language" },
      },
      required: ['steps', 'reason'],
    },
  })
  await $.tool.register({
    name: 'propose_goal_change',
    description:
      "Proposes a new goal card when the goal's direction changes. It does not take effect until the user confirms it with the button in the session-compass pane.",
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        done: { type: 'string' },
        avoid: { type: 'string' },
        steps: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
        carry: { type: 'integer', minimum: 0, description: 'Steps of the work so far that still count toward the new goal' },
        reason: { type: 'string', description: "Why, in the user's language" },
      },
      required: ['destination', 'done', 'avoid', 'steps', 'carry', 'reason'],
    },
  })
}

type ToolInput = Record<string, unknown>

const OFF_RESULT = 'session-compass is off in this session. The user turns it on with /session-compass.'
const NO_GOAL_RESULT = 'There is no goal yet. The user sets one with /session-compass.'

// ---------- drawing ----------

const stepText = (t: T, s: Step) =>
  s.mark === 'start'
    ? t('step.start')
    : s.mark === 'pivot'
      ? t('step.pivot', { destination: s.reason })
      : s.mark === 'not-yet'
        ? t('step.not_yet')
        : s.reason || t('step.no_reason')

const ledSvg = (c: Compass, maxCols: number): string => {
  const rows = c.goal?.rows ?? 5
  const cell = 16
  const pad = 10
  const steps = c.steps.slice(-maxCols)
  const cols = Math.max(steps.length, Math.min(maxCols, 12))
  const width = pad * 2 + cols * cell
  const height = pad * 2 + (rows + 1) * cell + 10
  const seg = currentSegment(c)
  const y = (h: number) => pad + (rows - Math.min(h, rows)) * cell + cell / 2
  const x = (i: number) => pad + i * cell + cell / 2
  const parts: string[] = []

  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#0d0f12"/>`)
  for (let i = 0; i < cols; i++) {
    for (let level = 0; level <= rows; level++) {
      parts.push(`<circle cx="${x(i)}" cy="${y(level)}" r="4.5" fill="${level === rows ? '#3b3317' : '#1f242b'}"/>`)
    }
  }
  steps.forEach((s, i) => {
    if (s.kind === 'pivot' && i > 0) {
      const lx = x(i) - cell / 2
      parts.push(
        `<line x1="${lx}" y1="${pad - 2}" x2="${lx}" y2="${pad + (rows + 1) * cell + 2}" stroke="#4da3ff" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.8"/>`,
      )
    }
  })
  steps.forEach((s, i) => {
    const color = COLORS[s.kind]
    const opacity = s.segment === seg ? 1 : 0.3
    const isLast = i === steps.length - 1
    parts.push(
      `<circle cx="${x(i)}" cy="${y(s.height)}" r="7.5" fill="${color}" opacity="${0.22 * opacity}"/>`,
      `<circle cx="${x(i)}" cy="${y(s.height)}" r="4.8" fill="${color}" opacity="${opacity}"/>`,
    )
    if (isLast) {
      parts.push(
        `<circle cx="${x(i)}" cy="${y(s.height)}" r="7.5" fill="none" stroke="${color}" stroke-width="1.5"><animate attributeName="opacity" values="0.15;0.9;0.15" dur="1.6s" repeatCount="indefinite"/></circle>`,
      )
    }
    if (s.turn > 0 && (s.turn % 5 === 0 || isLast)) {
      parts.push(
        `<text x="${x(i)}" y="${height - 4}" font-size="8" fill="#5c6670" text-anchor="middle" font-family="monospace">${s.turn}</text>`,
      )
    }
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

const ledAlt = (t: T, c: Compass) => {
  const last = c.steps[c.steps.length - 1]
  if (!c.goal || !last) return t('pane.no_goal')

  return t('led.alt', { height: last.height, rows: c.goal.rows, reason: stepText(t, last) })
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: (await strings($))('pane.title') })
}

// The engine refuses a prompt.submit made while a command runs (it would wait on that unfinished turn).
// Send it once the turn is over.
function submitSoon($: EngineInterface, text: string) {
  $.clock.after(1, () => {
    void $.prompt.submit({ text })
  })
}

// Turns compass on for this session: the tools appear and turns are judged once a goal is set.
async function activate($: EngineInterface) {
  await update($, compass, c => ({ ...c, isActive: true }))
  await registerTools($)
}

// What the user answered to an arrival is the ground truth for the judge, so it is logged too.
async function answerArrival($: EngineInterface, event: string, change: (c: Compass) => Compass) {
  const c = await read($, compass)
  await update($, compass, change)
  await logEvent($, event, { goal: c.goal?.destination, turn: c.turn })
}

async function startNextGoal($: EngineInterface, seed = '') {
  const c = await update($, compass, finishGoal)
  submitSoon($, interviewPrompt(seed, c.finished[c.finished.length - 1] ?? ''))
}

function proposalButtons($: EngineInterface, t: T, Button: any, Box: any) {
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key="pivot-yes"
        label={t('btn.pivot_yes')}
        variant="primary"
        onPress={async () => {
          const c = await read($, compass)
          await update($, compass, confirmProposal)
          await logEvent($, 'pivot-yes', { goal: c.goal?.destination, to: c.proposal?.destination, turn: c.turn })
        }}
      />
      <Button
        key="pivot-no"
        label={t('btn.pivot_no')}
        onPress={async () => {
          const c = await read($, compass)
          await update($, compass, cur => ({ ...cur, proposal: null }))
          await logEvent($, 'pivot-no', { goal: c.goal?.destination, to: c.proposal?.destination, turn: c.turn })
        }}
      />
    </Box>
  )
}

function arrivalButtons($: EngineInterface, t: T, Button: any, Box: any) {
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key="arrive-next"
        label={t('btn.arrive_next')}
        variant="primary"
        onPress={async () => {
          const { goal, turn } = await read($, compass)
          await logEvent($, 'arrive-next', { goal: goal?.destination, turn })
          await startNextGoal($)
        }}
      />
      <Button key="arrive-finish" label={t('btn.arrive_finish')} onPress={() => answerArrival($, 'arrive-finish', finishGoal)} />
      <Button key="arrive-not-yet" label={t('btn.arrive_not_yet')} onPress={() => answerArrival($, 'arrive-not-yet', notArrivedYet)} />
    </Box>
  )
}

// ---------- module ----------

// Turn-local scratch; a reload only loses the turn in progress.
let prompts: string[] = []
let tools: string[] = []
let isSetupTurn = false
let isPluginTurn = false

// From the module's session.start: the commands, and after a reload the tools and pane of an active compass.
export async function startCompass($: EngineInterface) {
  await $.command.register({
    name: 'session-compass',
    description: 'Set a goal for this conversation and track progress in a pane; with words after it, change the goal',
    argumentHint: '[first thought | what to change]',
  })
  await $.command.register({ name: 'session-compass-show', description: 'Show the current session-compass goal' })
  await $.command.register({
    name: 'session-compass-reset',
    description: 'Clear the session-compass goal and path, and turn it off for this session',
  })
  const c = await read($, compass)
  if (c.isActive) {
    await registerTools($)
    if (c.goal) void openPane($)
  }
}

// From the module's prompt.submit: what the user said this turn, for the judge. A prompt this plugin sent
// (the goal-change brief, the interview) is not the user's words; a turn started only by one is not judged.
export function compassPrompt(text: string, isPlugin = false) {
  if (isPlugin) isPluginTurn = true
  else prompts.push(text)
}

export const registerCompass: Register = on => {
  prompts = []
  tools = []
  isSetupTurn = false
  isPluginTurn = false
  isToolsRegistered = false

  on('command.run', { command: 'session-compass' }, async ($, e) => {
    const args = e.args.trim()
    const c = await read($, compass)
    await activate($)
    await openPane($)
    if (isArrived(c)) {
      await logEvent($, 'arrive-next', { goal: c.goal?.destination, turn: c.turn })
      await startNextGoal($, args)

      return reply('Finished the goal; the interview for the next goal starts now.', 'cmd.compass.next')
    }
    if (c.goal && args) {
      submitSoon($, changePrompt(c.goal, args))

      return reply('The goal change starts now.', 'cmd.compass.change')
    }
    if (c.goal) {
      return reply(
        `Current goal: ${c.goal.destination}\nTo change it: /session-compass <what to change>. To clear it: /session-compass-reset`,
        'cmd.compass.current',
        { destination: c.goal.destination },
      )
    }
    submitSoon($, interviewPrompt(args, c.finished[c.finished.length - 1] ?? ''))

    return reply('The goal interview starts now.', 'cmd.compass.start')
  })

  on('command.run', { command: 'session-compass-show' }, async $ => {
    const c = await read($, compass)
    if (!c.goal) return reply('No goal yet. Set one with /session-compass.', 'cmd.show.none')
    await openPane($)
    const g = c.goal

    return reply(`Goal: ${g.destination}\nDone when: ${g.done}\nAvoid: ${g.avoid}`, 'cmd.show.goal', {
      destination: g.destination,
      done: g.done,
      avoid: g.avoid,
    })
  })

  on('command.run', { command: 'session-compass-reset' }, async $ => {
    await update($, compass, c => ({ ...EMPTY, turn: c.turn }))
    await $.ui.close({ id: PANE })

    return reply(
      'Cleared the goal and the path. session-compass is off in this session until /session-compass is run again.',
      'cmd.reset',
    )
  })

  // This plugin's own tools are typed only once the engine has laid their types, so the input is read loosely.
  on('tool.call', { tool: TOOL('set_goal') as any }, async ($, call) => {
    const e = call as unknown as ToolInput
    const c = await read($, compass)
    if (!c.isActive) return { result: OFF_RESULT }
    if (c.goal && !isArrived(c)) {
      return {
        result: `There is a goal already. To change the number of steps use ${TOOL('adjust_goal_height')}; to change the direction use ${TOOL('propose_goal_change')}.`,
      }
    }
    const goal: Goal = {
      destination: str(e.destination, '-'),
      done: str(e.done, '-'),
      avoid: str(e.avoid, '-'),
      rows: clampRows(e.steps),
    }
    isSetupTurn = true
    await update($, compass, cur => ({
      ...(isArrived(cur) ? finishGoal(cur) : cur),
      goal,
      segments: [{ destination: goal.destination, rows: goal.rows }],
      steps: [{ kind: 'start', height: 0, segment: 0, turn: cur.turn, reason: '', mark: 'start' } as Step],
      proposal: null,
      note: null,
    }))
    await logEvent($, 'goal-set', { ...goal, turn: c.turn })
    void openPane($)

    return { result: `Saved the goal (${goal.rows} steps). From now on each turn's progress shows in the session-compass pane.` }
  })

  on('tool.call', { tool: TOOL('adjust_goal_height') as any }, async ($, call) => {
    const e = call as unknown as ToolInput
    const c = await read($, compass)
    if (!c.isActive) return { result: OFF_RESULT }
    if (!c.goal) return { result: NO_GOAL_RESULT }
    const rows = clampRows(e.steps)
    isSetupTurn = true
    await update($, compass, cur => {
      if (!cur.goal) return cur
      const segments = cur.segments.map((s, i) => (i === cur.segments.length - 1 ? { ...s, rows } : s))

      return {
        ...cur,
        goal: { ...cur.goal, rows },
        segments,
        note: { key: 'note.height', vars: { from: cur.goal.rows, to: rows, reason: clip(str(e.reason), 40) } },
      }
    })

    return { result: `Changed the goal to ${rows} steps.` }
  })

  on('tool.call', { tool: TOOL('propose_goal_change') as any }, async ($, call) => {
    const e = call as unknown as ToolInput
    const c = await read($, compass)
    if (!c.isActive) return { result: OFF_RESULT }
    if (!c.goal) return { result: NO_GOAL_RESULT }
    const rows = clampRows(e.steps)
    const proposal: Proposal = {
      destination: str(e.destination, '-'),
      done: str(e.done, c.goal.done),
      avoid: str(e.avoid, c.goal.avoid),
      rows,
      carry: Math.max(0, Math.min(rows, Math.round(Number(e.carry) || 0))),
      reason: clip(str(e.reason), 60),
      from: 'model',
    }
    isSetupTurn = true
    await update($, compass, cur => ({ ...cur, proposal }))
    void openPane($)

    return {
      result:
        'Put the proposal in the session-compass pane. It takes effect only when the user presses the confirm button in the pane or above the prompt; tell the user so.',
    }
  })

  on('tool.call', ($, e, next) => {
    tools.push(String(e.tool))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await strings($)
    const c = await read($, compass)

    if (!c.goal) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{t('pane.no_goal')}</Text>
          <Text dimColor>{t('pane.no_goal_hint')}</Text>
          <Button
            key="start"
            label={t('pane.start')}
            variant="primary"
            onPress={async () => {
              await activate($)
              await startNextGoal($)
            }}
          />
          {c.finished.length > 0 && (
            <Box flexDirection="column">
              <Text bold>{t('pane.finished', { n: c.finished.length })}</Text>
              {c.finished.slice(-5).map(d => (
                <Text dimColor>★ {d}</Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const last = c.steps[c.steps.length - 1]
    const height = last?.height ?? 0
    const seg = currentSegment(c)
    const recent = c.steps.slice(-6).reverse()
    const cols = Math.max(8, Math.min(60, Math.floor(((e.props.bodyColumns || 40) * 7.5 - 20) / 16)))
    const status = [
      t('pane.progress', { height, rows: c.goal.rows }),
      last?.kind === 'arrive' ? t('pane.arrived') : '',
      c.isJudging ? t('pane.judging') : '',
      c.note ? t(c.note.key, c.note.vars) : '',
    ]
      .filter(Boolean)
      .join(' · ')
    let board

    if (e.surface === 'terminal') {
      const view = c.steps.slice(-Math.max(8, (e.props.bodyColumns || 40) - 6))
      const rows = []
      for (let level = c.goal.rows; level >= 0; level--) {
        rows.push(
          <Box key={`r${level}`} flexDirection="row">
            {view.map(s =>
              s.height === level ? (
                <Text color={COLORS[s.kind]} dimColor={s.segment !== seg}>
                  ●
                </Text>
              ) : (
                <Text dimColor>{level === c.goal!.rows ? '○' : '·'}</Text>
              ),
            )}
          </Box>,
        )
      }
      board = <Box flexDirection="column">{rows}</Box>
    } else {
      const { Svg } = $.ui.resolve(e)
      board = <Svg source={ledSvg(c, cols)} alt={ledAlt(t, c)} />
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>🎯 {c.goal.destination}</Text>
          <Text dimColor>{status}</Text>
        </Box>
        {board}
        {isArrived(c) && (
          <Box flexDirection="column" borderStyle="round" borderColor="#ffd700" paddingX={1}>
            <Text bold>{t('pane.arrived_title')}</Text>
            <Text dimColor>{last ? stepText(t, last) : ''}</Text>
            {arrivalButtons($, t, Button, Box)}
          </Box>
        )}
        {c.proposal && (
          <Box flexDirection="column" borderStyle="round" borderColor="#4da3ff" paddingX={1}>
            <Text bold>{t('pane.pivot_title')}</Text>
            <Text>→ {c.proposal.destination}</Text>
            <Text dimColor>{t('pane.pivot_detail', { reason: c.proposal.reason, carry: c.proposal.carry, rows: c.proposal.rows })}</Text>
            {proposalButtons($, t, Button, Box)}
          </Box>
        )}
        <Text dimColor>{t('pane.legend')}</Text>
        <Box flexDirection="column">
          {recent.map(s => (
            <Text dimColor={s.segment !== seg}>
              <Text color={COLORS[s.kind]}>{ARROWS[s.kind]}</Text> T{s.turn} {stepText(t, s)}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>{t('pane.done', { done: c.goal.done })}</Text>
          <Text dimColor>{t('pane.avoid', { avoid: c.goal.avoid })}</Text>
        </Box>
      </Box>
    )
  })
}

// From the module's turn.complete, for a turn of the main conversation (not a subagent's).
export async function compassTurnEnd($: EngineInterface, e: { answer: string; reason: string }) {
  const snap: TurnSnapshot = { turn: 0, prompt: prompts.join('\n---\n'), answer: e.answer, tools }
  const wasSetup = isSetupTurn || (isPluginTurn && !prompts.length)
  prompts = []
  tools = []
  isSetupTurn = false
  isPluginTurn = false
  const c = await update($, compass, cur => ({ ...cur, turn: cur.turn + 1 }))
  snap.turn = c.turn

  // Judge outside this dispatch, so the turn ends without waiting on the model.
  if (!wasSetup && e.reason === 'answer' && c.isActive && c.goal && !isArrived(c)) {
    $.clock.after(1, () => {
      void judge($, snap)
    })
  }
}

// The compass's part of the seat above the prompt, or null when it has nothing to show: the arrival
// check, then the goal-change check, then the warning after two turns off course.
export async function compassBand($: EngineInterface, e: any) {
  const c = await read($, compass)
  if (!c.isActive || !c.goal) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const t = await strings($)

  if (isArrived(c)) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="#ffd700">{t('band.arrived', { destination: clip(c.goal.destination, 40) })}</Text>
        {arrivalButtons($, t, Button, Box)}
      </Box>
    )
  }

  if (c.proposal) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="#4da3ff">{t('band.pivot', { destination: clip(c.proposal.destination, 40) })}</Text>
        {proposalButtons($, t, Button, Box)}
      </Box>
    )
  }

  // "Not yet" is the user's word on arrival, not a turn of work: it does not count toward drifting.
  const tail = c.steps.filter(s => s.segment === currentSegment(c) && s.mark !== 'not-yet').slice(-2)
  const isDrifting = tail.length === 2 && tail.every(s => s.kind === 'flat' || s.kind === 'down')
  if (!isDrifting || !tail[1]) return null

  return (
    <Box flexDirection="row">
      <Text color="#ff4b4b">{t('band.drift', { reason: stepText(t, tail[1]) })}</Text>
    </Box>
  )
}
