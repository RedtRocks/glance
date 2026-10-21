import { useEffect, useRef, useState } from 'preact/hooks'
import * as platform from '../../platform'
import * as ai from '../../state/ai'
import * as voice from '../../state/voice'
import { aiOpen, makeOpen } from '../../state/ui'
import { newDeck, change } from '../../state/deck'
import { deckPrompt, nameFromRequest, templatePrompt } from '../../core/ai/make'
import { TEMPLATES, templateDeck, type Template } from '../../state/templates'
import { designsVersion, loadBoard, loadedBoard, sampleText } from '../../state/designs'
import { PURPOSES, type Purpose } from '../../core/deck/design'
import type { Slide } from '../../core/deck/model'
import { boardDeck } from '../../core/deck/template'
import { SlidePreview } from './SlideFrame'
import { purposeLabel } from './labels'
import { msg, t } from '../../i18n'
import { Icon } from '../Icon'
import { DocTemplatePreview, DocTemplateTile, docTemplatesFor, gdocPromptFor, makeGdocByHand, makeGdocWithAi, startGdoc } from '../doc/DocTemplates'
import type { DocBoardInfo } from '../../core/doc/look'

type Kind = 'slides' | 'document'

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
async function startDeck(request: string, tpl: Template | null) {
  const name = nameFromRequest(request, tpl ? t(tpl.name) : t('Untitled deck'))
  return newDeck(name, tpl ? ((await templateDeck(tpl.id)) ?? undefined) : undefined)
}

const promptFor = (request: string, tpl: Template | null, tab: string) => (tpl ? templatePrompt(request, tpl.name, tab) : deckPrompt(request, tab))

async function makeByHand(request: string, tpl: Template | null): Promise<void> {
  const doc = await startDeck(request, tpl)
  if (!tpl) change(doc, msg('New Deck'), [{ op: 'add', layout: 'title', slots: request.trim() ? { title: nameFromRequest(request, '') } : {} }])
  makeOpen.value = false
}

async function makeWithAi(request: string, tpl: Template | null): Promise<void> {
  const doc = await startDeck(request, tpl)
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
  const [tab, setTab] = useState<Purpose | 'All'>('All')
  const [preview, setPreview] = useState<Template | null>(null)
  const [kind, setKind] = useState<Kind>('slides')
  const [docPreview, setDocPreview] = useState<DocBoardInfo | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef('')
  latest.current = text
  const previewRef = useRef<Template | null>(null)
  previewRef.current = preview
  const state = aiState()
  const listening = voice.voiceState.value !== 'off'

  useEffect(() => {
    input.current?.focus()
    // Find out early whether an AI is signed in, so the screen offers the right thing.
    if (platform.isTauri && ai.welcomed.peek() && ai.status.peek() === 'idle') {
      void ai.refreshAgents().then(() => ai.ensureSession())
    }
    // The thumbnails are the templates' own first slides, so their designs load now.
    for (const tpl of TEMPLATES) void loadBoard(tpl.id)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (previewRef.current) setPreview(null)
      else makeOpen.value = false
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      void voice.stopVoice()
    }
  }, [])

  const make = (want: Kind, tpl: Template | null = null, request = latest.current) => {
    if (want === 'document') {
      setKind('document')
      if (state === 'ready' && request.trim()) return void makeGdocWithAi(request, null)
      if (state === 'none' || !request.trim()) return void makeGdocByHand(request, null)
      setAsked(true)
      return
    }
    // A template with nothing typed opens as it is, ready to fill in by hand.
    if (state === 'ready' && (request.trim() || !tpl)) return void makeWithAi(request, tpl)
    if (state === 'none' || !request.trim()) return void makeByHand(request, tpl)
    setPicked(tpl)
    setAsked(true)
  }

  const signIn = async () => {
    // The Ask AI sidebar signs in; the request waits there and goes once it's done.
    if (kind === 'document') {
      const g = await startGdoc(latest.current, null)
      ai.pendingPrompt.value = gdocPromptFor(latest.current, null, g.id)
    } else {
      const doc = await startDeck(latest.current, picked)
      ai.pendingPrompt.value = promptFor(latest.current, picked, doc.id)
    }
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
            <button class="btn" onClick={() => void (kind === 'document' ? makeGdocByHand(latest.current, null) : makeByHand(latest.current, picked))}>
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
        <button class="make-kind document" onClick={() => make('document')}>
          <Icon name="document" size={32} />
          <span>
            <span class="make-kind-name">{t('Document')}</span>
            <span class="make-kind-sub">{t('Letters, reports, posters and forms')}</span>
          </span>
        </button>
      </div>
      <h2 class="make-templates-title">{t('Or start from a template')}</h2>
      <div class="make-tabs make-kind-tabs" role="tablist" aria-label={t('Kind of template')}>
        <button role="tab" aria-selected={kind === 'slides'} class={`make-tab${kind === 'slides' ? ' on' : ''}`} onClick={() => setKind('slides')}>{t('Slides')}</button>
        <button role="tab" aria-selected={kind === 'document'} class={`make-tab${kind === 'document' ? ' on' : ''}`} onClick={() => setKind('document')}>{t('Documents')}</button>
      </div>
      <div class="make-tabs" role="tablist" aria-label={t('Templates for')}>
        {(['All', ...PURPOSES] as const).map((p) => (
          <button key={p} role="tab" aria-selected={tab === p} class={`make-tab${tab === p ? ' on' : ''}`} onClick={() => setTab(p)}>
            {purposeLabel(p)}
          </button>
        ))}
      </div>
      <div class="make-templates" role="tabpanel">
        {kind === 'slides' && TEMPLATES.filter((tpl) => tab === 'All' || tpl.purpose === tab).map((tpl) => (
          <TemplateTile key={tpl.id} tpl={tpl} onPick={() => setPreview(tpl)} />
        ))}
        {kind === 'document' && docTemplatesFor(tab).map((info) => <DocTemplateTile key={info.id} info={info} onPick={() => setDocPreview(info)} />)}
      </div>
      {docPreview && <DocTemplatePreview info={docPreview} aiReady={state === 'ready'} onClose={() => setDocPreview(null)} />}
      {preview && (
        <TemplatePreview
          tpl={preview}
          ai={state}
          onClose={() => setPreview(null)}
          onUse={() => void makeByHand('', preview)}
          onAbout={(about) => {
            // The request stands in the main field too, so signing in first still sends it.
            setText((latest.current = about))
            setPreview(null)
            make('slides', preview, about)
          }}
        />
      )}
    </div>
  )
}

