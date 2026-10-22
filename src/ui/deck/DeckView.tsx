import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DeckDoc } from '../../state/documents'
import { contextMenu } from '../../state/ui'
import { addSlide, change, setSlideLayout, type SlideShape } from '../../state/deck'
import { layoutIds, type Deck, type LayoutId } from '../../core/deck/model'
import { boardOf, designIds, slotSpecsOf } from '../../core/deck/design'
import { boardInfo, designsVersion, findDesign, loadedBoard } from '../../state/designs'
import { editOps, parseRefKey, slotText } from '../../core/deck/edit'
import type { SlotRef } from '../../core/deck/layout'
import { SLIDE_H, SLIDE_W } from '../../core/deck/layout'
import * as platform from '../../platform'
import { msg, t } from '../../i18n'
import { SlideFrame } from './SlideFrame'
import { layoutLabel, themeLabel } from './labels'
import { THEMES } from '../../core/deck/themes'
import { Icon } from '../Icon'
import { charCount } from '../../core/ai/guide'

const PAD = 32
const PICTURES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']

/** A text box being typed in: where it sits over the slide and how its text looks. */
interface Editing {
  slideId: string
  ref: SlotRef
  multiline: boolean
  key: string
  rect: { left: number; top: number; width: number; height: number }
  style: Record<string, string>
  text: string
  /** The slot's limit, for the counter beside the box; list slots count their longest line. */
  maxChars?: number
  perLine?: boolean
}

/** The layouts, then the designs of the templates the deck already uses. */
function layoutMenu(e: MouseEvent, deck: Deck, run: (shape: SlideShape) => void): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const boards = [...new Set(designIds(deck.slides).map(boardOf))].flatMap((id) => {
    const board = loadedBoard(id)
    return board ? [board] : []
  })
  const designed = boards.flatMap((b) => b.designs.map((d, i) => ({
    label: boards.length > 1 ? t('{template}: {n}. {role}', { template: t(boardInfo(b.id)?.name ?? b.id), n: i + 1, role: t(d.role) }) : t('{n}. {role}', { n: i + 1, role: t(d.role) }),
    run: () => run({ layout: 'design', design: d.id })
  })))
  const layouts = layoutIds.map((id) => ({ label: layoutLabel(id), run: () => run({ layout: id }) }))
  contextMenu.value = { x: r.left, y: r.bottom + 4, items: designed.length ? [...designed, '-' as const, ...layouts] : layouts }
}

/** What the slide button says: the layout, or the design's role. */
function shapeLabel(slide: { layout: LayoutId; design?: string }): string {
  const d = slide.design ? findDesign(slide.design) : undefined
  return d ? t(d.role) : layoutLabel(slide.layout)
}

function themeMenu(e: MouseEvent, doc: DeckDoc): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const now = doc.deck.peek().theme
  contextMenu.value = {
    x: r.left,
    y: r.bottom + 4,
    items: Object.keys(THEMES).map((id) => ({ label: id === now ? `✓ ${themeLabel(id)}` : themeLabel(id), run: () => id !== now && change(doc, msg('Change Theme'), [{ op: 'setTheme', theme: id }]) }))
  }
}

async function pickPicture(doc: DeckDoc, slideId: string, slot: string): Promise<void> {
  const [path] = await platform.openDialog({ multiple: false, filters: [{ name: msg('Pictures'), extensions: PICTURES }] })
  if (!path) return
  const src = doc.addMedia(platform.baseName(path), await platform.readFile(path))
  const slide = doc.deck.peek().slides.find((s) => s.id === slideId)
  const alt = slide?.slots[slot]?.kind === 'image' ? (slide.slots[slot].value as { alt: string }).alt : ''
  change(doc, msg('Add Picture'), [{ op: 'setSlot', id: slideId, slot, value: { src, alt } }])
}

