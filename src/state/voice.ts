/**
 * The Ask AI sidebar's mic: speech to text with Windows speech recognition. Finished
 * phrases go into the message box; a pause after speaking sends it.
 */
import { signal } from '@preact/signals'
import * as platform from '../platform'
import { t } from '../i18n'

export type VoiceState = 'off' | 'starting' | 'listening'

export const voiceState = signal<VoiceState>('off')
/** The words being spoken right now, before the phrase is finished. */
export const partial = signal('')
/** Why listening stopped or couldn't start, and what the user can do. */
export const voiceProblem = signal<VoiceProblem | null>(null)

/** `voiceTyping`: Windows voice typing (Win+H) may work where Glance's listening didn't. */
export interface VoiceProblem {
  text: string
  settings?: string
  voiceTyping?: boolean
}

/** How long a pause after speaking sends the message. */
export const SEND_AFTER_MS = 1800

let stopper: (() => Promise<void>) | null = null
let quiet: ReturnType<typeof setTimeout> | null = null
let heardAny = false
let held = false

function problemFor(code: string, message: string): VoiceProblem {
  switch (code) {
    case 'privacy':
      return { text: t('Turn on Online speech recognition in Windows Settings to talk to the AI.'), settings: 'ms-settings:privacy-speech', voiceTyping: true }
    case 'no-mic':
      return { text: t('Glance can’t use the microphone. Check that one is connected and that apps may use it.'), settings: 'ms-settings:privacy-microphone', voiceTyping: true }
    case 'no-audio':
      return {
        text: t('Windows couldn’t hear your microphone. Check that “Let desktop apps access your microphone” is on and the mic isn’t muted, or use Windows voice typing.'),
        settings: 'ms-settings:privacy-microphone',
        voiceTyping: true
      }
    case 'language':
      return { text: t('Speech recognition isn’t installed for your language. Add it under Language & region in Windows Settings.'), settings: 'ms-settings:regionlanguage' }
    default:
      return { text: t('Listening stopped: {error}', { error: message }), voiceTyping: true }
  }
}

/**
 * Starts listening. `onPhrase` gets each finished phrase; `onPause` runs when the user
 * stops talking after saying something (the sidebar sends the message then).
 */
export async function startVoice(onPhrase: (text: string) => void, onPause: () => void): Promise<void> {
  if (voiceState.peek() !== 'off') return
  voiceState.value = 'starting'
  voiceProblem.value = null
  partial.value = ''
  heardAny = false
  held = false
  const arm = (): void => {
    if (quiet) clearTimeout(quiet)
    quiet = heardAny && !held
      ? setTimeout(() => {
          void stopVoice().then(onPause)
        }, SEND_AFTER_MS)
      : null
  }
  try {
    stopper = await platform.speechStart('', (e) => {
      switch (e.kind) {
        case 'partial':
          voiceState.value = 'listening'
          partial.value = e.text
          if (quiet) clearTimeout(quiet)
          break
        case 'final':
          voiceState.value = 'listening'
          partial.value = ''
          if (e.text.trim()) {
            heardAny = true
            onPhrase(e.text.trim())
          }
          arm()
          break
        case 'error':
          voiceProblem.value = problemFor(e.code, e.message)
          break
        case 'end':
          finish()
          break
      }
    })
    if (voiceState.peek() === 'starting') voiceState.value = 'listening'
  } catch (e) {
    const text = String(e)
    const code = /privacy|0x80045509/i.test(text) ? 'privacy' : /microphone|0x80070005|no-mic/i.test(text) ? 'no-mic' : /language/i.test(text) ? 'language' : 'other'
    voiceProblem.value = problemFor(code, text)
    finish()
  }
}

function finish(): void {
  if (quiet) clearTimeout(quiet)
  quiet = null
  stopper = null
  partial.value = ''
  voiceState.value = 'off'
}

/** Stops listening; what was heard stays in the message box. */
export async function stopVoice(): Promise<void> {
  if (quiet) clearTimeout(quiet)
  quiet = null
  const stop = stopper
  finish()
  await stop?.().catch(() => undefined)
}

/** The user typed while listening: keep listening, but don't send on a pause. */
export function holdSend(): void {
  held = true
  if (quiet) clearTimeout(quiet)
  quiet = null
}
