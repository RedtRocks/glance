import { useEffect, useRef } from 'preact/hooks'
import { commandById, isVisible, keysFor, runCommand } from '../state/commands'
import { displayCombo } from '../core/shortcuts'
import { menuOpen } from '../state/ui'
import { activeDoc } from '../state/documents'
import { Icon } from './Icon'
import { msg, t } from '../i18n'
import { isMenuBarMenu } from '../core/menus'

/** A command id, '-' for a separator, or '#Heading' for a group heading. */
type Entry = string

/** Menu names and group headings, marked for translation (they're shown with t()). */
export const MENU_TEXT = [
  msg('File'), msg('Edit'), msg('View'), msg('Go'), msg('Pages'), msg('Markup'), msg('Image'), msg('Help'),
  msg('Sidebar'), msg('Page layout')
]

const HELP: Entry[] = ['help.github', 'help.updates', 'help.about']
const ZOOM: Entry[] = ['view.zoomIn', 'view.zoomOut', 'view.actualSize', 'view.zoomToFit']

/** Each kind of file gets its own menu bar, like separate apps would. */
export const MENUS: Record<'none' | 'pdf' | 'image' | 'model' | 'notice', Record<string, Entry[]>> = {
  none: {
    File: ['file.open', 'file.newFromClipboard', 'file.scan', 'file.newWindow', '-', 'file.batch', 'file.collage', '-', 'file.settings'],
    Help: HELP
  },
  pdf: {
    File: ['file.open', 'file.openWith', 'file.newFromClipboard', 'file.scan', 'file.newWindow', '-', 'file.save', 'file.saveAs', 'file.versions', 'file.export', 'file.split', 'file.cleanup', 'file.reduce', '-', 'file.share', 'file.print', '-', 'file.close', '-', 'file.settings'],
    Edit: ['edit.undo', 'edit.redo', '-', 'edit.delete', 'edit.selectAll', 'edit.find', '-', 'edit.addBookmark', '-', 'tools.ocr'],
    View: [
      '#Sidebar', 'view.hideSidebar', 'view.thumbnails', 'view.toc', 'view.notes', 'view.bookmarks', '-',
      '#Page layout', 'view.continuous', 'view.single', 'view.two', 'view.contactSheet', '-',
      ...ZOOM, '-',
      'view.darkPdf', 'view.fullscreen', 'view.slideshow', '-', 'view.inspector', 'view.customizeToolbar'
    ],
    Go: ['go.previous', 'go.next', 'go.first', 'go.last', 'go.page', '-', 'go.nextTab', 'go.previousTab'],
    Pages: [
      'edit.insertBlank', 'edit.insertFile', 'edit.duplicatePages', 'edit.deletePages', '-',
      'tools.rotateLeft', 'tools.rotateRight', '-', 'file.exportPages', 'file.split'
    ],
    Markup: [
      'tools.markup', 'tools.highlight', 'tools.text', 'tools.note', 'tools.signature', '-',
      'tools.redact', 'tools.redactText', 'tools.applyRedactions'
    ],
    Help: HELP
  },
  image: {
    File: ['file.open', 'file.openWith', 'file.newFromClipboard', 'file.scan', 'file.newWindow', '-', 'file.save', 'file.saveAs', 'file.versions', 'file.export', '-', 'image.setWallpaper', 'image.setLockScreen', '-', 'file.batch', 'file.collage', '-', 'file.share', 'file.print', '-', 'file.close', '-', 'file.settings'],
    Edit: ['edit.undo', 'edit.redo', '-', 'edit.delete', 'edit.invertSelection', '-', 'tools.copyImageText'],
    // Multi-page images (TIFF, comic archives) also get the sidebar and Go menu.
    View: ['view.hideSidebar', 'view.thumbnails', '-', ...ZOOM, '-', 'view.fullscreen', 'view.slideshow', '-', 'view.inspector', 'view.customizeToolbar'],
    Go: ['go.previous', 'go.next', 'go.first', 'go.last', 'go.page', '-', 'go.nextTab', 'go.previousTab'],
    Image: [
      'tools.adjustColor', 'tools.adjustSize', '-',
      'tools.crop', 'tools.instantAlpha', 'tools.removeBackground', 'tools.copySubject', '-',
      'tools.rotateLeft', 'tools.rotateRight', 'tools.straighten', 'tools.flipHorizontal', 'tools.flipVertical'
    ],
    Markup: ['tools.markup', 'tools.text', 'tools.signature', '-', 'tools.redact'],
    Help: HELP
  },
  model: {
    File: ['file.open', 'file.openWith', 'file.newFromClipboard', 'file.scan', 'file.newWindow', '-', 'file.export', '-', 'file.share', '-', 'file.close', '-', 'file.settings'],
    View: [...ZOOM, 'model.resetView', '-', 'model.view.front', 'model.view.back', 'model.view.left', 'model.view.right', 'model.view.top', 'model.view.bottom', '-', 'model.wireframe', 'model.autoRotate', 'model.shadow', 'model.grid', '-', 'view.fullscreen', '-', 'view.inspector', 'view.customizeToolbar'],
    Go: ['go.nextTab', 'go.previousTab'],
    Help: HELP
  },
  notice: {
    File: ['file.open', 'file.openWith', 'file.newFromClipboard', 'file.scan', 'file.newWindow', '-', 'file.close', '-', 'file.settings'],
    Go: ['go.nextTab', 'go.previousTab'],
    Help: HELP
  }
}