/** The deck editor: the slide on screen, edited in place. Slides are listed in the sidebar. */
export function DeckView({ doc }: { doc: DeckDoc }) {
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [editing, setEditingState] = useState<Editing | null>(null)
  /** The edit still open, so a blur after Escape or a slide change doesn't save it. */
  const open = useRef<Editing | null>(null)
  const setEditing = (e: Editing | null) => {
    open.current = e
    setEditingState(e)
  }
  const box = useRef<HTMLTextAreaElement>(null)
  const [typed, setTyped] = useState('')
  const slides = doc.deck.value.slides
  const slide = slides[doc.current.value]
  // Redraw once a template's designs have loaded.
  void designsVersion.value

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Arrow keys step through the slides when nothing is being typed, as in PowerPoint and Google Slides.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || open.current) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('.make-screen, [role="dialog"], [role="menu"]')) return
      const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
      if (!dir) return
      e.preventDefault()
      const n = doc.deck.peek().slides.length
      doc.current.value = Math.min(Math.max(doc.current.peek() + dir, 0), n - 1)
      doc.selection.value = []
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc])

  // Moving to another slide (or undo) ends typing; what was typed is kept.
  useEffect(() => setEditing(null), [slide?.id, doc.historyVersion.value])
  useEffect(() => {
    // The caret goes to the end of the text, as in PowerPoint; nothing is selected to be typed over.
    const el = box.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
    setTyped(editing?.text ?? '')
  }, [editing?.slideId, editing && editing.ref])
  const count = editing ? charCount(typed, editing.maxChars, editing.perLine) : null

  const fit = Math.max(0, Math.min((size.w - 2 * PAD) / SLIDE_W, (size.h - 2 * PAD) / SLIDE_H))
  const width = Math.round(SLIDE_W * fit * doc.zoom.value)

  const commit = (e: Editing | null, text: string) => {
    if (!e || open.current !== e) return
    setEditing(null)
    const target = doc.deck.peek().slides.find((s) => s.id === e.slideId)
    if (!target) return
    // Enter in a box that takes several lines adds one; a line left empty at the end isn't meant.
    const ops = editOps(target, e.ref, text.replace(/\n+$/, ''), findDesign)
    if (ops.length) change(doc, msg('Typing'), ops)
  }

  const onSlideClick = (ev: MouseEvent) => {
    if (!slide) return
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-ref]')
    if (!el || !stage.current) return
    const ref = parseRefKey(el.dataset.ref!)
    if (el.classList.contains('deck-image')) return void pickPicture(doc, slide.id, ref.slot)
    const spec = slotSpecsOf(slide, findDesign).find((s) => s.name === ref.slot)
    const s = stage.current.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (slide.layout === 'design') return void editDesigned(el, ref, spec?.maxChars ?? 0, s, cs)
    const r = el.getBoundingClientRect()
    const scale = r.width / el.offsetWidth
    // Start the typing where the text sits, so a bottom-aligned title doesn't jump.
    const first = el.firstElementChild as HTMLElement | null
    const offset = first && el.dataset.ref && !el.classList.contains('empty') ? first.offsetTop * scale : 0
    setEditing({
      slideId: slide.id,
      ref,
      key: el.dataset.ref!,
      multiline: spec?.kind === 'list' || (spec?.maxChars ?? 0) > 100,
      // Cards and table cells share their limit with their neighbours, so only text and list slots count.
      maxChars: spec?.kind === 'text' || spec?.kind === 'list' ? spec.maxChars : undefined,
      perLine: spec?.kind === 'list',
      rect: { left: r.left - s.left + stage.current.scrollLeft, top: r.top - s.top + stage.current.scrollTop, width: r.width, height: r.height },
      style: { fontSize: `${parseFloat(cs.fontSize) * scale}px`, fontFamily: cs.fontFamily, color: cs.color, lineHeight: cs.lineHeight, textAlign: cs.textAlign, paddingTop: `${offset}px` },
      text: slotText(slide, ref)
    })
  }

  /** A designed slide's text box may be turned, so the typing box takes its unturned size and turns the same way. */
  const editDesigned = (el: HTMLElement, ref: SlotRef, maxChars: number, s: DOMRect, cs: CSSStyleDeclaration) => {
    if (!slide || !stage.current) return
    const frame = el.closest<HTMLElement>('.deck-slide')!.getBoundingClientRect()
    const k = frame.width / SLIDE_W
    const first = el.firstElementChild as HTMLElement | null
    const offset = first && !el.classList.contains('empty') ? first.offsetTop * k : 0
    const lines = el.offsetHeight / (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2)
    setEditing({
      slideId: slide.id,
      ref,
      key: el.dataset.ref!,
      multiline: lines >= 1.8 || maxChars > 60,
      maxChars: maxChars || undefined,
      rect: { left: frame.left - s.left + stage.current.scrollLeft + el.offsetLeft * k, top: frame.top - s.top + stage.current.scrollTop + el.offsetTop * k, width: el.offsetWidth * k, height: el.offsetHeight * k },
      style: {
        fontSize: `${parseFloat(cs.fontSize) * k}px`, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
        fontVariationSettings: cs.fontVariationSettings, letterSpacing: cs.letterSpacing === 'normal' ? 'normal' : `${parseFloat(cs.letterSpacing) * k}px`,
        textTransform: cs.textTransform, color: cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' ? '' : cs.color,
        lineHeight: `${(parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) * k}px`, textAlign: cs.textAlign, paddingTop: `${offset}px`,
        transform: cs.transform === 'none' ? '' : el.style.transform, transformOrigin: 'center'
      },
      text: slotText(slide, ref)
    })
  }

  return (
    <div class="deck-view">
      <div class="deck-bar" role="toolbar" aria-label={t('Slide')}>
        <button class="deck-bar-button" onClick={() => addSlide(doc)}>
          <Icon name="add" size={16} />
          {t('New slide')}
        </button>
        <button class="deck-bar-button" aria-label={t('New slide with a layout')} onClick={(e) => layoutMenu(e, doc.deck.peek(), (shape) => addSlide(doc, shape))}>
          <Icon name="down" size={12} />
        </button>
        <span class="deck-bar-gap" />
        <button class="deck-bar-button" disabled={!slide} onClick={(e) => layoutMenu(e, doc.deck.peek(), (shape) => setSlideLayout(doc, shape))}>
          <Icon name="grid" size={16} />
          {slide ? shapeLabel(slide) : t('Layout')}
        </button>
{/* A designed slide keeps its template's look, so the theme is offered on layout slides only. */}
        {slide?.layout !== 'design' && (
          <button class="deck-bar-button" aria-label={t('Theme')} title={t('Theme')} onClick={(e) => themeMenu(e, doc)}>
            <Icon name="paintBrush" size={16} />
            {themeLabel(doc.deck.value.theme)}
          </button>
        )}
      </div>
      <div class="deck-stage" ref={stage}>
        {slide ? (
          <div class={`deck-current ${slide.hidden ? 'hidden-slide' : ''}`} onClick={onSlideClick}>
            {width > 0 && <SlideFrame doc={doc} slide={slide} width={width} hints />}
          </div>
        ) : (
          <div class="deck-empty">
            <p>{t('This deck has no slides yet.')}</p>
            <button class="primary" onClick={() => addSlide(doc, { layout: 'title' })}>
              {t('Add a title slide')}
            </button>
          </div>
        )}
        {/* The box being typed in is hidden underneath, so its old text doesn't show through. */}
        {/* i18n-ignore: CSS */}
        {editing && <style>{`.deck-current [data-ref="${editing.key}"] { visibility: hidden }`}</style>}
        {editing && (
          <textarea
            ref={box}
            class="deck-typing"
            aria-label={t('Slide text')}
            style={{ ...editing.style, left: `${editing.rect.left}px`, top: `${editing.rect.top}px`, width: `${editing.rect.width}px`, height: `${editing.rect.height}px` }}
            defaultValue={editing.text}
            onInput={(e) => setTyped(e.currentTarget.value)}
            onBlur={(e) => commit(editing, (e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              // Escape leaves the box and keeps what was typed, as in PowerPoint.
              if (e.key === 'Escape') commit(editing, e.currentTarget.value)
              else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && e.currentTarget.value === editing.text) {
                // Nothing typed in this box yet: Ctrl+Z undoes the deck's last change, as in PowerPoint.
                e.preventDefault()
                setEditing(null)
                void doc.undo()
              }
              else if (e.key === 'Enter' && !e.shiftKey && !editing.multiline) {
                e.preventDefault()
                commit(editing, e.currentTarget.value)
              }
            }}
          />
        )}
        {editing && count && (
          <span
            class={`deck-count${count.over ? ' over' : count.near ? ' near' : ''}`}
            aria-live="polite"
            style={{ left: `${editing.rect.left + editing.rect.width}px`, top: `${editing.rect.top + editing.rect.height + 10}px` }}
          >
            {count.over
              ? t('{used} of {max}: too long', { used: count.used, max: count.max })
              : t('{used} of {max}', { used: count.used, max: count.max })}
          </span>
        )}
      </div>
    </div>
  )
}
