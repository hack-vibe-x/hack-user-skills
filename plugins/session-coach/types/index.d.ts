// The state contract of this plugin's two hooks modules (hooks/session-compass.tsx, hooks/session-diary.tsx).

export type Goal = {
  destination: string
  done: string
  avoid: string
  // How many steps (LED rows) the goal is from the start.
  rows: number
}

export type StepKind = 'start' | 'up' | 'flat' | 'down' | 'pivot' | 'arrive'

// Steps the mod writes itself rather than the judge; drawn from the language files.
export type StepMark = 'start' | 'pivot' | 'not-yet'

export type Step = {
  kind: StepKind
  height: number
  segment: number
  turn: number
  // The judge's reason in the user's language; for a pivot, the new destination.
  reason: string
  mark?: StepMark
}

export type Segment = { destination: string; rows: number }

export type Proposal = {
  destination: string
  done: string
  avoid: string
  rows: number
  // Steps of the new goal already covered by the work so far.
  carry: number
  reason: string
  from: 'judge' | 'model'
}

// A short status line under the goal: a language-file key and its values.
export type Note = { key: string; vars: Record<string, string | number> }

export type Compass = {
  // Off until the user runs /session-compass (or presses the pane's start button) in this session.
  isActive: boolean
  goal: Goal | null
  steps: Step[]
  segments: Segment[]
  proposal: Proposal | null
  isJudging: boolean
  turn: number
  note: Note | null
  // Destinations of the goals finished this session, oldest first.
  finished: string[]
}

// The "write today's diary now" card and what the diary script last said about today.
export type Diary = {
  isAsking: boolean
  isOn: boolean
  isTodayWritten: boolean
  isWriting: boolean
}

// The language of the text drawn on screen, and where it came from.
export type Lang = {
  code: string
  source: 'diary' | 'prompt' | 'default'
}

declare module 'claude-code' {
  interface PluginState {
    'hack-user-skills-session-coach': {
      compass: Shaped<Compass>
      diary: Shaped<Diary>
      lang: Shaped<Lang>
    }
  }
}
