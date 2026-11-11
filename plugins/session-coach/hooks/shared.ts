import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Lang } from '../types'

// What both hooks modules of this plugin share: its names, its home folder, and the language files.

export const PLUGIN = 'hack-user-skills-session-coach'
export const SHORT_NAME = 'hus-session-coach'
// Tools a mod registers are listed to the model as mcp__<plugin>__<name>.
export const TOOL = (name: string) => `mcp__${PLUGIN}__${name}`

// Footprints outside Claude live in one home folder, as the diary script keeps them; HUS_SESSION_COACH_HOME moves it.
const HOME_FOLDER = '.hus-session-coach'

export async function dataHome($: EngineInterface): Promise<string | null> {
  const home = ((await $.env.get('HOME')) ?? '').replace(/\/+$/, '')
  const custom = (await $.env.get('HUS_SESSION_COACH_HOME')) ?? ''
  if (custom) return custom.replace(/^~(?=\/|$)/, home).replace(/\/+$/, '') || null

  return home ? `${home}/${HOME_FOLDER}` : null
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

// ---------- language ----------

// Screen text comes from hooks/locales/<code>.json, merged over en.json. The language is, in order:
// the `lang` the session diary keeps in its state, the script of the user's prompts (Hangul is ko), English.
export type Vars = Record<string, string | number>
export type T = (key: string, vars?: Vars) => string

const LOCALES = 'hooks/locales'
const LANG_CODE = /^[a-z]{2,3}$/
const HANGUL = /[\uAC00-\uD7A3]/
const DIARY_STATE = 'session-diary/.auto/state.json'

export const langState = atom(
  { plugin: 'hack-user-skills-session-coach', key: 'lang' } as const,
  { code: 'en', source: 'default' } as Lang,
  { shape: 'lang-1' },
)

function localePath($: EngineInterface, code: string) {
  return `${$.plugin.root}/${LOCALES}/${code}.json`
}

async function isKnown($: EngineInterface, code: unknown): Promise<boolean> {
  if (typeof code !== 'string' || !LANG_CODE.test(code)) return false
  try {
    return await $.fs.exists(localePath($, code))
  } catch {
    return false
  }
}

async function diaryLang($: EngineInterface): Promise<string | null> {
  try {
    const home = await dataHome($)
    if (!home || !(await $.fs.exists(`${home}/${DIARY_STATE}`))) return null
    const lang = JSON.parse(await $.fs.read(`${home}/${DIARY_STATE}`))?.lang

    return (await isKnown($, lang)) ? lang : null
  } catch {
    return null
  }
}

// At the session's start: the diary's setting, else what the user already wrote in a resumed session.
export async function initLang($: EngineInterface) {
  const fromDiary = await diaryLang($)
  if (fromDiary) {
    await update($, langState, () => ({ code: fromDiary, source: 'diary' }))

    return
  }
  try {
    const messages = await $.session.messages()
    const said = messages.filter(m => m.role === 'user').map(m => m.text)
    for (const text of said) if (HANGUL.test(text)) return await notePrompt($, text)
  } catch {
    // A new session has nothing to read yet.
  }
}

// Each prompt the user sends. Once a prompt is in Hangul the screen is Korean for the rest of the session.
export async function notePrompt($: EngineInterface, text: string) {
  if (!HANGUL.test(text)) return
  const cur = await read($, langState)
  if (cur.source === 'diary' || cur.code === 'ko' || !(await isKnown($, 'ko'))) return
  await update($, langState, c => (c.source === 'diary' ? c : { code: 'ko', source: 'prompt' as const }))
}

const tables = new Map<string, Record<string, string>>()

async function table($: EngineInterface, code: string): Promise<Record<string, string>> {
  const kept = tables.get(code)
  if (kept) return kept
  try {
    const raw = JSON.parse(await $.fs.read(localePath($, code))) as Record<string, unknown>
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') flat[k] = v
    tables.set(code, flat)

    return flat
  } catch {
    // Not kept, so a file that could not be read now is tried again on the next draw.
    return {}
  }
}

const fill = (text: string, vars: Vars) =>
  text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))

// The strings of the session's language. Reading it while drawing redraws when the language changes.
export async function strings($: EngineInterface): Promise<T> {
  const { code } = await read($, langState)
  const merged = { ...(await table($, 'en')), ...(code === 'en' ? {} : await table($, code)) }

  // A key that is in no file shows as itself, so a missing one is easy to see.
  return (key, vars = {}) => fill(merged[key] ?? key, vars)
}

export async function langCode($: EngineInterface): Promise<string> {
  return (await read($, langState)).code
}

// ---------- command replies ----------

// A command's `text` is what the model reads, so it is English. The person sees the same row drawn
// from the language files: reply() remembers which key each text stands for, and drawReply() swaps it in.
const shown = new Map<string, { key: string; vars: Vars }>()

export function reply(text: string, key: string, vars: Vars = {}) {
  shown.set(text, { key, vars })
  if (shown.size > 50) shown.delete(shown.keys().next().value as string)

  return { text }
}

// A CommandOutput hook: rows this plugin did not answer are left as they are.
export async function drawReply($: EngineInterface, e: any, next: (e: any) => any) {
  const r = shown.get(e.props.text)
  if (!r) return next(e)
  const t = await strings($)

  return next({ ...e, props: { ...e.props, text: t(r.key, r.vars) } })
}
