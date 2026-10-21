import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { makeOpen } from '../../state/ui'
import { DOC_BOARDS } from '../../doc/designs'
import { findLook, loadLook, looksVersion } from '../../state/docLooks'
import { changeGdoc, newGdoc, templateGdoc } from '../../state/gdoc'
import { docPrompt, docTemplatePrompt, nameFromRequest } from '../../core/ai/make'
import type { DocBoardInfo } from '../../core/doc/look'
import { PAGE_H, PAGE_W } from '../../core/doc/look'
import { layoutDoc } from '../../core/doc/layout'
import { pageHtml } from '../../core/doc/html'
import { boardDoc } from '../../core/doc/template'
import { measureDocText } from '../../doc/measure'
import type { Purpose } from '../../core/deck/design'
import { msg, t } from '../../i18n'
import { startPlan } from '../../state/plan'
import { Icon } from '../Icon'

const tr = (s: string) => (/[{}]/.test(s) ? s : t(s))

/** A new document's tab: a template (one page of a pack, or all of it), or plain pages of a look. */
export async function startGdoc(request: string, info: DocBoardInfo | null, design?: string) {
  const name = nameFromRequest(request, info ? t(info.name) : t('Untitled document'))
  if (info) {
    const doc = await templateGdoc(info.id, info.pack ? design ?? `${info.id}.1` : undefined)
    if (doc) return newGdoc(name, doc)
  }
  const look = 'essay'
  await loadLook(look)
  return newGdoc(name, { version: 1, look, sections: [{ id: 'p1', design: `${look}.plain`, texts: {}, tables: {}, blocks: [] }] })
}

export const gdocPromptFor = (request: string, info: DocBoardInfo | null, tab: string) => (info ? docTemplatePrompt(request, info.name, tab) : docPrompt(request, tab))

export async function makeGdocByHand(request: string, info: DocBoardInfo | null, design?: string): Promise<void> {
  const g = await startGdoc(request, info, design)
  if (!info) changeGdoc(g, msg('New Document'), [{ op: 'addBlocks', section: 'p1', blocks: [{ type: 'heading', level: 1, text: nameFromRequest(request, '') }, { type: 'paragraph', text: '' }] }])
  makeOpen.value = false
}

export async function makeGdocWithAi(request: string, info: DocBoardInfo | null, design?: string): Promise<void> {
  const g = await startGdoc(request, info, design)
  makeOpen.value = false
  // The AI plans first, as for decks; the person checks the plan on the Outline screen.
  await startPlan(request, 'document', g)
}

export const docTemplatesFor = (tab: Purpose | 'All') => DOC_BOARDS.filter((b) => tab === 'All' || b.purpose === tab)

/** A template's pages with their sample text, drawn once its look has loaded. */
function useTemplatePages(info: DocBoardInfo): string[] {
  const lv = looksVersion.value
  const board = findLook(info.id)
  useEffect(() => {
    if (!board) void loadLook(info.id)
  }, [board])
  return useMemo(() => {
    if (!board) return []
    const pages = layoutDoc(boardDoc(board, tr), board, { measure: measureDocText })
    return pages.map((p) => pageHtml(p, board, { resolveSrc: () => null }))
  }, [board, lv])
}

function Page({ html, width }: { html: string; width: number }) {
  const scale = width / PAGE_W
  return (
    <div class="slide-frame doc-thumb" style={{ width: `${width}px`, height: `${PAGE_H * scale}px` }}>
      <div class="slide-frame-inner" style={{ transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

/** A document template's first page, for the Outline screen's looks. */
export function DocLookThumb({ id, width }: { id: string; width: number }) {
  const info = DOC_BOARDS.find((b) => b.id === id)
  const first = useTemplatePages(info ?? DOC_BOARDS[0])[0]
  return info && first ? <Page html={first} width={width} /> : <span class="outline-look-empty" style={{ width: `${width}px` }} />
}

export function DocTemplateTile({ info, onPick }: { info: DocBoardInfo; onPick: () => void }) {
  const first = useTemplatePages(info)[0]
  return (
    <button class="make-template" onClick={onPick}>
      {first ? <Page html={first} width={150} /> : <span class="make-template-empty" />}
      <span class="make-kind-name">{t(info.name)}</span>
      <span class="make-kind-sub">{t(info.blurb)}</span>
    </button>
  )
}

/** A template up close: every page; for a pack, pick the page to start from. */
export function DocTemplatePreview({ info, aiReady, onClose }: { info: DocBoardInfo; aiReady: boolean; onClose: () => void }) {
  const pages = useTemplatePages(info)
  const [about, setAbout] = useState('')
  const [picked, setPicked] = useState(1)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])
  const design = info.pack ? `${info.id}.${picked}` : undefined
  return (
    <div class="make-preview" role="dialog" aria-modal="true" aria-label={t(info.name)}>
      <div class="make-preview-head">
        <button class="icon-button" aria-label={t('Back to templates')} title={t('Back to templates')} onClick={onClose}>
          <Icon name="left" size={16} />
        </button>
        <div>
          <h2>{t(info.name)}</h2>
          <p>{t('{look} · {count, plural, one {# page} other {# pages}} · {blurb}', { look: t(info.look), count: info.pages, blurb: t(info.blurb) })}</p>
          {info.pack && <p>{t('Each page is its own document. Pick the one to start with.')}</p>}
        </div>
      </div>
      <div class="make-preview-slides">
        {pages.map((html, i) => (
          <button key={i} class={`doc-pick${info.pack && picked === i + 1 ? ' on' : ''}`} disabled={!info.pack} aria-pressed={info.pack ? picked === i + 1 : undefined} onClick={() => setPicked(i + 1)}>
            <Page html={html} width={220} />
          </button>
        ))}
      </div>
      <div class="make-preview-actions">
        <button class="btn" onClick={() => void makeGdocByHand('', info, design)}>
          {t('Use as it is')}
        </button>
        {aiReady && (
          <form
            class="make-ask make-about"
            onSubmit={(e) => {
              e.preventDefault()
              if (about.trim()) void makeGdocWithAi(about, info, design)
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
