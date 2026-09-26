import type { Markup } from '../../core/markup'
import type { PdfDoc } from '../../state/documents'
import { selectedId, setTool, editingId } from '../../state/markupState'
import { Icon } from '../Icon'
import type { IconName } from '../icons'

const ICON: Record<Markup['type'], IconName> = {
  highlight: 'highlight',
  underline: 'underline',
  strike: 'strike',
  note: 'note',
  text: 'textBox',
  signature: 'signature',
  rect: 'square',
  roundRect: 'roundRect',
  oval: 'oval',
  star: 'star',
  bubble: 'bubble',
  line: 'line',
  arrow: 'arrow',
  polygon: 'polygon',
  ink: 'draw'
}

const LABEL: Record<Markup['type'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strikethrough',
  note: 'Note',
  text: 'Text box',
  signature: 'Signature',
  rect: 'Rectangle',
  roundRect: 'Rounded rectangle',
  oval: 'Oval',
  star: 'Star',
  bubble: 'Speech bubble',
  line: 'Line',
  arrow: 'Arrow',
  polygon: 'Polygon',
  ink: 'Drawing'
}

function excerpt(m: Markup): string {
  if (m.type === 'note' || m.type === 'text') return m.text
  if ((m.type === 'highlight' || m.type === 'underline' || m.type === 'strike') && m.text) return m.text
  return m.contents ?? ''
}

/** Preview's "Highlights and Notes" sidebar. */
export function NotesList({ doc }: { doc: PdfDoc }) {
  const items = [...doc.markup.value].sort((a, b) => a.page - b.page || a.created - b.created)
  if (!items.length) return <p class="sidebar-empty">Highlights, notes and other markup you add appear here.</p>
  let lastPage = -1
  return (
    <div class="notes-list">
      {items.map((m) => {
        const header = m.page !== lastPage
        lastPage = m.page
        return (
          <div key={m.id}>
            {header && <div class="notes-page">Page {m.page + 1}</div>}
            <button
              class={`note-item ${selectedId.value === m.id ? 'selected' : ''}`}
              onClick={() => {
                setTool('select')
                doc.goTo(m.page)
                selectedId.value = m.id
              }}
              onDblClick={() => {
                if (m.type === 'note' || m.type === 'text') editingId.value = m.id
              }}
            >
              <span class="note-icon" aria-hidden="true">
                <Icon name={ICON[m.type]} size={16} />
              </span>
              <span class="note-body">
                <span class="note-kind">{LABEL[m.type]}</span>
                {excerpt(m) && <span class="note-text">{excerpt(m)}</span>}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
