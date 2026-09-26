import { useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { pageDrag } from '../dragState'
import { beginPageDrag, selectPage } from '../sidebar/pageDrag'
import { PageThumb } from '../sidebar/PageThumb'

/** Full-window grid of large thumbnails for overview and reordering (Preview's contact sheet). */
export function ContactSheet({ doc }: { doc: PdfDoc }) {
  const [size, setSize] = useState(180)
  const selection = doc.selection.value
  const drag = pageDrag.value
  const indicator = drag && drag.targetDocId === doc.id ? drag.insertAt : null
  return (
    <div class="contact-sheet">
      <div class="contact-header">
        <span>{doc.pageCount.value} pages · drag to reorder, drag out to extract</span>
        <label class="contact-size">
          Size
          <input type="range" min={100} max={360} value={size} onInput={(e) => setSize(Number((e.target as HTMLInputElement).value))} />
        </label>
      </div>
      <div class="contact-grid" data-page-list={doc.id} data-layout="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 24}px, 1fr))` }}>
        {Array.from({ length: doc.pageCount.value }, (_, i) => {
          const selected = selection.includes(i)
          return (
            <div
              key={i}
              class={`contact-cell ${selected ? 'selected' : ''} ${indicator === i ? 'insert-before' : ''} ${indicator === doc.pageCount.value && i === doc.pageCount.value - 1 ? 'insert-after' : ''}`}
              data-page-index={i}
              onPointerDown={(e) => {
                const pages = selected ? [...selection].sort((a, b) => a - b) : [i]
                const icon = () => (e.currentTarget as HTMLElement | null)?.querySelector('canvas') ?? null
                beginPageDrag(e, doc, pages, icon)
              }}
              onClick={(e) => selectPage(doc, i, e)}
              onDblClick={() => {
                doc.contactSheet.value = false
                doc.goTo(i)
              }}
            >
              <PageThumb doc={doc} index={i} width={size} />
              <span class="thumb-label">{i + 1}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
