import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, GapKind, GapQuestion } from '../types'

// The criteria question card. After a turn ends, a judge model looks for one gap in the
// user's thinking (an omitted premise, a mixed distinction, a principle, a missing criterion)
// and, within the configured limits, shows one question above the prompt.
// Off by default: on only where .hus-criteria-gap/config.json (project, else global) has
// "card": true. With the card off it calls no model and draws nothing.
// The limits (intensity, max_per_session, cooldown_turns) come from the same file's "hook"
// section, which the UserPromptSubmit command hook (criteria_hook.py) reads too.

// The plugin's name is written once, in the state reference below, which needs it as a literal;
// everything else reads it from the manifest as $.plugin.name.
const SHORT = 'hus-criteria-gap'
// Project and home folder of this plugin: .hus-criteria-gap/ and ~/.hus-criteria-gap/.
const DATA_DIR = `.${SHORT}`
const JUDGE_LOG_DIR = 'judge-log'
const TAG = `[${SHORT}]`
const ANSWER_TAG = `[${SHORT} answer]`
// A skill of this plugin by its full name.
const skill = ($: EngineInterface, name: string) => `${$.plugin.name}:${name}`
// For text only: the registration and the command.run matcher spell it as a literal, as the
// engine's scan reads it there.
const COMMAND = 'criteria-check'
const QUESTION_MODEL = 'sonnet'
// An unanswered question is taken down after this many turns.
const EXPIRE_TURNS = 3
const DONT_KNOW = "I don't know"
const LANG_CODE = /^[a-z]{2,3}$/
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/

const EMPTY: Card = { turn: 0, question: null, asked: 0, lastAskTurn: -999, isHangul: false }

// Bump the tag when Card changes shape: older stored values read as EMPTY.
const card = atom({ plugin: 'hack-user-skills-criteria-gap', key: 'card' } as const, EMPTY, { shape: 'card-1' })

const KINDS: GapKind[] = ['premise', 'distinction', 'principle', 'criterion']

