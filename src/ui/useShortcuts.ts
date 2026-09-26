import { useEffect } from 'preact/hooks'
import { comboFromEvent } from '../core/shortcuts'
import { bindings, runCommand } from '../state/commands'
import { dialog, settingsOpen, customizeOpen, slideshow } from '../state/ui'
import { editingId, selectedId, setTool, signatureDialog, tool } from '../state/markupState'
import { adjustSizeOpen, exportOpen, imageSelection, straighten } from '../state/imageState'

/** Keys that must keep their text-editing meaning inside inputs. */
const TEXT_KEYS = new Set(['Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Home', 'End', 'Delete', 'Backspace', 'PageUp', 'PageDown', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X'])

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (dialog.peek() || settingsOpen.peek() || customizeOpen.peek() || slideshow.peek() || signatureDialog.peek() || editingId.peek() || adjustSizeOpen.peek() || exportOpen.peek() || straighten.peek()) return
      if (e.key === 'Escape' && (tool.peek() !== 'select' || selectedId.peek() || imageSelection.peek())) {
        if (imageSelection.peek()) imageSelection.value = null
        else if (tool.peek() !== 'select') setTool('select')
        selectedId.value = null
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      const t = e.target as HTMLElement | null
      const editing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (editing && (TEXT_KEYS.has(combo) || !combo.includes('Ctrl'))) return
      // Let the text layer keep native copy.
      if (combo === 'Ctrl+C') return
      const map = bindings()
      const id = Object.keys(map).find((k) => map[k].includes(combo))
      if (!id) return
      e.preventDefault()
      void runCommand(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
