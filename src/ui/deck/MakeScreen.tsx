import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import * as platform from '../../platform'
import * as ai from '../../state/ai'
import * as voice from '../../state/voice'
import { aiOpen, makeOpen } from '../../state/ui'
import { newDeck, change } from '../../state/deck'
import { deckPrompt, nameFromRequest, templatePrompt } from '../../core/ai/make'
import { TEMPLATES, templateDeck, type Template } from '../../state/templates'
import { SlidePreview } from './SlideFrame'
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

/** The new deck's tab, empty or from a template. */
function startDeck(request: string, tpl: Template | null) {
  const name = nameFromRequest(request, tpl ? t(tpl.name) : t('Untitled deck'))
  return newDeck(name, tpl ? (templateDeck(tpl.id) ?? undefined) : undefined)
}

const promptFor = (request: string, tpl: Template | null, tab: string) => (tpl ? templatePrompt(request, tpl.name, tab) : deckPrompt(request, tab))

function makeByHand(request: string, tpl: Template | null): void {
  const doc = startDeck(request, tpl)
  if (!tpl) change(doc, msg('New Deck'), [{ op: 'add', layout: 'title', slots: request.trim() ? { title: nameFromRequest(request, '') } : {} }])
  makeOpen.value = false
}

async function makeWithAi(request: string, tpl: Template | null): Promise<void> {
  const doc = startDeck(request, tpl)
  makeOpen.value = false
  aiOpen.value = true
  ai.startNewChat()
  await ai.sendWhenReady(promptFor(request, tpl, doc.id))
}

/** File → New: "What do you want to make?", AI first. */
export function MakeScreen() {
  const [text, setText] = useState('')
  const [asked, setAsked] = useState(false)
  const [picked, setPicked] = useState<Template | null>(null)
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

  const make = (_kind: Kind, tpl: Template | null = null, request = latest.current) => {
    // A template with nothing typed opens as it is, ready to fill in by hand.
    if (state === 'ready' && (request.trim() || !tpl)) return void makeWithAi(request, tpl)
    if (state === 'none' || !request.trim()) return makeByHand(request, tpl)
    setPicked(tpl)
    setAsked(true)
  }

  const signIn = () => {
    // The Ask AI sidebar signs in; the request waits there and goes once it's done.
    const doc = startDeck(latest.current, picked)
    ai.pendingPrompt.value = promptFor(latest.current, picked, doc.id)
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
            <button class="btn" onClick={() => makeByHand(latest.current, picked)}>
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
      <h2 class="make-templates-title">{t('Or start from a template')}</h2>
      <div class="make-templates">
        {TEMPLATES.map((tpl) => (
          <TemplateTile key={tpl.id} tpl={tpl} onPick={() => make('slides', tpl)} />
        ))}
      </div>
    </div>
  )
}

function TemplateTile({ tpl, onPick }: { tpl: Template; onPick: () => void }) {
  const first = useMemo(() => templateDeck(tpl.id)?.slides[0], [tpl.id])
  return (
    <button class="make-template" onClick={onPick}>
      {first && <SlidePreview slide={first} theme={tpl.theme} width={284} />}
      <span class="make-kind-name">{t(tpl.name)}</span>
      <span class="make-kind-sub">{t(tpl.blurb)}</span>
    </button>
  )
}