// How the answer tag names each kind for Claude. The labels a person reads are in locales/.
const KIND_NAME: Record<GapKind, string> = {
  premise: 'omitted premise',
  distinction: 'distinction',
  principle: 'principle',
  criterion: 'criterion',
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

// ---------- settings (same lookup as criteria_hook.py) ----------

type Dirs = { project: string | null; global: string | null }

type Intensity = 'light' | 'active'

type Settings = {
  card: boolean
  lang: string | null
  intensity: Intensity
  max_per_session: number
  cooldown_turns: number
  dirs: Dirs
}

const LIMITS = { intensity: 'light' as Intensity, max_per_session: 3, cooldown_turns: 3 }

const home = async ($: EngineInterface) => ((await $.env.get('HOME')) ?? '').replace(/\/+$/, '')

// The nearest .hus-criteria-gap/ from the working directory up to HOME, and ~/.hus-criteria-gap/.
async function findDirs($: EngineInterface): Promise<Dirs> {
  const homeDir = await home($)
  let dir = (await $.session.cwd()).replace(/\/+$/, '') || '/'
  let project: string | null = null
  for (let i = 0; i < 64; i++) {
    if (await $.fs.exists(`${dir}/${DATA_DIR}`)) {
      project = `${dir}/${DATA_DIR}`
      break
    }
    if (dir === homeDir || dir === '/') break
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  const global = homeDir && (await $.fs.exists(`${homeDir}/${DATA_DIR}`)) ? `${homeDir}/${DATA_DIR}` : null

  return { project, global }
}

// The project's config.json if it has one, else the global one. A broken file counts as off.
async function loadSettings($: EngineInterface): Promise<Settings> {
  const off: Settings = { card: false, lang: null, ...LIMITS, dirs: { project: null, global: null } }
  try {
    const dirs = await findDirs($)
    for (const dir of [dirs.project, dirs.global]) {
      if (!dir || !(await $.fs.exists(`${dir}/config.json`))) continue
      try {
        const raw = JSON.parse(await $.fs.read(`${dir}/config.json`)) ?? {}
        const hook = typeof raw.hook === 'object' && raw.hook !== null ? raw.hook : {}

        return {
          card: raw.card === true,
          lang: typeof raw.lang === 'string' ? raw.lang : null,
          intensity: hook.intensity === 'active' ? 'active' : 'light',
          max_per_session: Number.isFinite(hook.max_per_session) ? hook.max_per_session : LIMITS.max_per_session,
          cooldown_turns: Number.isFinite(hook.cooldown_turns) ? hook.cooldown_turns : LIMITS.cooldown_turns,
          dirs,
        }
      } catch {
        return { ...off, dirs }
      }
    }

    return { ...off, dirs }
  } catch {
    return off
  }
}

// Only the confirmed lines of INDEX.md, so the judge does not ask what is already settled.
async function confirmedIndex($: EngineInterface, dirs: Dirs): Promise<string[]> {
  const lines: string[] = []
  for (const dir of [dirs.project, dirs.global === dirs.project ? null : dirs.global]) {
    if (!dir || !(await $.fs.exists(`${dir}/INDEX.md`))) continue
    try {
      const text = await $.fs.read(`${dir}/INDEX.md`)
      lines.push(...text.split('\n').filter(l => l.includes('· confirmed ·')))
    } catch {
      // An unreadable INDEX.md adds nothing.
    }
  }

  return lines.slice(0, 15).map(l => clip(l.trim(), 200))
}

// ---------- strings a person reads (hooks/locales/<code>.json) ----------

type Strings = Record<string, string>
type T = (key: string, vars?: Record<string, string>) => string

// Read once per load. A missing or broken file reads as null.
const localeCache = new Map<string, Strings | null>()

async function readLocale($: EngineInterface, code: string): Promise<Strings | null> {
  if (!LANG_CODE.test(code)) return null
  if (localeCache.has(code)) return localeCache.get(code) ?? null
  let strings: Strings | null = null
  try {
    const raw = JSON.parse(await $.fs.read(`${$.plugin.root}/hooks/locales/${code}.json`))
    if (raw && typeof raw === 'object') {
      strings = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Strings
    }
  } catch {
    strings = null
  }
  localeCache.set(code, strings)

  return strings
}

// `lang` from the config, else Korean when the user writes in Hangul, else English.
async function pickLang($: EngineInterface, settings: Settings, isHangul: boolean): Promise<string> {
  for (const code of [settings.lang, isHangul ? 'ko' : null]) {
    if (code && (await readLocale($, code))) return code
  }

  return 'en'
}

// English is the full default; the chosen language is laid over it; a missing key shows as itself.
async function translator($: EngineInterface, settings: Settings): Promise<T> {
  const lang = await pickLang($, settings, (await read($, card)).isHangul)
  const strings = { ...((await readLocale($, 'en')) ?? {}), ...(lang === 'en' ? {} : ((await readLocale($, lang)) ?? {})) }

  return (key, vars = {}) =>
    (strings[key] ?? key).replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? vars[name]! : all))
}

// ---------- the judge ----------

const RULE: Record<Intensity, string> = {
  light:
    '- Ask only when, without the answer, the next piece of work would clearly go wrong or the user would clearly decide wrongly. When in doubt, do not ask.',
  active: '- Ask when one of the four kinds above is clearly there and the answer would change the result.',
}

