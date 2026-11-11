import type { Register } from 'claude-code'

import { compassBand, compassPrompt, registerCompass, startCompass } from './session-compass'
import { diaryBand, registerDiary, startDiary } from './session-diary'
import { drawReply, initLang, notePrompt } from './shared'

// The hooks module of hack-user-skills-session-coach (the engine takes one per plugin). It holds two mods:
//   session-compass.tsx: /session-compass, its pane and the per-turn progress judge. Off until used.
//   session-diary.tsx:   /session-diary-now and its card above the prompt. Nothing runs until used.
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
    compassPrompt(e.text)
    if (e.origin?.kind !== 'plugin') await notePrompt($, e.text)

    return next(e)
  })

  // One seat above the prompt: the diary card first, then what the compass has to show.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    return (await diaryBand($, e)) ?? (await compassBand($, e)) ?? next(e)
  })

  // Command replies of both, drawn in the session's language.
  on('ui.render', { component: 'CommandOutput' }, drawReply)

  registerCompass(on, options)
  registerDiary(on, options)
}
