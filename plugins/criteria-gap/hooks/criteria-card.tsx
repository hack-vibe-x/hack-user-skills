import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, GapKind, GapQuestion, Pending } from '../types'

// The question card. People move on from an AI's answer without reading it closely, believe they
// understood when they did not, and miss a premise or a gap in the reasoning. When a turn ends, a
// judge model looks at the AI's previous answer, the user's message after it and the AI's new answer
// for one such gap that would change the result, and shows one question above the prompt. The user
// fills the gap in their own words; the answer goes to Claude as a message.
//
// On by default; off where .hus-criteria-gap/config.json (project, else global) says "card": false.
// How many: BASE questions per block of BLOCK_TURNS turns (moved by "pace" in the same file), one
// more after an answer that shows a real gap, one fewer after one that shows understanding or a
// question skipped or left alone, never closer than GAP_TURNS turns apart.
// Each finished question is written to ~/.hus-criteria-gap/log/<project>/<date>.md.

// The plugin's name is written once, in the state reference below, which needs it as a literal;
// everything else reads it from the manifest as $.plugin.name.
const SHORT = 'hus-criteria-gap'
const DATA_DIR = `.${SHORT}`
const LOG_DIR = 'log'
const TAG = `[${SHORT}]`
const ANSWER_TAG = `[${SHORT} answer]`
const skill = ($: EngineInterface, name: string) => `${$.plugin.name}:${name}`
// For text only: the registration and the command.run matcher spell it as a literal, as the
// engine's scan reads it there.
const COMMAND = 'criteria-check'
const MODEL = 'sonnet'

const BASE = 3
const MIN_ALLOWED = 1
const MAX_ALLOWED = 6
const BLOCK_TURNS = 30
const GAP_TURNS = 2
// An unanswered question is taken down after this many turns.
const EXPIRE_TURNS = 3
// A turn whose AI text (previous answer and new answer) is shorter than this has little to misread.
const MIN_READ = 400
const MAX_HISTORY = 10

const DONT_KNOW = "I don't know"
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/

const KINDS: GapKind[] = ['skipped', 'premise', 'misread', 'distinction', 'understanding']

// How the answer tag names each kind for Claude. The labels a person reads are in locales/.
const KIND_NAME: Record<GapKind, string> = {
  skipped: 'a point in your previous answer I moved on from',
  premise: 'a premise I had not stated',
  misread: 'a premise I may have taken differently',
  distinction: 'two things under one word',
  understanding: 'whether I understood',
}

const EMPTY: Card = {
  turn: 0,
  question: null,
  pending: null,
  blockStart: 0,
  asked: 0,
  shift: 0,
  lastAskTurn: -999,
  history: [],
  isHangul: false,
}

// Bump the tag when Card changes shape: older stored values read as EMPTY.
const card = atom({ plugin: 'hack-user-skills-criteria-gap', key: 'card' } as const, EMPTY, { shape: 'card-2' })

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)
const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// ---------- settings ----------

// `broken` is the path of a config.json that could not be read; the card is off then.
type Settings = { card: boolean; pace: number; broken: string | null }

// Windows spells paths with backslashes, which the engine takes as slashes too.
const slash = (path: string) => path.replace(/\\/g, '/')