const judgeSystem = (intensity: Intensity) => `You look at one turn of a conversation between a person and an AI that just ended (the user's message and the AI's answer). If there is a gap in the user's thinking, you pick one question to ask them.

## Gap check
You check the user's thinking, not the AI's.

What to look for (kind):
- "premise", an omitted premise: the user's request rests on an assumption they did not state, and the AI filled it in on its own.
- "distinction", a distinction: the user mixed two different things under one word, or did not say which of the two they meant, and the result depends on it.
- "principle", understanding a principle: the user made or accepted a judgement or decision, and a question they could answer at once if they understood the principle behind it is worth asking to check that understanding.
- "criterion", a judgement criterion: the user left choosing, filtering or evaluating to the AI without a criterion, and the AI used an implicit one.

When to ask:
- You must be able to quote, briefly and exactly, the user's own words the question rests on. If you cannot, do not ask.
- The answer must change the next piece of work or the user's decision. If it is minor, do not ask.
${RULE[intensity]}
- Do not ask what the confirmed criteria already answer.
- Do not ask on a turn that holds only a greeting, thanks, a plain confirmation or a go-ahead ("yes", "go on").

How to write the question:
- One question, at most 120 characters, written in the language the user writes in, politely. Concrete enough that the user can answer in their own words.
- Do not reveal the AI's answer or the criterion the AI used. The user should say what they think first.
- options: when multiple choice fits, 2 to 4 options that do not overlap, each at most 40 characters, in the user's language. "principle" and "distinction" are usually multiple choice; "premise" and "criterion" are usually free answers, so leave options empty. Do not add "don't know"; the card has its own.
- quote: the user's words exactly as written, at most 60 characters. why: why it is worth asking now, at most 40 characters.

Output one JSON object and nothing else.
{"ask":false,"kind":"premise|distinction|principle|criterion","question":"","options":[],"quote":"","why":""}`

type TurnSnapshot = { turn: number; prompt: string; answer: string; tools: string[] }

const judgePrompt = (turn: TurnSnapshot, known: string[]) =>
  [
    'Confirmed criteria:',
    known.length ? known.join('\n') : '(none)',
    '',
    `The user's message this turn:\n${clip(turn.prompt || '(none)', 2500)}`,
    '',
    `The AI's answer this turn:\n${clip(turn.answer || '(none)', 3500)}`,
    turn.tools.length ? `\nTools used this turn: ${turn.tools.slice(0, 30).join(', ')}` : '',
  ].join('\n')

// The question part of the verdict. No quote of the user's words, no question.
const parseQuestion = (raw: Record<string, unknown>, turn: number): GapQuestion | null => {
  const kind = KINDS.find(k => k === raw.kind)
  const question = oneLine(raw.question)
  const quote = oneLine(raw.quote)
  if (raw.ask !== true || !kind || !question || !quote) return null
  const options = Array.isArray(raw.options)
    ? [...new Set(raw.options.map(o => oneLine(o)).filter(Boolean))].slice(0, 4).map(o => clip(o, 40))
    : []

  return { kind, question: clip(question, 160), options, quote: clip(quote, 80), why: clip(oneLine(raw.why), 60), turn }
}

type Verdict = { question: GapQuestion | null }

const parseVerdict = (text: string, turn: number): Verdict | null => {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return { question: parseQuestion(JSON.parse(match[0]) as Record<string, unknown>, turn) }
  } catch {
    return null
  }
}

// ---------- the judge log ----------

// One file per session, outside the repository, to look back on whether the judge asked well.
// The engine has no append, so lines are queued and the file rewritten. A failed write never
// stops the card.
let logQueue: Promise<void> = Promise.resolve()

function logEvent($: EngineInterface, event: string, fields: Record<string, unknown>): Promise<void> {
  logQueue = logQueue.then(async () => {
    try {
      const homeDir = await home($)
      if (!homeDir) return
      const project = (await $.session.root()).replace(/[^A-Za-z0-9._-]+/g, '-')
      const session = (await $.session.id()).replace(/[^A-Za-z0-9._-]+/g, '-')
      const path = `${homeDir}/${DATA_DIR}/${JUDGE_LOG_DIR}/${project}/${session}.jsonl`
      const old = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
      const at = new Date(await $.clock.now()).toISOString()
      await $.fs.write(path, `${old}${JSON.stringify({ at, event, ...fields })}\n`)
    } catch {
      // Not logged; the session goes on.
    }
  })

  return logQueue
}

type JudgeOutcome = 'asked' | 'none' | 'failed'

