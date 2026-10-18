import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DeckDoc } from '../../state/documents'
import { contextMenu } from '../../state/ui'
import { addSlide, change, setSlideLayout } from '../../state/deck'
import { layoutIds, LAYOUTS, type LayoutId, type SlotSpec } from '../../core/deck/model'
import { editOps, parseRefKey, slotText } from '../../core/deck/edit'
import type { SlotRef } from '../../core/deck/layout'
import { SLIDE_H, SLIDE_W } from '../../core/deck/layout'
import * as platform from '../../platform'
import { msg, t } from '../../i18n'
import { SlideFrame } from './SlideFrame'
import { layoutLabel } from './labels'
import { Icon } from '../Icon'

const PAD = 32
const PICTURES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']

/** A text box being typed in: where it sits over the slide and how its text looks. */
interface Editing {
  slideId: string
  ref: SlotRef
  multiline: boolean
  key: string
  rect: { left: number; top: number; width: number; height: number }
  style: { fontSize: string; fontFamily: string; color: string; lineHeight: string; textAlign: string; paddingTop: string }
  text: string
}

function layoutMenu(e: MouseEvent, run: (id: LayoutId) => void): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: r.left, y: r.bottom + 4, items: layoutIds.map((id) => ({ label: layoutLabel(id), run: () => run(id) })) }
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
  const slides = doc.deck.value.slides
  const slide = slides[doc.current.value]
  const dark = doc.deck.value.theme === 'wolloDark'

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Moving to another slide (or undo) ends typing; what was typed is kept.
  useEffect(() => setEditing(null), [slide?.id, doc.historyVersion.value])
  useEffect(() => {
    box.current?.focus()
    box.current?.select()
  }, [editing?.slideId, editing && editing.ref])

  const fit = Math.max(0, Math.min((size.w - 2 * PAD) / SLIDE_W, (size.h - 2 * PAD) / SLIDE_H))
  const width = Math.round(SLIDE_W * fit * doc.zoom.value)

  const commit = (e: Editing | null, text: string) => {
    if (!e || open.current !== e) return
    setEditing(null)
    const target = doc.deck.peek().slides.find((s) => s.id === e.slideId)
    if (!target) return
    const ops = editOps(target, e.ref, text)
    if (ops.length) change(doc, msg('Typing'), ops)
  }

  const onSlideClick = (ev: MouseEvent) => {
    if (!slide) return
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-ref]')
    if (!el || !stage.current) return
    const ref = parseRefKey(el.dataset.ref!)
    if (el.classList.contains('deck-image')) return void pickPicture(doc, slide.id, ref.slot)
    const spec = (LAYOUTS[slide.layout] as SlotSpec[]).find((s) => s.name === ref.slot)
    const r = el.getBoundingClientRect()
    const s = stage.current.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const scale = r.width / el.offsetWidth
    // Start the typing where the text sits, so a bottom-aligned title doesn't jump.
    const first = el.firstElementChild as HTMLElement | null
    const offset = first && el.dataset.ref && !el.classList.contains('empty') ? first.offsetTop * scale : 0
    setEditing({
      slideId: slide.id,
      ref,
      key: el.dataset.ref!,
      multiline: spec?.kind === 'list' || (spec?.maxChars ?? 0) > 100,
      rect: { left: r.left - s.left + stage.current.scrollLeft, top: r.top - s.top + stage.current.scrollTop, width: r.width, height: r.height },
      style: { fontSize: `${parseFloat(cs.fontSize) * scale}px`, fontFamily: cs.fontFamily, color: cs.color, lineHeight: cs.lineHeight, textAlign: cs.textAlign, paddingTop: `${offset}px` },
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
        <button class="deck-bar-button" aria-label={t('New slide with a layout')} onClick={(e) => layoutMenu(e, (id) => addSlide(doc, id))}>
          <Icon name="down" size={12} />
        </button>
        <span class="deck-bar-gap" />
        <button class="deck-bar-button" disabled={!slide} onClick={(e) => layoutMenu(e, (id) => setSlideLayout(doc, id))}>
          <Icon name="grid" size={16} />
          {slide ? layoutLabel(slide.layout) : t('Layout')}
        </button>
        <button
          class="deck-bar-button"
          aria-pressed={dark}
          onClick={() => change(doc, msg('Change Theme'), [{ op: 'setTheme', theme: dark ? 'wollo' : 'wolloDark' }])}
        >
          <Icon name={dark ? 'moon' : 'sun'} size={16} />
          {dark ? t('Dark slides') : t('Light slides')}
        </button>
      </div>
      <div class="deck-stage" ref={stage}>
        {slide ? (
          <div class={`deck-current ${slide.hidden ? 'hidden-slide' : ''}`} onClick={onSlideClick}>
            {width > 0 && <SlideFrame doc={doc} slide={slide} width={width} hints />}
          </div>
        ) : (
          <div class="deck-empty">
            <p>{t('This deck has no slides yet.')}</p>
            <button class="primary" onClick={() => addSlide(doc, 'title')}>
              {t('Add a title slide')}
            </button>
          </div>
        )}
        {/* The box being typed in is hidden underneath, so its old text doesn't show through. */}
        {editing && <style>{`.deck-current [data-ref="${editing.key}"] { visibility: hidden }`}</style>}
        {editing && (
          <textarea
            ref={box}
            class="deck-typing"
            aria-label={t('Slide text')}
            style={{ ...editing.style, left: `${editing.rect.left}px`, top: `${editing.rect.top}px`, width: `${editing.rect.width}px`, height: `${editing.rect.height}px` }}
            defaultValue={editing.text}
            onBlur={(e) => commit(editing, (e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setEditing(null)
              else if (e.key === 'Enter' && !e.shiftKey && !editing.multiline) {
                e.preventDefault()
                commit(editing, e.currentTarget.value)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
