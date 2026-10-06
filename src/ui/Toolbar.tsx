import { useEffect, useRef, useState } from 'preact/hooks'
import { activeDoc, type Doc } from '../state/documents'
import { settings } from '../state/settings'
import { runCommand, keysFor } from '../state/commands'
import { displayCombo } from '../core/shortcuts'
import { parsePageInput, showPageButtons, showPageNumberField } from '../core/pageControls'
import { aiOpen, findOpen, findQuery, menuOpen, sidebarVisible } from '../state/ui'
import * as platform from '../platform'
import { hits, hitIndex, runSearch, searching, stepHit } from '../pdf/search'
import { MenuItems } from './MenuBar'
import { OVERFLOW_ITEMS, OVERFLOW_MENU } from '../core/menus'
import { markupBar } from '../state/markupState'
import { HighlightButton } from './markup/MarkupToolbar'
import { Icon } from './Icon'
import type { IconName } from './icons'
import { msg, t } from '../i18n'

export interface ToolbarContext {
  doc: Doc | null
  pageCount: number
}

export interface ToolbarItem {
  id: string
  /** Marked with msg(); shown with t(). */
  label: string
  /** Hidden automatically when it doesn't apply to the current document. */
  applies: (ctx: ToolbarContext) => boolean
  render: (ctx: ToolbarContext) => preact.JSX.Element | null
}

function tip(label: string, command?: string): string {
  const k = command ? keysFor(command)[0] : undefined
  return k ? t('{label} ({shortcut})', { label, shortcut: displayCombo(k) }) : label
}

function Btn({ icon, label, command, onClick, pressed, extra = '' }: { icon: IconName; label: string; command?: string; onClick?: () => void; pressed?: boolean; extra?: string }) {
  return (
    <button
      class={`tb-button ${extra} ${pressed ? 'pressed' : ''}`}
      title={tip(label, command)}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick ?? (() => command && void runCommand(command))}
    >
      <Icon name={icon} />
      {extra === 'ai-button' && (
        <svg class="ai-gradient-defs" width="0" height="0" aria-hidden="true">
          <linearGradient id="ai-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#a78bfa" />
            <stop offset="0.5" stop-color="#8b5cf6" />
            <stop offset="1" stop-color="#d946ef" />
          </linearGradient>
        </svg>
      )}
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
      <Btn icon="up" label={t('Previous Page')} command="go.previous" />
      <Btn icon="down" label={t('Next Page')} command="go.next" />
      {showPageNumberField(ctx) && (
        <label class="page-field" title={tip(t('Go to Page'), 'go.page')}>
          <input
            value={text}
            aria-label={t('Page number')}
            inputMode="numeric"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setText(String(current + 1))
            }}
            onBlur={commit}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <span class="page-total">{t('of {count}', { count: ctx.pageCount })}</span>
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
        placeholder={t('Search')}
        aria-label={t('Search document')}
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
          {searching.value ? '…' : count ? t('{current} of {total}', { current: hitIndex.value + 1, total: count }) : t('No results')}
        </span>
      )}
    </div>
  )
}

function Overflow() {
  const open = menuOpen.value === OVERFLOW_MENU
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) menuOpen.value = null
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') menuOpen.value = null
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div class="overflow" ref={ref}>
      <Btn icon="more" label={t('More options')} onClick={() => (menuOpen.value = open ? null : OVERFLOW_MENU)} pressed={open} />
      {open && (
        <div class="overflow-menu">
          <MenuItems
            items={OVERFLOW_ITEMS}
            onDone={() => (menuOpen.value = null)}
          />
        </div>
      )}
    </div>
  )
}

function rotateTip(): string {
  const k = keysFor('tools.rotateLeft')[0]
  return k ? t('Rotate Left ({shortcut}). Alt+click rotates right.', { shortcut: displayCombo(k) }) : t('Rotate Left. Alt+click rotates right.')
}

const isPdf = (c: ToolbarContext) => c.doc?.kind === 'pdf'
const isViewable = (c: ToolbarContext) => c.doc?.kind === 'pdf' || c.doc?.kind === 'image'
const isShown = (c: ToolbarContext) => !!c.doc && c.doc.kind !== 'notice'