// Calls the model once when the limits allow a question. `force` is /criteria-check: it
// ignores the session cap and the cooldown.
async function judge($: EngineInterface, snap: TurnSnapshot, settings: Settings, force = false): Promise<JudgeOutcome> {
  const before = await read($, card)
  // A question has to rest on the user's words, so a turn without any asks nothing.
  if (!settings.card || before.question !== null || snap.prompt.trim() === '') return 'none'
  const isAllowed =
    force || (before.asked < settings.max_per_session && snap.turn - before.lastAskTurn > settings.cooldown_turns)
  if (!isAllowed) return 'none'

  const known = await confirmedIndex($, settings.dirs)
  const res = await $.model.complete({
    model: QUESTION_MODEL,
    system: judgeSystem(settings.intensity),
    prompt: judgePrompt(snap, known),
    maxTokens: 700,
    effort: 'low',
  })
  const verdict = res.isAnswered ? parseVerdict(res.text, snap.turn) : null
  const question = verdict?.question ?? null
  const after = await update($, card, c =>
    !question || c.question ? c : { ...c, question, asked: c.asked + 1, lastAskTurn: snap.turn },
  )
  await logEvent($, 'judge', {
    turn: snap.turn,
    model: QUESTION_MODEL,
    forced: force || undefined,
    ok: verdict !== null,
    ...(res.isAnswered ? (verdict ? {} : { why: 'unparsed', text: clip(res.text, 300) }) : { why: res.reason }),
    question,
    tokens: res.usage,
  })
  if (!verdict) return 'failed'

  return question !== null && after.question === question ? 'asked' : 'none'
}

// ---------- the card ----------

const answerPrompt = ($: EngineInterface, q: GapQuestion, answer: string) =>
  [
    ANSWER_TAG,
    `Kind: ${KIND_NAME[q.kind]}`,
    `Question: ${q.question}`,
    q.options.length ? `Options: ${q.options.join(' / ')}` : '',
    `My words it rests on: "${q.quote}"`,
    `My answer: ${answer}`,
    `This is my answer to the question card of ${$.plugin.name}. How to handle it: the "Card answers" section of the ${skill($, 'criteria-gap')} skill.`,
  ]
    .filter(Boolean)
    .join('\n')

// Added to every prompt while the card is on, so Claude knows who asks about gaps here.
const SESSION_NOTE = `${TAG} The question card is on in this session. After a turn ends, this plugin may ask the user about one gap in their thinking (an omitted premise, a mixed distinction, a principle, a missing criterion) in a card above the prompt. The answer comes back as a message that starts with "${ANSWER_TAG}". Asking the user about such gaps in this session is left to the card.`

async function reply($: EngineInterface, answer: string) {
  const q = (await read($, card)).question
  if (!q || !answer.trim()) return
  await update($, card, c => ({ ...c, question: null }))
  await logEvent($, 'question-answered', { kind: q.kind, question: q.question, turn: q.turn })
  await $.prompt.submit({ text: answerPrompt($, q, answer.trim()) })
}

async function skip($: EngineInterface) {
  const q = (await read($, card)).question
  if (!q) return
  await update($, card, c => ({ ...c, question: null }))
  await logEvent($, 'question-skipped', { kind: q.kind, question: q.question, turn: q.turn })
}

function questionCard($: EngineInterface, els: Record<string, any>, q: GapQuestion, t: T) {
  const { Box, Text, Button } = els
  // Some mobile apps draw no field; the options and "don't know" still show there.
  const Input = els.Input

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#c792ea" paddingX={1}>
      <Text bold color="#c792ea">
        {t('card.title', { kind: t(`kind.${q.kind}`) })}
      </Text>
      <Text>{q.question}</Text>
      <Text dimColor>{t('card.quote', { quote: q.quote })}</Text>
      {q.options.length > 0 && (
        <Box flexDirection="column">
          {q.options.map((o, i) => (
            <Button key={`gap-opt-${i}`} label={o} hotkey={String(i + 1)} onPress={() => reply($, o)} />
          ))}
        </Box>
      )}
      {Input && (
        <Input
          key="gap-free"
          label={t('card.free.label')}
          placeholder={t('card.free.placeholder')}
          submitLabel={t('card.free.submit')}
          onSubmit={(v: string) => reply($, v)}
        />
      )}
      <Box flexDirection="row" gap={1}>
        <Button key="gap-unknown" label={t('card.unknown')} onPress={() => reply($, DONT_KNOW)} />
        <Button key="gap-skip" label={t('card.skip')} onPress={() => skip($)} />
      </Box>
    </Box>
  )
}

