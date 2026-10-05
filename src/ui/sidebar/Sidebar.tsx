import type { JSX } from 'preact'
import { settings, updateSettings } from '../../state/settings'
import { ImageDoc, PdfDoc, type Doc } from '../../state/documents'
import type { OutlineNode } from '../../pdf/engine'
import { imageUrl } from '../../platform'
import { pageDrag } from '../dragState'
import { beginPageDrag, pageContextMenu, selectPage } from './pageDrag'
import { PageThumb } from './PageThumb'
import { NotesList } from './NotesList'
import { BookmarksList } from './BookmarksList'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { t } from '../../i18n'

const THUMB_WIDTH = 120

function ThumbList({ doc, width = THUMB_WIDTH }: { doc: PdfDoc; width?: number }) {
  const count = doc.pageCount.value
  const current = doc.current.value
  const selection = doc.selection.value
  const drag = pageDrag.value
  const indicator = drag && drag.targetDocId === doc.id ? drag.insertAt : null
  return (
    <div class="thumb-list" data-page-list={doc.id} role="listbox" aria-label={t('Pages')} aria-multiselectable="true">
      {Array.from({ length: count }, (_, i) => {
        const selected = selection.includes(i)
        return (
          <div key={i}>
            {indicator === i && <div class="drop-indicator" />}
            <div
              class={`thumb ${selected ? 'selected' : ''} ${i === current ? 'current' : ''}`}
              data-page-index={i}
              role="option"
              aria-selected={selected}
              aria-label={t('Page {page}', { page: i + 1 })}
              onPointerDown={(e) => {
                const pages = selected ? [...selection].sort((a, b) => a - b) : [i]
                const icon = () => (e.currentTarget as HTMLElement | null)?.querySelector('canvas') ?? null
                beginPageDrag(e, doc, pages, icon)
              }}
              onClick={(e) => {
                selectPage(doc, i, e)
                doc.goTo(i)
              }}
              onContextMenu={(e) => pageContextMenu(e, doc, i)}
            >
              <PageThumb doc={doc} index={i} width={width} />
              <span class="thumb-label">{i + 1}</span>
            </div>
          </div>
        )
      })}
      {indicator === count && <div class="drop-indicator" />}
    </div>
  )
}

function ImageThumbList({ doc, width = THUMB_WIDTH }: { doc: ImageDoc; width?: number }) {
  const current = doc.current.value
  return (
    <div class="thumb-list" role="listbox" aria-label={t('Pages')}>
      {Array.from({ length: doc.pageCount.value }, (_, i) => (
        <div
          key={i}
          class={`thumb ${i === current ? 'current selected' : ''}`}
          role="option"
          aria-selected={i === current}
          onClick={() => (doc.current.value = i)}
        >
          <img class="thumb-img" loading="lazy" src={imageUrl(doc.probe, i, 256)} width={width} alt={t('Page {page}', { page: i + 1 })} />
          <span class="thumb-label">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

function OutlineTree({ nodes, doc }: { nodes: OutlineNode[]; doc: PdfDoc }): JSX.Element {
  return (
    <ul class="toc">
      {nodes.map((n, i) => (
        <li key={i}>
          <button class="toc-item" disabled={n.pageIndex === null} onClick={() => n.pageIndex !== null && doc.goTo(n.pageIndex)}>
            <span>{n.title}</span>
            {n.pageIndex !== null && <span class="toc-page">{n.pageIndex + 1}</span>}
          </button>
          {n.children.length > 0 && <OutlineTree nodes={n.children} doc={doc} />}
        </li>
      ))}
    </ul>
  )
}

function Toc({ doc }: { doc: PdfDoc }) {
  const outline = doc.outline.value
  if (!outline.length) return <p class="sidebar-empty">{t('This document has no table of contents.')}</p>
  return <OutlineTree nodes={outline} doc={doc} />
}

function Resizer() {
  return (
    <div
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        const start = e.clientX
        const width = settings.value.sidebarWidth
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent): void => updateSettings({ sidebarWidth: Math.min(420, Math.max(140, width + ev.clientX - start)) })
        const up = (): void => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      }}
    />
  )
}

/** What the sidebar shows for its current mode; null when the file has nothing to list. */
export function sidebarBody(doc: Doc, thumbWidth = THUMB_WIDTH): JSX.Element | null {
  if (doc.kind === 'pdf') {
    const mode = doc.sidebar.value
    return mode === 'toc' ? <Toc doc={doc} /> : mode === 'notes' ? <NotesList doc={doc} /> : mode === 'bookmarks' ? <BookmarksList doc={doc} /> : <ThumbList doc={doc} width={thumbWidth} />
  }
  if (doc.kind === 'image' && doc.pageCount.value > 1) return <ImageThumbList doc={doc} width={thumbWidth} />
  return null
}

export function Sidebar({ doc }: { doc: Doc }) {
  const body = sidebarBody(doc)
  if (!body) return null
  return (
    <aside class="sidebar" style={{ width: settings.value.sidebarWidth }} data-drop-doc={doc.id}>
      {doc.kind === 'pdf' && (
        <div class="sidebar-tabs" role="tablist">
          {(
            [
              ['thumbnails', 'grid', t('Thumbnails')],
              ['toc', 'toc', t('Table of contents')],
              ['notes', 'notes', t('Highlights and notes')],
              ['bookmarks', 'bookmarks', t('Bookmarks')]
            ] as [typeof doc.sidebar.value, IconName, string][]
          ).map(([mode, icon, label]) => {
            const selected = doc.sidebar.value === mode || (mode === 'thumbnails' && doc.sidebar.value === 'none')
            return (
              <button key={mode} role="tab" title={label} aria-label={label} aria-selected={selected} onClick={() => (doc.sidebar.value = mode)}>
                <Icon name={icon} size={16} />
              </button>
            )
          })}
        </div>
      )}
      <div class="sidebar-body">{body}</div>
      <Resizer />
    </aside>
  )
}
