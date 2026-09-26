import { useEffect, useRef, useState } from 'preact/hooks'
import { activeDoc, type Doc } from '../state/documents'
import { settings } from '../state/settings'
import { runCommand, keysFor } from '../state/commands'
import { displayCombo } from '../core/shortcuts'
import { parsePageInput, showPageButtons, showPageNumberField } from '../core/pageControls'
import { findOpen, findQuery, menuOpen, sidebarVisible } from '../state/ui'
import { hits, hitIndex, runSearch, searching, stepHit } from '../pdf/search'
import { MenuItems } from './MenuBar'
import { markupBar, tool } from '../state/markupState'
import { Icon } from './Icon'
import type { IconName } from './icons'

export interface ToolbarContext {
  doc: Doc | null
  pageCount: number
}

export interface ToolbarItem {
  id: string
  label: string
  /** Hidden automatically when it doesn't apply to the current document. */
  applies: (ctx: ToolbarContext) => boolean
  render: (ctx: ToolbarContext) => preact.JSX.Element | null
}

function tip(label: string, command?: string): string {
  const k = command ? keysFor(command)[0] : undefined
  return k ? `${label} (${displayCombo(k)})` : label
}

function Btn({ icon, label, command, onClick, pressed }: { icon: IconName; label: string; command?: string; onClick?: () => void; pressed?: boolean }) {
  return (
    <button
      class={`tb-button ${pressed ? 'pressed' : ''}`}
      title={tip(label, command)}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick ?? (() => command && void runCommand(command))}
    >
      <Icon name={icon} />
    </button>
  )
}

function PageControls({ doc }: { doc: Doc }) {
  const current = doc.kind === 'notice' ? 0 : doc.current.value
  const [text, setText] = useState(String(current + 1))
  useEffect(() => setText(String(current + 1)), [current])
  if (doc.kind === 'notice') return null
  const ctx = { pageCount: doc.pageCount.value, pageNumberThreshold: settings.value.pageNumberThreshold }
  if (!showPageButtons(ctx)) return null
  const commit = (): void => {
    const idx = parsePageInput(text, ctx.pageCount)
    if (idx === null) return setText(String(current + 1))
    if (doc.kind === 'pdf') doc.goTo(idx)
    else doc.current.value = idx
  }
  return (
    <div class="tb-group page-controls">
      <Btn icon="up" label="Previous Page" command="go.previous" />
      <Btn icon="down" label="Next Page" command="go.next" />
      {showPageNumberField(ctx) && (
        <label class="page-field" title={tip('Go to Page', 'go.page')}>
          <input
            value={text}
            aria-label="Page number"
            inputMode="numeric"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setText(String(current + 1))
            }}
            onBlur={commit}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <span class="page-total">of {ctx.pageCount}</span>
        </label>
      )}
    </div>
  )
}

