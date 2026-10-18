import { useEffect, useRef, useState } from 'preact/hooks'
import * as platform from '../../platform'
import * as ai from '../../state/ai'
import * as voice from '../../state/voice'
import { aiOpen, makeOpen } from '../../state/ui'
import { newDeck, change } from '../../state/deck'
import { deckPrompt, nameFromRequest } from '../../core/ai/make'
import { msg, t } from '../../i18n'
import { Icon } from '../Icon'

type Kind = 'slides'

/**
 * Whether the AI can make things right now. AI first (redt's rule): when an AI is signed
 * in, the request goes to it; otherwise Glance asks the person to sign in, and offers to
 * start by hand if they'd rather not.
 */
function aiState(): 'ready' | 'signIn' | 'none' {
  if (!platform.isTauri) return 'none'
  if (!ai.welcomed.value) return 'signIn'
  const s = ai.status.value
  return s === 'signIn' || s === 'missing' || s === 'failed' ? 'signIn' : 'ready'
}

function makeByHand(request: string): void {
  const doc = newDeck(nameFromRequest(request, t('Untitled deck')))
  change(doc, msg('New Deck'), [{ op: 'add', layout: 'title', slots: request.trim() ? { title: nameFromRequest(request, '') } : {} }])
  makeOpen.value = false
}

async function makeWithAi(request: string): Promise<void> {
  const doc = newDeck(nameFromRequest(request, t('Untitled deck')))
  makeOpen.value = false
  aiOpen.value = true
  ai.startNewChat()
  await ai.sendWhenReady(deckPrompt(request, doc.id))
}

/** File → New: "What do you want to make?", AI first. */
export function MakeScreen() {
  const [text, setText] = useState('')
  const [asked, setAsked] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef('')
  latest.current = text
  const state = aiState()
  const listening = voice.voiceState.value !== 'off'

  useEffect(() => {
    input.current?.focus()
    // Find out early whether an AI is signed in, so the screen offers the right thing.
    if (platform.isTauri && ai.welcomed.peek() && ai.status.peek() === 'idle') {
      void ai.refreshAgents().then(() => ai.ensureSession())
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (makeOpen.value = false)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      void voice.stopVoice()
    }
  }, [])

  const make = (_kind: Kind, request = latest.current) => {
    if (state === 'ready') return void makeWithAi(request)
    if (state === 'none' || !request.trim()) return makeByHand(request)
    setAsked(true)
  }

  const signIn = () => {
    // The Ask AI sidebar signs in; the request waits there and goes once it's done.
    const doc = newDeck(nameFromRequest(latest.current, t('Untitled deck')))
    ai.pendingPrompt.value = deckPrompt(latest.current, doc.id)
    makeOpen.value = false
    aiOpen.value = true
  }

  const mic = () => {
    if (listening) return void voice.stopVoice()
    void voice.startVoice(
      (phrase) => setText((latest.current = latest.current.trim() ? `${latest.current.trimEnd()} ${phrase}` : phrase)),
      () => undefined
    )
  }

  return (
    <div class="make-screen" role="dialog" aria-modal="true" aria-label={t('What do you want to make?')}>
      <button class="icon-button make-close" aria-label={t('Close')} title={t('Close')} onClick={() => (makeOpen.value = false)}>
        <Icon name="close" size={16} />
      </button>
      <h1>{t('What do you want to make?')}</h1>
      <form
        class="make-ask"
        onSubmit={(e) => {
          e.preventDefault()
          make('slides')
        }}
      >
        <input
          ref={input}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          aria-label={t('Tell Glance what to make')}
          placeholder={state === 'none' ? t('Give it a name, like “Spring bake sale”') : t('Tell me, like “slides about our spring bake sale”')}
        />
        {state === 'ready' && platform.speechAvailable && (
          <button type="button" class={`make-mic${listening ? ' on' : ''}`} aria-label={listening ? t('Stop listening') : t('Talk instead of typing')} aria-pressed={listening} onClick={mic}>
            <Icon name={listening ? 'micFilled' : 'mic'} size={20} />
          </button>
        )}
        <button type="submit" class="make-go">
          {state === 'ready' ? t('Make it') : t('Start')}
        </button>
      </form>
      {asked && (
        <div class="make-signin" role="status">
          <p>{t('Sign in to an AI and it will make this for you. You can change every slide afterwards.')}</p>
          <div class="make-signin-actions">
            <button class="btn primary" onClick={signIn}>
              <Icon name="sparkle" size={16} /> {t('Sign in to an AI')}
            </button>
            <button class="btn" onClick={() => makeByHand(latest.current)}>
              {t('Make it myself')}
            </button>
          </div>
        </div>
      )}
      <div class="make-kinds">
        <button class="make-kind slides" onClick={() => make('slides')}>
          <Icon name="slideshow" size={32} />
          <span>
            <span class="make-kind-name">{t('Slides')}</span>
            <span class="make-kind-sub">{t('For class, work or a party')}</span>
          </span>
        </button>
      </div>
    </div>
  )
}