// What /criteria-check tells Claude beside the line the user reads.
const checkContext = ($: EngineInterface): Record<string, string> => ({
  'check.off': `${TAG} /${COMMAND} did nothing: the question card is off here. It is turned on with the ${skill($, 'criteria-init')} skill ("card": true in config.json).`,
  'check.pending': `${TAG} /${COMMAND} did nothing: a question card is already waiting for the user's answer.`,
  'check.no_turn': `${TAG} /${COMMAND} did nothing: no turn of this session has been seen yet.`,
  'check.asked': `${TAG} /${COMMAND} put a question card above the prompt. The user's answer will come as a "${ANSWER_TAG}" message; do not ask the same thing in the chat.`,
  'check.none': `${TAG} /${COMMAND} checked the last turn and found no gap worth asking about.`,
  'check.failed': `${TAG} /${COMMAND} could not get a verdict from the judge model.`,
})

// ---------- module ----------

export const register: Register = on => {
  // Turn-local scratch; a reload only loses the turn in progress.
  let prompts: string[] = []
  let tools: string[] = []
  // The last turn, for /criteria-check.
  let lastSnap: TurnSnapshot | null = null

  on('session.start', async ($, e, next) => {
    const t = await translator($, await loadSettings($))
    await $.command.register({ name: 'criteria-check', description: t('command.description') })

    return next(e)
  })

  on('command.run', { command: 'criteria-check' }, async $ => {
    const settings = await loadSettings($)
    const answer = async (key: string) => ({
      text: (await translator($, settings))(key),
      context: [checkContext($)[key]!],
    })
    if (!settings.card) return answer('check.off')
    if ((await read($, card)).question) return answer('check.pending')
    if (!lastSnap) return answer('check.no_turn')
    const outcome = await judge($, lastSnap, settings, true)

    return answer(outcome === 'asked' ? 'check.asked' : outcome === 'failed' ? 'check.failed' : 'check.none')
  })

  on('tool.call', ($, e, next) => {
    tools.push(String(e.tool))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    prompts.push(e.text)
    if (HANGUL.test(e.text) && !(await read($, card)).isHangul) {
      await update($, card, c => ({ ...c, isHangul: true }))
    }
    if (!(await loadSettings($)).card) return next(e)

    return next({ ...e, context: [...(e.context ?? []), SESSION_NOTE] })
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result

    const snap: TurnSnapshot = { turn: 0, prompt: prompts.join('\n---\n'), answer: e.answer, tools }
    prompts = []
    tools = []
    const settings = await loadSettings($)
    if (!settings.card) {
      // Turned off while a question waited: take it down. Turns are not counted while off.
      const c = await read($, card)
      if (c.question) await update($, card, cur => ({ ...cur, question: null }))
      snap.turn = c.turn
      if (snap.prompt.trim()) lastSnap = snap

      return result
    }

    const c = await update($, card, cur => {
      const turn = cur.turn + 1
      const isStale = cur.question !== null && turn - cur.question.turn >= EXPIRE_TURNS

      return { ...cur, turn, question: isStale ? null : cur.question }
    })
    snap.turn = c.turn
    if (snap.prompt.trim()) lastSnap = snap

    // Judge outside this dispatch, so the turn ends without waiting on the model.
    if (e.reason === 'answer') {
      $.clock.after(1, () => {
        void judge($, snap, settings)
      })
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const q = (await read($, card)).question
    if (!q) return next(e)
    const settings = await loadSettings($)
    if (!settings.card) return next(e)

    return questionCard($, $.ui.resolve(e), q, await translator($, settings))
  })
}