// HOME, else USERPROFILE (Windows sets only that one).
const home = async ($: EngineInterface) => slash((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/\/+$/, '')

// The nearest .hus-criteria-gap/ from the working directory up to HOME, and ~/.hus-criteria-gap/.
async function settingsFiles($: EngineInterface): Promise<string[]> {
  const homeDir = await home($)
  const global = homeDir ? `${homeDir}/${DATA_DIR}` : null
  let dir = slash(await $.session.cwd()).replace(/\/+$/, '') || '/'
  let project: string | null = null
  for (let i = 0; i < 64; i++) {
    if (await $.fs.exists(`${dir}/${DATA_DIR}`)) {
      project = `${dir}/${DATA_DIR}`
      break
    }
    const cut = dir.lastIndexOf('/')
    if (dir === homeDir || dir === '/' || cut < 0) break
    dir = dir.slice(0, cut) || '/'
  }

  // Walking up from a folder under HOME reaches ~/.hus-criteria-gap/ itself; that is the global folder, not a project.
  return [project === global ? null : project, global].filter((d): d is string => !!d).map(d => `${d}/config.json`)
}

// The project's config.json if it has one, else the global one, else on. A broken file counts as off.
async function loadSettings($: EngineInterface): Promise<Settings> {
  try {
    for (const path of await settingsFiles($)) {
      if (!(await $.fs.exists(path))) continue
      try {
        const raw = JSON.parse(await $.fs.read(path)) ?? {}

        return { card: raw.card !== false, pace: Number.isInteger(raw.pace) ? raw.pace : 0, broken: null }
      } catch {
        return { card: false, pace: 0, broken: path }
      }
    }
  } catch {
    // Settings could not be read: the default.
  }

  return { card: true, pace: 0, broken: null }
}

// Questions this block may ask: the base moved by "pace", then by the user's answers.
const base = (s: Settings) => clamp(BASE + s.pace, MIN_ALLOWED, MAX_ALLOWED)
const allowed = (c: Card, s: Settings) => clamp(base(s) + c.shift, MIN_ALLOWED, MAX_ALLOWED)
// One step up or down, kept so that the allowance stays within its range.
const moved = (c: Card, s: Settings, step: number) => clamp(base(s) + c.shift + step, MIN_ALLOWED, MAX_ALLOWED) - base(s)

// ---------- quotes ----------

// For comparing a quote with the text: one script form, one kind of quotation mark, no case, single spaces.
const normQuote = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

// True when every piece of the quote (split where words were left out with "…" or "...") is in the
// text, in order. Quotation marks around the quote do not count.
function isQuoteIn(quote: string, source: string): boolean {
  const text = normQuote(source)
  const pieces = normQuote(quote)
    .split(/…|\.{3,}/)
    .map(p => p.replace(/^[\s"'`「『]+|[\s"'`」』]+$/g, ''))
    .filter(Boolean)
  if (pieces.length === 0) return false
  let from = 0
  for (const piece of pieces) {
    const at = text.indexOf(piece, from)
    if (at === -1) return false
    from = at + piece.length
  }

  return true
}

// ---------- strings a person reads (hooks/locales/<code>.json) ----------

type T = (key: string, vars?: Record<string, string>) => string

const localeCache = new Map<string, Record<string, string> | null>()

async function readLocale($: EngineInterface, code: string): Promise<Record<string, string> | null> {
  if (localeCache.has(code)) return localeCache.get(code) ?? null
  let strings: Record<string, string> | null = null
  try {
    const raw = JSON.parse(await $.fs.read(`${$.plugin.root}/hooks/locales/${code}.json`))
    if (raw && typeof raw === 'object') {
      strings = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    }
  } catch {
    strings = null
  }
  localeCache.set(code, strings)

  return strings
}

// Korean when the user writes in Hangul, else English. English fills any key a language lacks.
async function translator($: EngineInterface): Promise<T> {
  const lang = (await read($, card)).isHangul ? 'ko' : 'en'
  const strings = { ...((await readLocale($, 'en')) ?? {}), ...(lang === 'en' ? {} : ((await readLocale($, lang)) ?? {})) }

  return (key, vars = {}) =>
    (strings[key] ?? key).replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? vars[name]! : all))
}

// ---------- notices ----------

// Lines the user sees once per session, in their language. They never touch the conversation.
const told = new Set<string>()

async function notify($: EngineInterface, key: string, vars: Record<string, string> = {}) {
  if (told.has(key)) return
  told.add(key)
  $.ui.toast((await translator($))(key, vars), { timeoutMs: 12000 })
}

// ---------- the judge ----------

const JUDGE_SYSTEM = `You look at one moment of a conversation between a person and an AI: the AI's previous answer, the user's message after it, and the AI's answer to that message. People often move on without reading an answer closely, believe they understood when they did not, miss a gap in the reasoning, do not notice a premise, or take a different premise for the one in play. If that happened here and it matters, you pick one question that makes the user fill the gap in their own words.

## What to look for (kind)
- "skipped": the AI's previous answer raised a point the user had to settle or take into account (a choice that depends on them, a condition, a caveat or trade-off it warned about, a question back), and the user's message moved on without settling or acknowledging it.
- "premise": the user's request, or the AI's answer to it, rests on something the user never stated and the AI filled in on its own (who it is for, what counts as good, a number, a scope, a criterion for choosing).
- "misread": the user's message rests on a different premise from the one the AI's answer used (another period, audience, unit or goal).
- "distinction": the user used one word for two different things, or did not say which of two they meant, and the result depends on it.
- "understanding": the user just accepted or built on an explanation or decision, and one question they could answer at once if they understood why would show whether they did.

## When to ask
- Only when a wrong guess here would change the result, or the next steps are being built on it. When in doubt, do not ask.
- You must quote, briefly and exactly, the words the question rests on: from the user's message (quote_from "user") or from one of the AI's answers (quote_from "ai"). If you cannot, do not ask.
- Do not ask what the user already settled, or what the questions already asked in this session cover.
- This is about the user's understanding, not the AI's mistakes.
- When there is more than one, pick what the user moved on from in the AI's previous answer ("skipped", "misread") before details the AI's new answer added on its own; among those, the one that changes the most.

## How to write the question
- Never ask whether they understood ("Is that clear?", "Did you get it?"); people say yes when they do not. Make them produce the answer: choose between the readings, or say in one line what they meant, what they assume, or why.
- Do not give away the answer you expect.
- One question, at most 100 characters, in the language the user writes in.
- options: for "skipped" and "distinction" when the choice is between known alternatives, 2 to 4 short options (at most 40 characters each, in the user's language); otherwise leave it empty for a free answer. Do not add "don't know"; the card has its own.
- quote: at most 60 characters, copied exactly. why: why it matters now, at most 40 characters.

Output one JSON object and nothing else.
{"ask":false,"kind":"skipped|premise|misread|distinction|understanding","question":"","options":[],"quote":"","quote_from":"user|ai","why":""}`

type TurnSnapshot = { turn: number; before: string; prompt: string; answer: string; tools: string[] }

const judgePrompt = (snap: TurnSnapshot, history: Card['history']) =>
  [
    'Questions already asked in this session:',
    history.length ? history.map(h => `- ${h.question} → ${h.answer}`).join('\n') : '(none)',
    '',
    `The AI's previous answer:\n${clip(snap.before || '(none)', 2500)}`,
    '',
    `The user's message:\n${clip(snap.prompt || '(none)', 2000)}`,
    '',
    `The AI's answer to it:\n${clip(snap.answer || '(none)', 3500)}`,
    snap.tools.length ? `\nTools used this turn: ${snap.tools.slice(0, 30).join(', ')}` : '',
  ].join('\n')

// The question in the verdict, kept only when its quote is really in the words it names.
function parseQuestion(text: string, snap: TurnSnapshot): { ok: boolean; question: GapQuestion | null } {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { ok: false, question: null }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return { ok: false, question: null }
  }
  const kind = KINDS.find(k => k === raw.kind)
  const question = oneLine(raw.question)
  const quote = oneLine(raw.quote)
  if (raw.ask !== true || !kind || !question || !quote) return { ok: true, question: null }
  const ai = `${snap.before}\n${snap.answer}`
  const quoteFrom =
    raw.quote_from === 'ai' ? (isQuoteIn(quote, ai) ? 'ai' : null)
    : isQuoteIn(quote, snap.prompt) ? 'user'
    : null
  if (!quoteFrom) return { ok: true, question: null }
  const options = Array.isArray(raw.options)
    ? [...new Set(raw.options.map(o => oneLine(o)).filter(Boolean))].slice(0, 4).map(o => clip(o, 40))
    : []

  return {
    ok: true,
    question: { kind, question: clip(question, 160), options, quote: clip(quote, 80), quoteFrom, why: clip(oneLine(raw.why), 60), turn: snap.turn },
  }
}

type JudgeOutcome = 'asked' | 'none' | 'failed'

// Calls the model once when this block may still ask. `force` is /criteria-check: it ignores the
// allowance and the spacing.
async function judge($: EngineInterface, snap: TurnSnapshot, settings: Settings, force = false): Promise<JudgeOutcome> {
  const before = await read($, card)
  if (!settings.card || before.question !== null || before.pending !== null || snap.prompt.trim() === '') return 'none'
  const isAllowed = force || (before.asked < allowed(before, settings) && snap.turn - before.lastAskTurn > GAP_TURNS)
  if (!isAllowed) return 'none'

  // A model the session cannot use may reject the call; that is a failure like any other.
  const res = await $.model
    .complete({
      model: MODEL,
      system: JUDGE_SYSTEM,
      prompt: judgePrompt(snap, before.history),
      maxTokens: 700,
      effort: 'low',
    })
    .catch(() => null)
  if (!res?.isAnswered) return 'failed'
  const { ok, question } = parseQuestion(res.text, snap)
  if (!ok) return 'failed'
  if (!question) return 'none'
  const after = await update($, card, c =>
    c.question || c.pending ? c : { ...c, question, asked: c.asked + 1, lastAskTurn: snap.turn },
  )

  return after.question === question ? 'asked' : 'none'
}

// ---------- what came of an answer ----------

const OUTCOME_SYSTEM = `A question card asked a person about something they may have skipped or misunderstood in a conversation with an AI. You get the question, the words it pointed at, the person's answer, and the AI's reply to that answer.
- understood: true when the answer shows the person had it right (the AI confirms and carries on unchanged). false when it shows a real gap: the AI had assumed otherwise, the person's premise was wrong, they did not know, or the AI had to explain, correct or redo.
- result: one line, at most 80 characters, in the person's language, saying what came of it (for example what the AI had assumed and what it changed).
Output one JSON object and nothing else: {"understood":true,"result":""}`

async function outcome($: EngineInterface, p: Pending, reply: string): Promise<{ understood: boolean | null; result: string }> {
  const fallback = { understood: p.answer === DONT_KNOW ? false : null, result: '' }
  try {
    const res = await $.model.complete({
      model: MODEL,
      system: OUTCOME_SYSTEM,
      prompt: [
        `Question: ${p.question.question}`,
        `It pointed at: "${p.question.quote}"`,
        `The person's answer: ${p.answer}`,
        `The AI's reply:\n${clip(reply || '(none)', 3000)}`,
      ].join('\n'),
      maxTokens: 300,
      effort: 'low',
    })
    const match = res.isAnswered ? res.text.match(/\{[\s\S]*\}/) : null
    if (!match) return fallback
    const raw = JSON.parse(match[0]) as Record<string, unknown>

    return {
      understood: typeof raw.understood === 'boolean' ? (p.answer === DONT_KNOW ? false : raw.understood) : fallback.understood,
      result: clip(oneLine(raw.result), 120),
    }
  } catch {
    return fallback
  }
}

// ---------- the log ----------

// One Markdown file per project and day, outside the repository, for the user to look back on.
// The engine has no append, so writes are queued and the file rewritten. A failed write never stops the card.
let logQueue: Promise<void> = Promise.resolve()

const pad = (n: number) => String(n).padStart(2, '0')

function writeLog($: EngineInterface, q: GapQuestion, answer: string, result: string): Promise<void> {
  logQueue = logQueue.then(async () => {
    try {
      const homeDir = await home($)
      if (!homeDir) return
      const t = await translator($)
      const root = await $.session.root()
      const project = root.replace(/[^A-Za-z0-9._-]+/g, '-')
      const now = new Date(await $.clock.now())
      const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const path = `${homeDir}/${DATA_DIR}/${LOG_DIR}/${project}/${day}.md`
      const old = (await $.fs.exists(path)) ? await $.fs.read(path) : `# ${t('log.title')} · ${day}\n\n${root}\n`
      const entry = [
        `## ${pad(now.getHours())}:${pad(now.getMinutes())} · ${t(`kind.${q.kind}`)}`,
        `- ${t(`log.quote.${q.quoteFrom}`)}: "${q.quote}"`,
        `- ${t('log.question')}: ${q.question}`,
        `- ${t('log.answer')}: ${answer}`,
        result ? `- ${t('log.result')}: ${result}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      await $.fs.write(path, `${old.replace(/\n*$/, '')}\n\n${entry}\n`)
    } catch {
      // Not written; the session goes on.
    }
  })

  return logQueue
}

const remember = (c: Card, question: string, answer: string): Card['history'] =>
  [...c.history, { question: clip(question, 120), answer: clip(answer, 80) }].slice(-MAX_HISTORY)

// A question closed without an answer: skipped or left alone. Both count as "not now".
async function close($: EngineInterface, q: GapQuestion, how: 'skipped' | 'expired') {
  const settings = await loadSettings($)
  const t = await translator($)
  await update($, card, c => ({ ...c, question: null, shift: moved(c, settings, -1), history: remember(c, q.question, `(${how})`) }))
  await writeLog($, q, t(`log.${how}`), '')
}

// ---------- the card ----------

const answerPrompt = ($: EngineInterface, q: GapQuestion, answer: string) =>
  [
    ANSWER_TAG,
    `About: ${KIND_NAME[q.kind]}`,
    `Question: ${q.question}`,
    q.options.length ? `Options: ${q.options.join(' / ')}` : '',
    `It points at ${q.quoteFrom === 'ai' ? 'your answer' : 'my words'}: "${q.quote}"`,
    `My answer: ${answer}`,
    `This is my answer to the question card of ${$.plugin.name}. How to handle it: the "Card answers" section of the ${skill($, 'criteria-gap')} skill.`,
  ]
    .filter(Boolean)
    .join('\n')

// Added to every prompt while the card is on, so Claude knows who asks about understanding here.
const SESSION_NOTE = `${TAG} The question card is on in this session: after a turn, this plugin may ask the user one question, in a card above the prompt, about something they may have skipped or misunderstood. Answers come back as messages that start with "${ANSWER_TAG}". Do not also quiz the user about their understanding in the chat.`

async function reply($: EngineInterface, answer: string) {
  const q = (await read($, card)).question
  const text = answer.trim()
  if (!q || !text) return
  await update($, card, c => ({ ...c, question: null, pending: { question: q, answer: text } }))
  await $.prompt.submit({ text: answerPrompt($, q, text) })
}

async function skip($: EngineInterface) {
  const q = (await read($, card)).question
  if (q) await close($, q, 'skipped')
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
      <Text dimColor>{t(`card.quote.${q.quoteFrom}`, { quote: q.quote })}</Text>
      <Text>{q.question}</Text>
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
const checkContext = ($: EngineInterface, broken: string): Record<string, string> => ({
  'check.broken': `${TAG} /${COMMAND} did nothing: ${broken} could not be read as JSON, so the question card is off. Offer to fix the file (keep the user's settings) or delete it.`,
  'check.off': `${TAG} /${COMMAND} did nothing: the question card is off here ("card": false in .hus-criteria-gap/config.json). The ${skill($, 'criteria-gap')} skill turns it back on.`,
  'check.pending': `${TAG} /${COMMAND} did nothing: a question card is already waiting for the user.`,
  'check.no_turn': `${TAG} /${COMMAND} did nothing: no turn of this session has been seen yet.`,
  'check.asked': `${TAG} /${COMMAND} put a question card above the prompt. The answer will come as a "${ANSWER_TAG}" message; do not ask the same thing in the chat.`,
  'check.none': `${TAG} /${COMMAND} checked the last turn and found nothing worth asking.`,
  'check.failed': `${TAG} /${COMMAND} could not get a verdict from the judge model.`,
})

// ---------- module ----------

export const register: Register = on => {
  // A reload starts the session's notices over.
  told.clear()
  // Turn-local scratch; a reload only loses the turn in progress.
  let prompts: string[] = []
  let tools: string[] = []
  // The AI's last answer, which the next turn's judge reads as "previous".
  let lastAnswer = ''
  // The last turn, for /criteria-check.
  let lastSnap: TurnSnapshot | null = null
  // Judge calls that failed in a row.
  let failures = 0

  on('session.start', async ($, e, next) => {
    const t = await translator($)
    await $.command.register({ name: 'criteria-check', description: t('command.description') })

    return next(e)
  })

  on('command.run', { command: 'criteria-check' }, async $ => {
    const settings = await loadSettings($)
    const answer = async (key: string) => ({
      text: (await translator($))(key, { path: settings.broken ?? '' }),
      context: [checkContext($, settings.broken ?? '')[key]!],
    })
    if (settings.broken) return answer('check.broken')
    if (!settings.card) return answer('check.off')
    const c = await read($, card)
    if (c.question || c.pending) return answer('check.pending')
    if (!lastSnap) return answer('check.no_turn')
    const result = await judge($, lastSnap, settings, true)

    return answer(result === 'asked' ? 'check.asked' : result === 'failed' ? 'check.failed' : 'check.none')
  })

  on('tool.call', ($, e, next) => {
    tools.push(String(e.tool))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    // A card answer is this plugin's own message, not the user's words: keep it out of what the judge reads.
    if (!e.text.startsWith(`[${SHORT}`)) prompts.push(e.text)
    if (HANGUL.test(e.text) && !(await read($, card)).isHangul) {
      await update($, card, c => ({ ...c, isHangul: true }))
    }
    const settings = await loadSettings($)
    if (settings.broken) await notify($, 'notice.config_broken', { path: settings.broken })
    if (!settings.card) return next(e)
    // The first prompt after installing: say once that the card is on, which also shows it is running.
    try {
      if (!(await $.store.get('welcomed'))) {
        await $.store.set('welcomed', true)
        await notify($, 'notice.welcome')
      }
    } catch {
      // Not remembered; at worst it is said again.
    }

    return next({ ...e, context: [...(e.context ?? []), SESSION_NOTE] })
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result

    const snap: TurnSnapshot = { turn: 0, before: lastAnswer, prompt: prompts.join('\n---\n'), answer: e.answer, tools }
    prompts = []
    tools = []
    if (e.reason === 'answer') lastAnswer = e.answer
    const settings = await loadSettings($)
    if (!settings.card) {
      // Turned off while a question waited: take it down. Turns are not counted while off.
      await update($, card, c => (c.question || c.pending ? { ...c, question: null, pending: null } : c))
      if (snap.prompt.trim()) lastSnap = { ...snap, turn: (await read($, card)).turn }

      return result
    }

    let expired: GapQuestion | null = null
    const c = await update($, card, cur => {
      const turn = cur.turn + 1
      expired = cur.question !== null && turn - cur.question.turn >= EXPIRE_TURNS ? cur.question : null
      // A long session starts a new block with the base allowance. blockStart is the last turn of the
      // block before, so blocks run 1-30, 31-60, ...
      const isNewBlock = turn - cur.blockStart > BLOCK_TURNS

      return isNewBlock ? { ...cur, turn, blockStart: turn - 1, asked: 0, shift: 0 } : { ...cur, turn }
    })
    const gone = expired as GapQuestion | null
    if (gone) await close($, gone, 'expired')
    snap.turn = c.turn

    // The turn Claude spent on a card answer (the first turn after it was sent): learn what came of
    // it, and do not judge it.
    if (c.pending) {
      const p = c.pending
      await update($, card, cur => ({ ...cur, pending: null }))
      $.clock.after(1, async () => {
        const { understood, result: what } = await outcome($, p, e.answer)
        const t = await translator($)
        const step = understood === true ? -1 : understood === false ? 1 : 0
        await update($, card, cur => ({
          ...cur,
          shift: moved(cur, settings, step),
          history: remember(cur, p.question.question, p.answer === DONT_KNOW ? t('card.unknown') : p.answer),
        }))
        await writeLog($, p.question, p.answer === DONT_KNOW ? t('card.unknown') : p.answer, what)
      })

      return result
    }

    if (snap.prompt.trim()) lastSnap = snap
    // Judge outside this dispatch, so the turn ends without waiting on the model. A turn with little
    // AI text to read is not judged.
    const isWorthReading = snap.before.length + snap.answer.length >= MIN_READ
    if (e.reason === 'answer' && snap.prompt.trim() && isWorthReading) {
      $.clock.after(1, async () => {
        const outcome = await judge($, snap, settings).catch(() => 'failed' as const)
        failures = outcome === 'failed' ? failures + 1 : 0
        // Twice in a row is not a hiccup: tell the user once, and keep trying quietly.
        if (failures >= 2) await notify($, 'notice.judge_failed')
      })
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const q = (await read($, card)).question
    if (!q) return next(e)
    if (!(await loadSettings($)).card) return next(e)

    return questionCard($, $.ui.resolve(e), q, await translator($))
  })
}
