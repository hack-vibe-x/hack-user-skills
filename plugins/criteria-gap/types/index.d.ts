// What the card found worth asking.
// skipped: a point in the AI's previous answer the user moved on without settling.
// premise: something the request or the answer rests on that the user never stated.
// misread: the user's message rests on a different premise from the one the answer used.
// distinction: one word for two different things.
// understanding: a question that shows whether the user understood what they just accepted.
export type GapKind = 'skipped' | 'premise' | 'misread' | 'distinction' | 'understanding'

export type GapQuestion = {
  kind: GapKind
  // Written by the judge in the user's language.
  question: string
  // Empty means a free-text question; the free field is offered either way.
  options: string[]
  // The words the question rests on, and whose they are.
  quote: string
  quoteFrom: 'user' | 'ai'
  why: string
  // The turn the question was asked after.
  turn: number
}

// A question the user answered, waiting for Claude's reply to learn what came of it.
export type Pending = { question: GapQuestion; answer: string }

// The question card of this session.
export type Card = {
  // Main-loop turns counted while the card was on.
  turn: number
  // The question waiting above the prompt, if any.
  question: GapQuestion | null
  pending: Pending | null
  // The current block of turns: where it started, how many questions it asked, and how far the
  // allowance moved from the base with the user's answers (up for gaps, down for understood or skipped).
  blockStart: number
  asked: number
  shift: number
  lastAskTurn: number
  // Questions of this session and their answers, so the same thing is not asked twice.
  history: { question: string; answer: string }[]
  // Whether a prompt of this session was written in Hangul (picks the Korean strings).
  isHangul: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'hack-user-skills-criteria-gap': { card: Shaped<Card> }
  }
}
