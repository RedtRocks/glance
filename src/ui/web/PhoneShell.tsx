import { signal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { activeDoc, activeId, docs, type Doc } from '../../state/documents'
import { closeDoc, openWithDialog } from '../../state/actions'
import { isEnabled, isVisible, runCommand } from '../../state/commands'
import { markupBar } from '../../state/markupState'
import { findOpen, findQuery } from '../../state/ui'
import { hitIndex, hits, runSearch, stepHit } from '../../pdf/search'
import { MenuItems, menusFor, visibleEntries } from '../MenuBar'
import { sidebarBody } from '../sidebar/Sidebar'
import { bytes } from '../InspectorPane'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { Sheet } from './Sheet'
import { t } from '../../i18n'

/** The browser version on a phone: a top bar, a floating dock and bottom sheets instead of menus. */
export const phoneSheet = signal<'pages' | 'share' | 'more' | 'files' | null>(null)

const closeSheet = (): void => void (phoneSheet.value = null)

function sizeOf(doc: Doc): number | null {
  if (doc.kind === 'pdf') return doc.bytes.length || null
  if (doc.kind === 'image' || doc.kind === 'model') return doc.probe.size
  return null
}

function meta(doc: Doc): string {
  if (doc.dirty.value) return t('Edited')
  const parts: string[] = []
  if (doc.kind === 'pdf' || (doc.kind === 'image' && doc.pageCount.value > 1)) parts.push(t('{count, plural, one {# page} other {# pages}}', { count: doc.pageCount.value }))
  const size = sizeOf(doc)
  if (size) parts.push(bytes(size))
  return parts.join(' · ')
}

export function PhoneBar({ doc }: { doc: Doc }) {
  if (markupBar.value) {
    return (
      <div class="phone-bar markup">
        <button class="phone-icon" aria-label={t('Undo')} disabled={!isEnabled('edit.undo')} onClick={() => void runCommand('edit.undo')}>
          <Icon name="undo" size={24} />
        </button>
        <h1>{t('Markup')}</h1>
        <button class="w-btn ink" onClick={() => void runCommand('tools.markup')}>{t('Done')}</button>
      </div>
    )
  }
  const count = docs.value.length
  return (
    <div class="phone-bar">
      {/* Back to the start screen; the file stays open behind the count box. */}
      <button class="phone-icon" aria-label={t('Back')} onClick={() => (activeId.value = null)}>
        <Icon name="back" size={24} />
      </button>
      <div class="phone-title">
        <h1>{doc.name.value}</h1>
        <p>{meta(doc)}</p>
      </div>
      {count > 1 && (
        <button class="phone-count" aria-label={t('{count, plural, one {# open file} other {# open files}}', { count })} onClick={() => (phoneSheet.value = 'files')}>
          {count}
        </button>
      )}
      <button class="phone-icon" aria-label={t('More')} onClick={() => (phoneSheet.value = 'more')}>
        <Icon name="more" size={24} />
      </button>
    </div>
  )
}

export function PhoneSearch({ doc }: { doc: Doc }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  if (doc.kind !== 'pdf') return null
  const count = hits.value.length
  const close = (): void => {
    findQuery.value = ''
    void runSearch(doc, '')
    findOpen.value = false
  }
  return (
    <div class="phone-search">
      <label class="w-field">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          placeholder={t('Search')}
          aria-label={t('Search document')}
          value={findQuery.value}
          onInput={(e) => {
            findQuery.value = (e.target as HTMLInputElement).value
            void runSearch(doc, findQuery.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') stepHit(doc, 1)
            if (e.key === 'Escape') close()
          }}
        />
        {findQuery.value && <span class="search-count">{count ? t('{index} of {count}', { index: hitIndex.value + 1, count }) : t('No results')}</span>}
      </label>
      <button class="phone-icon" aria-label={t('Previous Result')} disabled={!count} onClick={() => stepHit(doc, -1)}>
        <Icon name="up" />
      </button>
      <button class="phone-icon" aria-label={t('Next Result')} disabled={!count} onClick={() => stepHit(doc, 1)}>
        <Icon name="down" />
      </button>
      <button class="w-btn" onClick={close}>{t('Done')}</button>
    </div>
  )
}

function DockButton({ icon, label, onClick, pressed }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button class={`dock-button ${pressed ? 'pressed' : ''}`} aria-pressed={pressed} onClick={onClick}>
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </button>
  )
}

export function PhoneDock({ doc }: { doc: Doc }) {
  if (markupBar.value || doc.kind === 'notice') return null
  const share = <DockButton icon="upload" label={t('Share')} onClick={() => (phoneSheet.value = 'share')} />
  const more = <DockButton icon="more" label={t('More')} onClick={() => (phoneSheet.value = 'more')} />
  const paged = doc.kind === 'pdf' || (doc.kind === 'image' && doc.pageCount.value > 1)
  return (
    <nav class="phone-dock" aria-label={t('Tools')}>
      {paged && <DockButton icon="grid" label={t('Pages')} onClick={() => (phoneSheet.value = 'pages')} />}
      {doc.kind === 'pdf' && <DockButton icon="search" label={t('Search')} pressed={findOpen.value} onClick={() => (findOpen.value = !findOpen.value)} />}
      {doc.kind === 'image' && !paged && <DockButton icon="rotateLeft" label={t('Rotate')} onClick={() => void runCommand('tools.rotateLeft')} />}
      {doc.kind !== 'model' && isVisible('tools.markup') && <DockButton icon="pen" label={t('Markup')} onClick={() => void runCommand('tools.markup')} />}
      {doc.kind === 'image' && isVisible('tools.adjustColor') && <DockButton icon="adjustColor" label={t('Adjust')} onClick={() => void runCommand('tools.adjustColor')} />}
      {doc.kind === 'model' && <DockButton icon="cube" label={t('Reset View')} onClick={() => void runCommand('model.resetView')} />}
      {share}
      {more}
    </nav>
  )
}

export function PageCounter({ doc }: { doc: Doc }) {
  if (markupBar.value || (doc.kind !== 'pdf' && doc.kind !== 'image')) return null
  const count = doc.pageCount.value
  if (count < 2) return null
  return <div class="page-counter" aria-live="polite">{t('{page} of {count}', { page: doc.current.value + 1, count })}</div>
}

function PagesSheet({ doc }: { doc: Doc }) {
  const body = sidebarBody(doc)
  const modes = doc.kind === 'pdf'
    ? ([['thumbnails', t('Pages')], ['toc', t('Contents')], ['notes', t('Notes')]] as const)
    : []
  const current = doc.sidebar.value === 'none' || doc.sidebar.value === 'bookmarks' ? 'thumbnails' : doc.sidebar.value
  return (
    <Sheet
      title={t('Pages')}
      class="pages-sheet"
      onClose={closeSheet}
      aside={modes.length > 0 && (
        <div class="w-segmented" role="tablist">
          {modes.map(([mode, label]) => (
            <button key={mode} role="tab" aria-selected={current === mode} onClick={() => (doc.sidebar.value = mode)}>{label}</button>
          ))}
        </div>
      )}
    >
      {/* Picking a page shows it straight away. */}
      <div class="pages-grid" onClick={(e) => (e.target as HTMLElement).closest('.thumb, .toc-item, .note-item') && closeSheet()}>
        {body}
      </div>
      {doc.kind === 'pdf' && current === 'thumbnails' && (
        <div class="sheet-actions">
          <button class="w-btn" onClick={() => void runCommand('tools.rotateLeft')}><Icon name="rotateLeft" />{t('Rotate')}</button>
          <button class="w-btn" onClick={() => void runCommand('edit.insertFile')}><Icon name="add" />{t('Add')}</button>
          <button class="w-btn" disabled={!isEnabled('edit.deletePages')} onClick={() => void runCommand('edit.deletePages')}><Icon name="trash" />{t('Delete')}</button>
        </div>
      )}
    </Sheet>
  )
}

function SheetRow({ icon, tone, title, sub, onClick }: { icon: IconName; tone: string; title: string; sub?: string; onClick: () => void }) {
  return (
    <button class="sheet-row" onClick={() => (closeSheet(), onClick())}>
      <span class={`sheet-row-icon ${tone}`}><Icon name={icon} size={24} /></span>
      <span class="sheet-row-text">
        <span>{title}</span>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  )
}

function ShareSheet({ doc }: { doc: Doc }) {
  const editable = doc.kind === 'pdf' || doc.kind === 'image'
  return (
    <Sheet title={t('Share or Save')} sub={editable ? t('Your markup is saved into the file.') : undefined} onClose={closeSheet}>
      {isVisible('file.share') && <SheetRow icon="upload" tone="yellow" title={t('Share…')} sub={t('Send it to another app')} onClick={() => void runCommand('file.share')} />}
      {editable && <SheetRow icon="download" tone="pink" title={t('Download')} sub={t('Saves a copy to Downloads')} onClick={() => void runCommand('file.save')} />}
      {isVisible('file.export') && <SheetRow icon="document" tone="orange" title={t('Export As…')} sub={doc.kind === 'model' ? t('A picture of the current view') : t('PDF, JPEG, PNG and more')} onClick={() => void runCommand('file.export')} />}
      {isVisible('file.print') && <SheetRow icon="print" tone="plain" title={t('Print…')} onClick={() => void runCommand('file.print')} />}
    </Sheet>
  )
}

function MoreSheet({ doc }: { doc: Doc }) {
  const groups = Object.entries(menusFor(doc.kind)).filter(([, items]) => visibleEntries(items).length > 0)
  return (
    <Sheet title={t('More')} class="more-sheet" onClose={closeSheet}>
      {groups.map(([name, items]) => (
        <section key={name} class="more-group">
          <h3>{t(name)}</h3>
          <MenuItems items={items} onDone={closeSheet} />
        </section>
      ))}
    </Sheet>
  )
}

function FilesSheet() {
  return (
    <Sheet title={t('Open Files')} onClose={closeSheet}>
      {docs.value.map((d) => (
        <div key={d.id} class={`file-row ${d.id === activeId.value ? 'active' : ''}`}>
          <button class="file-row-main" onClick={() => (closeSheet(), (activeId.value = d.id))}>
            <Icon name={d.kind === 'image' ? 'image' : d.kind === 'model' ? 'cube' : 'document'} size={24} />
            <span>{d.name.value}</span>
          </button>
          <button class="phone-icon" aria-label={t('Close {name}', { name: d.name.value })} onClick={() => void closeDoc(d)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      <div class="sheet-actions">
        <button class="w-btn ink" onClick={() => (closeSheet(), void openWithDialog())}><Icon name="folderOpen" />{t('Open Another File')}</button>
      </div>
    </Sheet>
  )
}

export function PhoneSheets() {
  const doc = activeDoc.value
  const which = phoneSheet.value
  let sheet: ComponentChildren = null
  if (which === 'files') sheet = <FilesSheet />
  else if (doc && which === 'pages') sheet = <PagesSheet doc={doc} />
  else if (doc && which === 'share') sheet = <ShareSheet doc={doc} />
  else if (doc && which === 'more') sheet = <MoreSheet doc={doc} />
  return <>{sheet}</>
}
