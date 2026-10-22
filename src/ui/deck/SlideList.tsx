import type { DeckDoc } from '../../state/documents'
import { contextMenu } from '../../state/ui'
import { addSlide, deleteSlides, duplicateSlides, moveSlides, toggleHidden } from '../../state/deck'
import { SlideFrame } from './SlideFrame'
import { Icon } from '../Icon'
import { t } from '../../i18n'
import { useState } from 'preact/hooks'

const THRESHOLD = 5

/** Clicking picks a slide; Ctrl adds to the pick and Shift picks a run, as in Explorer. */
function pick(doc: DeckDoc, id: string, e: MouseEvent): void {
  const ids = doc.deck.peek().slides.map((s) => s.id)
  const sel = doc.selection.peek()
  if (e.ctrlKey || e.metaKey) doc.selection.value = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
  else if (e.shiftKey && sel.length) {
    const [a, b] = [ids.indexOf(sel[0]), ids.indexOf(id)].sort((x, y) => x - y)
    doc.selection.value = ids.slice(a, b + 1)
  } else doc.selection.value = [id]
}

function menu(doc: DeckDoc, id: string, e: MouseEvent): void {
  e.preventDefault()
  if (!doc.selection.peek().includes(id)) doc.selection.value = [id]
  const n = doc.selection.peek().length
  const hidden = doc.deck.peek().slides.filter((s) => doc.selection.peek().includes(s.id)).every((s) => s.hidden)
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: t('New Slide'), run: () => addSlide(doc) },
      { label: t('{count, plural, one {Duplicate Slide} other {Duplicate # Slides}}', { count: n }), run: () => duplicateSlides(doc) },
      { label: hidden ? t('{count, plural, one {Show Slide} other {Show # Slides}}', { count: n }) : t('{count, plural, one {Hide Slide} other {Hide # Slides}}', { count: n }), run: () => toggleHidden(doc) },
      '-',
      { label: t('{count, plural, one {Delete Slide} other {Delete # Slides}}', { count: n }), run: () => deleteSlides(doc) }
    ]
  }
}

/** The deck's slides down the sidebar: pick, drag to reorder, right-click for more. */
export function SlideList({ doc, width }: { doc: DeckDoc; width: number }) {
  const slides = doc.deck.value.slides
  const current = doc.current.value
  const selection = doc.selection.value
  /** Where a dragged slide would land: before this index. */
  const [dropAt, setDropAt] = useState<number | null>(null)

  const startDrag = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return
    const list = (e.currentTarget as HTMLElement).closest<HTMLElement>('.slide-list')
    const ids = selection.includes(id) ? slides.filter((s) => selection.includes(s.id)).map((s) => s.id) : [id]
    const x0 = e.clientX
    const y0 = e.clientY
    let dragging = false
    let at: number | null = null
    const over = (y: number): number => {
      const items = [...(list?.querySelectorAll<HTMLElement>('[data-slide-index]') ?? [])]
      for (const item of items) {
        const r = item.getBoundingClientRect()
        if (y < r.top + r.height / 2) return Number(item.dataset.slideIndex)
      }
      return items.length
    }
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return
      dragging = true
      at = over(ev.clientY)
      setDropAt(at)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDropAt(null)
      if (!dragging || at === null) return
      // Drop before slide `at`: after the nearest slide above it that isn't moving.
      const above = slides.slice(0, at).filter((s) => !ids.includes(s.id)).at(-1)
      moveSlides(doc, ids, above?.id ?? null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div class="thumb-list slide-list" role="listbox" aria-label={t('Slides')} aria-multiselectable="true">
      {slides.map((slide, i) => {
        const selected = selection.includes(slide.id)
        return (
          <div key={slide.id}>
            {dropAt === i && <div class="drop-indicator" />}
            <div
              class={`thumb slide-thumb ${selected ? 'selected' : ''} ${i === current ? 'current' : ''} ${slide.hidden ? 'hidden-slide' : ''}`}
              data-slide-index={i}
              role="option"
              aria-selected={selected}
              aria-label={t('Slide {number}', { number: i + 1 })}
              onPointerDown={(e) => startDrag(e, slide.id)}
              onClick={(e) => {
                pick(doc, slide.id, e)
                doc.current.value = i
              }}
              onContextMenu={(e) => menu(doc, slide.id, e)}
            >
              <SlideFrame doc={doc} slide={slide} width={width} />
              <span class="thumb-label">
                {i + 1}
                {slide.hidden && <Icon name="eye" size={12} />}
              </span>
            </div>
          </div>
        )
      })}
      {dropAt === slides.length && <div class="drop-indicator" />}
      <button class="slide-add" onClick={() => addSlide(doc)} title={t('New Slide')} aria-label={t('New Slide')}>
        <Icon name="add" size={20} />
      </button>
    </div>
  )
}