/** A template's slides with their sample text, once its designs have loaded. */
function useTemplateSlides(tpl: Template): Slide[] {
  void designsVersion.value
  const board = loadedBoard(tpl.id)
  const [slides, setSlides] = useState<Slide[]>([])
  useEffect(() => {
    if (board) setSlides(boardDeck(board, sampleText).slides)
    else void loadBoard(tpl.id)
  }, [board])
  return slides
}

function TemplateTile({ tpl, onPick }: { tpl: Template; onPick: () => void }) {
  const first = useTemplateSlides(tpl)[0]
  return (
    <button class="make-template" onClick={onPick}>
      {first ? <SlidePreview slide={first} theme="wollo" width={284} /> : <span class="make-template-empty" />}
      <span class="make-kind-name">{t(tpl.name)}</span>
      <span class="make-kind-sub">{t(tpl.blurb)}</span>
    </button>
  )
}

/** A template up close: every slide, then use it as it is or have the AI make it about something. */
function TemplatePreview({ tpl, ai: state, onClose, onUse, onAbout }: { tpl: Template; ai: ReturnType<typeof aiState>; onClose: () => void; onUse: () => void; onAbout: (about: string) => void }) {
  const slides = useTemplateSlides(tpl)
  const [about, setAbout] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])
  return (
    <div class="make-preview" role="dialog" aria-modal="true" aria-label={t(tpl.name)}>
      <div class="make-preview-head">
        <button class="icon-button" aria-label={t('Back to templates')} title={t('Back to templates')} onClick={onClose}>
          <Icon name="left" size={16} />
        </button>
        <div>
          <h2>{t(tpl.name)}</h2>
          <p>{t('{look} · {count, plural, one {# slide} other {# slides}} · {blurb}', { look: t(tpl.look), count: tpl.slides, blurb: t(tpl.blurb) })}</p>
        </div>
      </div>
      <div class="make-preview-slides">
        {slides.map((s) => (
          <SlidePreview key={s.id} slide={s} theme="wollo" width={300} />
        ))}
      </div>
      <div class="make-preview-actions">
        <button class="btn" onClick={onUse}>
          {t('Use as it is')}
        </button>
        {state !== 'none' && (
          <form
            class="make-ask make-about"
            onSubmit={(e) => {
              e.preventDefault()
              if (about.trim()) onAbout(about)
            }}
          >
            <input ref={field} value={about} onInput={(e) => setAbout(e.currentTarget.value)} aria-label={t('Make it about…')} placeholder={t('Make it about…, like “our summer fair”')} />
            <button type="submit" class="make-go" disabled={!about.trim()}>
              <Icon name="sparkle" size={16} /> {t('Make it')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
