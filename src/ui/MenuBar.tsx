import { useEffect, useRef } from 'preact/hooks'
import { commandById, keysFor, runCommand } from '../state/commands'
import { displayCombo } from '../core/shortcuts'
import { menuOpen } from '../state/ui'
import { Icon } from './Icon'

type Entry = string | '-'

export const MENUS: Record<string, Entry[]> = {
  File: ['file.open', 'file.openWith', 'file.newWindow', '-', 'file.save', 'file.saveAs', 'file.export', 'file.exportPages', 'file.split', '-', 'image.setWallpaper', 'image.setLockScreen', '-', 'file.print', '-', 'file.close', '-', 'file.settings'],
  Edit: ['edit.undo', 'edit.redo', '-', 'edit.delete', 'edit.selectAll', 'edit.invertSelection', 'edit.find', '-', 'edit.insertBlank', 'edit.insertFile', 'edit.duplicatePages', 'edit.deletePages', '-', 'edit.addBookmark'],
  View: [
    'view.hideSidebar', 'view.thumbnails', 'view.toc', 'view.notes', 'view.bookmarks', 'view.contactSheet', '-',
    'view.continuous', 'view.single', 'view.two', '-',
    'view.zoomIn', 'view.zoomOut', 'view.actualSize', 'view.zoomToFit', '-',
    'view.darkPdf', 'view.fullscreen', 'view.slideshow', '-', 'view.customizeToolbar'
  ],
  Go: ['go.previous', 'go.next', 'go.first', 'go.last', 'go.page', '-', 'go.nextTab', 'go.previousTab'],
  Tools: [
    'tools.markup', 'tools.highlight', 'tools.text', 'tools.note', 'tools.signature', '-',
    'tools.redact', 'tools.applyRedactions', '-',
    'tools.adjustColor', 'tools.adjustSize', 'tools.crop', 'tools.instantAlpha', 'tools.removeBackground', 'tools.copySubject', '-',
    'tools.rotateLeft', 'tools.rotateRight', 'tools.flipHorizontal', 'tools.flipVertical'
  ],
  Help: ['help.github', 'help.about']
}

export function MenuItems({ items, onDone }: { items: Entry[]; onDone: () => void }) {
  return (
    <div class="menu" role="menu">
      {items.map((id, i) => {
        if (id === '-') return <div key={i} class="menu-sep" role="separator" />
        const cmd = commandById.get(id)
        if (!cmd) return null
        const enabled = cmd.enabled ? cmd.enabled() : true
        const checked = cmd.checked?.()
        const keys = keysFor(id)
        return (
          <button
            key={id}
            class="menu-item"
            role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={checked}
            disabled={!enabled}
            onClick={() => {
              onDone()
              void runCommand(id)
            }}
          >
            <span class="menu-check">{checked ? <Icon name="check" size={16} /> : null}</span>
            <span class="menu-label">{cmd.label}</span>
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
    <div class="menubar" ref={ref} role="menubar">
      {Object.entries(MENUS).map(([name, items]) => (
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
            {name}
          </button>
          {open === name && <MenuItems items={items} onDone={() => (menuOpen.value = null)} />}
        </div>
      ))}
    </div>
  )
}
