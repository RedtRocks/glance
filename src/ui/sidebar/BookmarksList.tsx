import type { PdfDoc } from '../../state/documents'
import { bookmarksFor, setBookmarks } from '../../state/bookmarks'
import { Icon } from '../Icon'
import { t } from '../../i18n'

export function BookmarksList({ doc }: { doc: PdfDoc }) {
  const path = doc.path.value
  const list = bookmarksFor(path)
  if (!path) return <p class="sidebar-empty">{t('Save this document to keep bookmarks.')}</p>
  if (!list.length) return <p class="sidebar-empty">{t('No bookmarks yet. Press Ctrl+D to bookmark the current page.')}</p>
  return (
    <div class="notes-list">
      {list.map((b, i) => (
        <div class="bookmark-row" key={`${b.page}-${b.created}`}>
          <button class={`note-item ${doc.current.value === b.page ? 'selected' : ''}`} onClick={() => doc.goTo(b.page)}>
            <span class="note-icon" aria-hidden="true">
              <Icon name="bookmark" size={16} />
            </span>
            <span class="note-body">
              <span class="note-text">{b.label}</span>
            </span>
            <span class="toc-page">{b.page + 1}</span>
          </button>
          <button class="icon-button" aria-label={t('Remove bookmark {name}', { name: b.label })} onClick={() => setBookmarks(path, list.filter((_, k) => k !== i))}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