function SearchField({ doc }: { doc: Doc }) {
  const input = useRef<HTMLInputElement>(null)
  const open = findOpen.value
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  if (doc.kind !== 'pdf') return null
  const count = hits.value.length
  return (
    <div class={`search-field ${open || findQuery.value ? 'expanded' : ''}`}>
      <Icon name="search" size={16} />
      <input
        ref={input}
        type="search"
        placeholder="Search"
        aria-label="Search document"
        value={findQuery.value}
        onFocus={() => (findOpen.value = true)}
        onBlur={() => !findQuery.value && (findOpen.value = false)}
        onInput={(e) => {
          findQuery.value = (e.target as HTMLInputElement).value
          void runSearch(doc, findQuery.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') stepHit(doc, e.shiftKey ? -1 : 1)
          if (e.key === 'Escape') {
            findQuery.value = ''
            void runSearch(doc, '')
            findOpen.value = false
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {findQuery.value && (
        <span class="search-count" aria-live="polite">
          {searching.value ? '…' : count ? `${hitIndex.value + 1} of ${count}` : 'No results'}
        </span>
      )}
    </div>
  )
}

function Overflow() {
  const open = menuOpen.value === '__overflow'
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) menuOpen.value = null
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div class="overflow" ref={ref}>
      <Btn icon="more" label="More options" onClick={() => (menuOpen.value = open ? null : '__overflow')} pressed={open} />
      {open && (
        <div class="overflow-menu">
          <MenuItems
            items={['file.share', 'file.print', 'file.export', 'file.openWith', '-', 'image.setWallpaper', 'image.setLockScreen', '-', 'view.slideshow', 'view.darkPdf', '-', 'view.customizeToolbar', 'file.settings']}
            onDone={() => (menuOpen.value = null)}
          />
        </div>
      )}
    </div>
  )
}

const isPdf = (c: ToolbarContext) => c.doc?.kind === 'pdf'
const isViewable = (c: ToolbarContext) => !!c.doc && c.doc.kind !== 'notice'

export const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: 'sidebar',
    label: 'Sidebar',
    applies: (c) => isPdf(c) || (isViewable(c) && c.pageCount > 1),
    render: () => (
      <Btn icon="sidebar" label="Show/Hide Sidebar" pressed={sidebarVisible.value} onClick={() => (sidebarVisible.value = !sidebarVisible.value)} />
    )
  },
  { id: 'pageControls', label: 'Page Controls', applies: (c) => isViewable(c) && c.pageCount > 1, render: (c) => <PageControls doc={c.doc!} /> },
  { id: 'spacer', label: 'Flexible Space', applies: () => true, render: () => <div class="tb-spacer" /> },
  { id: 'zoomOut', label: 'Zoom Out', applies: isViewable, render: () => <Btn icon="zoomOut" label="Zoom Out" command="view.zoomOut" /> },
  { id: 'zoomIn', label: 'Zoom In', applies: isViewable, render: () => <Btn icon="zoomIn" label="Zoom In" command="view.zoomIn" /> },
  { id: 'zoomFit', label: 'Zoom to Fit', applies: isViewable, render: () => <Btn icon="zoomFit" label="Zoom to Fit" command="view.zoomToFit" /> },
  {
    id: 'rotate',
    label: 'Rotate',
    applies: isViewable,
    render: () => (
      <button
        class="tb-button"
        title="Rotate Left (Ctrl+L). Alt+click rotates right."
        aria-label="Rotate"
        onClick={(e) => void runCommand(e.altKey ? 'tools.rotateRight' : 'tools.rotateLeft')}
      >
        <Icon name="rotateLeft" />
      </button>
    )
  },
  {
    id: 'markup',
    label: 'Markup',
    applies: (c) => isPdf(c) || (c.doc?.kind === 'image' && c.doc.editable),
    render: () => <Btn icon="markup" label="Show Markup Toolbar" command="tools.markup" pressed={markupBar.value} />
  },
  {
    id: 'highlight',
    label: 'Highlight',
    applies: isPdf,
    render: () => <Btn icon="highlight" label="Highlight" command="tools.highlight" pressed={tool.value === 'highlight'} />
  },
  {
    id: 'contactSheet',
    label: 'Contact Sheet',
    applies: (c) => isPdf(c) && c.pageCount > 1,
    render: (c) => (
      <Btn icon="grid" label="Contact Sheet" command="view.contactSheet" pressed={c.doc?.kind === 'pdf' && c.doc.contactSheet.value} />
    )
  },
  { id: 'insertPage', label: 'Insert Blank Page', applies: isPdf, render: () => <Btn icon="addPage" label="Insert Blank Page" command="edit.insertBlank" /> },
  { id: 'deletePages', label: 'Delete Pages', applies: (c) => isPdf(c) && c.pageCount > 1, render: () => <Btn icon="trash" label="Delete Selected Pages" command="edit.deletePages" /> },
  {
    id: 'darkPdf',
    label: 'Dark PDF',
    applies: isPdf,
    render: () => <Btn icon="moon" label="Dark Appearance for PDFs" command="view.darkPdf" pressed={settings.value.darkPdf} />
  },
  { id: 'slideshow', label: 'Slideshow', applies: isViewable, render: () => <Btn icon="slideshow" label="Slideshow" command="view.slideshow" /> },
  { id: 'print', label: 'Print', applies: isViewable, render: () => <Btn icon="print" label="Print" command="file.print" /> },
  { id: 'search', label: 'Search', applies: isPdf, render: (c) => <SearchField doc={c.doc!} /> },
  { id: 'overflow', label: 'More', applies: () => true, render: () => <Overflow /> }
]

const byId = new Map(TOOLBAR_ITEMS.map((i) => [i.id, i]))

export function Toolbar() {
  const doc = activeDoc.value
  const ctx: ToolbarContext = { doc, pageCount: doc && doc.kind !== 'notice' ? doc.pageCount.value : 0 }
  return (
    <div class="toolbar" role="toolbar" aria-label="Document tools">
      {settings.value.toolbar.map((id, i) => {
        const item = byId.get(id)
        if (!item || !item.applies(ctx)) return null
        return <div key={`${id}-${i}`} class={`tb-item tb-${id}`}>{item.render(ctx)}</div>
      })}
    </div>
  )
}
