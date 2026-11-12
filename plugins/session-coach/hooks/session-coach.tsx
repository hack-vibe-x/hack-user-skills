import type { Register } from 'claude-code'

import { compassBand, compassPrompt, compassTurnEnd, registerCompass, startCompass } from './session-compass'
import { diaryBand, diaryPrompt, diaryTurnEnd, planBandFor, registerDiary, startDiary } from './session-diary'
import { drawReply, initLang, notePrompt } from './shared'

// The hooks module of hack-user-skills-session-coach (the engine takes one per plugin). It holds two mods:
//   session-compass.tsx: /session-compass, its pane and the per-turn progress judge. Off until used.
//   session-diary.tsx:   /session-diary-now and its card above the prompt; the plan from the latest diary at the
//                        start of a session; keeping the automatic diary's copy of the scripts current.
// The events both need are hooked once, here.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await initLang($)
    await startCompass($)
    await startDiary($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    const isPlugin = e.origin?.kind === 'plugin'
    compassPrompt(e.text, isPlugin)
    if (!isPlugin) {
      await notePrompt($, e.text)
      await diaryPrompt($)
    }

    return next(e)
  })

  // The end of a turn of the main conversation: the compass counts and judges it, the diary's plan steps aside.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    await compassTurnEnd($, e)
    await diaryTurnEnd($)

    return result
  })

  // One seat above the prompt: the diary card first, then what the compass has to show, then yesterday's plan.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    return (await diaryBand($, e)) ?? (await compassBand($, e)) ?? (await planBandFor($, e)) ?? next(e)
  })

  // Command replies of both, drawn in the session's language.
  on('ui.render', { component: 'CommandOutput' }, drawReply)

  registerCompass(on, options)
  registerDiary(on, options)
}
