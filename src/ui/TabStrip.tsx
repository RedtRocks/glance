import { activeId, docs, type Doc } from '../state/documents'
import { closeDoc, openWithDialog } from '../state/actions'
import { Icon } from './Icon'
import { keysFor } from '../state/commands'
import { displayCombo } from '../core/shortcuts'
import { dropTabId } from './dragState'
import { t } from '../i18n'

function openTip(): string {
  const k = keysFor('file.open')[0]
  return k ? t('Open ({shortcut})', { shortcut: displayCombo(k) }) : t('Open')
}

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
            {doc.dirty.value && <span class="tab-dirty" aria-label={t('Edited')}>•</span>}
            <button
              class="tab-close"
              aria-label={t('Close {name}', { name: doc.name.value })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void closeDoc(doc)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )
      })}
      <button class="tab-new" aria-label={t('Open file')} title={openTip()} onClick={() => void openWithDialog()}>
        <Icon name="add" size={16} />
      </button>
    </div>
  )
}
