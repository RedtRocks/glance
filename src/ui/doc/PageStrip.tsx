import { useMemo } from 'preact/hooks'
import type { GDoc } from '../../state/documents'
import { contextMenu } from '../../state/ui'
import { findLook, looksVersion } from '../../state/docLooks'
import { changeGdoc, pagesOf } from '../../state/gdoc'
import { pagePicker } from '../../state/gdocCommands'
import { pageHtml } from '../../core/doc/html'
import { PAGE_H, PAGE_W } from '../../core/doc/look'
import { mediaUrl } from '../../state/deckMedia'
import { msg, t } from '../../i18n'
import { Icon } from '../Icon'

function menu(g: GDoc, section: string, e: MouseEvent): void {
  e.preventDefault()
  const list = g.doc.peek().sections
  const i = list.findIndex((s) => s.id === section)
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: t('New Page…'), run: () => { g.selection.value = { section }; void pagePicker(g) } },
      { label: t('Move Page Up'), run: () => i > 0 && changeGdoc(g, msg('Move Page'), [{ op: 'moveSection', ids: [section], after: i > 1 ? list[i - 2].id : null }]) },
      { label: t('Move Page Down'), run: () => i < list.length - 1 && changeGdoc(g, msg('Move Page'), [{ op: 'moveSection', ids: [section], after: list[i + 1].id }]) },
      '-',
      { label: t('Delete Page'), run: () => list.length > 1 && changeGdoc(g, msg('Delete Page'), [{ op: 'deleteSection', ids: [section] }]) }
    ]
  }
}

/** The document's pages down the sidebar, as they are drawn; a flowing section shows each page it fills. */
export function PageStrip({ doc: g, width }: { doc: GDoc; width: number }) {
  const data = g.doc.value
  const lv = looksVersion.value
  const mv = g.mediaVersion.value
  const board = findLook(data.look)
  const pages = useMemo(() => (board ? pagesOf(g) : []), [data, board, lv, mv])
  const html = useMemo(() => pages.map((p) => pageHtml(p, board, { resolveSrc: (src) => mediaUrl(g, src) })), [pages])
  const scale = width / PAGE_W
  const current = g.current.value
  return (
    <div class="thumb-list slide-list" role="listbox" aria-label={t('Pages')}>
      {pages.map((p, i) => (
        <div
          key={`${p.section}-${p.number}`}
          class={`thumb slide-thumb ${i === current ? 'current selected' : ''}`}
          role="option"
          aria-selected={i === current}
          aria-label={t('Page {number}', { number: i + 1 })}
          onClick={() => {
            g.current.value = i
            g.selection.value = { section: p.section }
          }}
          onContextMenu={(e) => menu(g, p.section, e)}
        >
          <div class="slide-frame" style={{ width: `${width}px`, height: `${PAGE_H * scale}px` }}>
            <div class="slide-frame-inner" style={{ transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html[i] }} />
          </div>
          <span class="thumb-label">{i + 1}</span>
        </div>
      ))}
      <button class="slide-add" onClick={() => void pagePicker(g)} title={t('New Page…')} aria-label={t('New Page…')}>
        <Icon name="add" size={20} />
      </button>
    </div>
  )
}
