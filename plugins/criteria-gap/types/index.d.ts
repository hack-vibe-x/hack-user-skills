// What the gap check found worth asking, and how it reads it.
export type GapKind = 'premise' | 'distinction' | 'principle' | 'criterion'

export type GapQuestion = {
  kind: GapKind
  // Written by the judge in the user's language.
  question: string
  // Empty means a free-text question; the free field is offered either way.
  options: string[]
  // The user's own words the question rests on.
  quote: string
  why: string
  // The turn the question was asked after.
  turn: number
}

// The question card of this session.
export type Card = {
  // Main-loop turns counted while the card was on.
  turn: number
  // The question waiting above the prompt, if any.
  question: GapQuestion | null
  // How many questions this session asked, and after which turn the last one.
  asked: number
  lastAskTurn: number
  // Whether a prompt of this session was written in Hangul (picks the Korean strings).
  isHangul: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'hack-user-skills-criteria-gap': { card: Shaped<Card> }
  }
}