export function menusFor(kind: keyof typeof MENUS | undefined): Record<string, Entry[]> {
  return MENUS[kind ?? 'none']
}

/**
 * The entries that apply to the open file: hidden commands are dropped, then any
 * heading or separator left without commands under it.
 */
export function visibleEntries(items: Entry[]): Entry[] {
  const groups: Entry[][] = [[]]
  for (const id of items) {
    if (id === '-') groups.push([])
    else if (id.startsWith('#') || isVisible(id)) groups[groups.length - 1].push(id)
  }
  return groups
    .map((g) => (g.some((id) => !id.startsWith('#')) ? g.filter((id, k) => !id.startsWith('#') || g.slice(k + 1).some((n) => !n.startsWith('#'))) : []))
    .filter((g) => g.length)
    .flatMap((g, k) => (k ? ['-', ...g] : g))
}

export function MenuItems({ items, onDone }: { items: Entry[]; onDone: () => void }) {
  return (
    <div class="menu" role="menu">
      {visibleEntries(items).map((id, i) => {
        if (id === '-') return <div key={i} class="menu-sep" role="separator" />
        if (id.startsWith('#')) {
          const heading = id.slice(1) // marked in MENU_TEXT
          return <div key={i} class="menu-heading" role="presentation">{t(heading)}</div>
        }
        const cmd = commandById.get(id)
        if (!cmd) return null
        const enabled = cmd.enabled ? cmd.enabled() : true
        const checked = cmd.checked?.()
        const keys = keysFor(id)
        const radio = !!cmd.radio
        return (
          <button
            key={id}
            class="menu-item"
            role={radio ? 'menuitemradio' : checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={checked}
            disabled={!enabled}
            onClick={() => {
              onDone()
              void runCommand(id)
            }}
          >
            <span class="menu-check">{checked ? radio ? <span class="radio-dot" aria-hidden="true" /> : <Icon name="check" size={16} /> : null}</span>
            <span class="menu-label">{t(cmd.label)}</span>
            <span class="menu-keys">{keys[0] ? displayCombo(keys[0]) : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

export function MenuBar() {
  const ref = useRef<HTMLDivElement>(null)
  const open = menuOpen.value

  useEffect(() => {
    if (!isMenuBarMenu(open)) return
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
    <div class="menubar" ref={ref} role="menubar">
      {Object.entries(menusFor(activeDoc.value?.kind))
        .filter(([, items]) => visibleEntries(items).length > 0)
        .map(([name, items]) => (
        <div class="menubar-entry" key={name}>
          <button
            class={`menubar-button ${open === name ? 'active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === name}
            onClick={() => (menuOpen.value = open === name ? null : name)}
            onPointerEnter={() => {
              if (open && open !== name) menuOpen.value = name
            }}
          >
            {t(name)}
          </button>
          {open === name && <MenuItems items={items} onDone={() => (menuOpen.value = null)} />}
        </div>
      ))}
    </div>
  )
}
