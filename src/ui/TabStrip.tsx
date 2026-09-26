import { activeId, docs, type Doc } from '../state/documents'
import { closeDoc, openWithDialog } from '../state/actions'
import { Icon } from './Icon'
import { dropTabId } from './dragState'

function kindIcon(doc: Doc) {
  if (doc.kind === 'image') return <Icon name="image" size={16} />
  return <Icon name="document" size={16} />
}

export function TabStrip() {
  const list = docs.value
  return (
    <div class="tabstrip" role="tablist">
      {list.map((doc) => {
        const active = doc.id === activeId.value
        return (
          <div
            key={doc.id}
            role="tab"
            aria-selected={active}
            data-tab-id={doc.id}
            class={`tab ${active ? 'active' : ''} ${dropTabId.value === doc.id ? 'drop-target' : ''}`}
            title={doc.path.value ?? doc.name.value}
            onPointerDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void closeDoc(doc)
              } else if (e.button === 0) {
                activeId.value = doc.id
              }
            }}
          >
            {kindIcon(doc)}
            <span class="tab-title">{doc.name.value}</span>
            {doc.dirty.value && <span class="tab-dirty" aria-label="Edited">•</span>}
            <button
              class="tab-close"
              aria-label={`Close ${doc.name.value}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void closeDoc(doc)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )
      })}
      <button class="tab-new" aria-label="Open file" title="Open (Ctrl+O)" onClick={() => void openWithDialog()}>
        <Icon name="add" size={16} />
      </button>
    </div>
  )
}