export const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: 'sidebar',
    label: msg('Sidebar'),
    applies: (c) => isPdf(c) || (isViewable(c) && c.pageCount > 1),
    render: () => (
      <Btn icon="sidebar" label={t('Show/Hide Sidebar')} pressed={sidebarVisible.value} onClick={() => (sidebarVisible.value = !sidebarVisible.value)} />
    )
  },
  { id: 'pageControls', label: msg('Page Controls'), applies: (c) => isViewable(c) && c.pageCount > 1, render: (c) => <PageControls doc={c.doc!} /> },
  { id: 'spacer', label: msg('Flexible Space'), applies: () => true, render: () => <div class="tb-spacer" /> },
  { id: 'zoomOut', label: msg('Zoom Out'), applies: isShown, render: () => <Btn icon="zoomOut" label={t('Zoom Out')} command="view.zoomOut" /> },
  { id: 'zoomIn', label: msg('Zoom In'), applies: isShown, render: () => <Btn icon="zoomIn" label={t('Zoom In')} command="view.zoomIn" /> },
  { id: 'zoomFit', label: msg('Zoom to Fit'), applies: isShown, render: () => <Btn icon="zoomFit" label={t('Zoom to Fit')} command="view.zoomToFit" /> },
  {
    id: 'rotate',
    label: msg('Rotate'),
    applies: isViewable,
    render: () => (
      <button
        class="tb-button"
        title={rotateTip()}
        aria-label={t('Rotate')}
        onClick={(e) => void runCommand(e.altKey ? 'tools.rotateRight' : 'tools.rotateLeft')}
      >
        <Icon name="rotateLeft" />
      </button>
    )
  },
  {
    id: 'markup',
    label: msg('Markup'),
    applies: (c) => isPdf(c) || (c.doc?.kind === 'image' && c.doc.editable),
    render: () => <Btn icon="markup" label={t('Show Markup Toolbar')} command="tools.markup" pressed={markupBar.value} />
  },
  {
    id: 'highlight',
    label: msg('Highlight'),
    applies: isPdf,
    render: (c) => (c.doc?.kind === 'pdf' ? <HighlightButton doc={c.doc} /> : null)
  },
  {
    id: 'contactSheet',
    label: msg('Contact Sheet'),
    applies: (c) => isPdf(c) && c.pageCount > 1,
    render: (c) => (
      <Btn icon="grid" label={t('Contact Sheet')} command="view.contactSheet" pressed={c.doc?.kind === 'pdf' && c.doc.contactSheet.value} />
    )
  },
  { id: 'insertPage', label: msg('Insert Blank Page'), applies: isPdf, render: () => <Btn icon="addPage" label={t('Insert Blank Page')} command="edit.insertBlank" /> },
  { id: 'deletePages', label: msg('Delete Pages'), applies: (c) => isPdf(c) && c.pageCount > 1, render: () => <Btn icon="trash" label={t('Delete Selected Pages')} command="edit.deletePages" /> },
  {
    id: 'darkPdf',
    label: msg('Dark PDF'),
    applies: isPdf,
    render: () => <Btn icon="moon" label={t('Dark Appearance for PDFs')} command="view.darkPdf" pressed={settings.value.darkPdf} />
  },
  { id: 'slideshow', label: msg('Slideshow'), applies: isViewable, render: () => <Btn icon="slideshow" label={t('Slideshow')} command="view.slideshow" /> },
  { id: 'print', label: msg('Print'), applies: isViewable, render: () => <Btn icon="print" label={t('Print')} command="file.print" /> },
  {
    id: 'askAi',
    label: msg('Ask AI'),
    applies: (c) => isShown(c) && platform.isTauri,
    render: () => <Btn icon="sparkleFilled" label={t('Ask AI')} command="view.askAi" pressed={aiOpen.value} extra="ai-button" />
  },
  { id: 'search', label: msg('Search'), applies: isPdf, render: (c) => <SearchField doc={c.doc!} /> },
  { id: 'overflow', label: msg('More'), applies: () => true, render: () => <Overflow /> }
]

const byId = new Map(TOOLBAR_ITEMS.map((i) => [i.id, i]))

export function Toolbar() {
  const doc = activeDoc.value
  const ctx: ToolbarContext = { doc, pageCount: doc && doc.kind !== 'notice' ? doc.pageCount.value : 0 }
  return (
    <div class="toolbar" role="toolbar" aria-label={t('Document tools')}>
      {settings.value.toolbar.map((id, i) => {
        const item = byId.get(id)
        if (!item || !item.applies(ctx)) return null
        return <div key={`${id}-${i}`} class={`tb-item tb-${id}`}>{item.render(ctx)}</div>
      })}
    </div>
  )
}
