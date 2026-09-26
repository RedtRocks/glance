import { useEffect } from 'preact/hooks'
import { comboFromEvent } from '../core/shortcuts'
import { commandForCombo, runCommand } from '../state/commands'
import { dialog, settingsOpen, customizeOpen, slideshow } from '../state/ui'
import { editingId, selectedId, setTool, signatureDialog, spaceHeld, tool } from '../state/markupState'
import { adjustSizeOpen, exportOpen, imageSelection } from '../state/imageState'

/** Keys that must keep their text-editing meaning inside inputs. */
const TEXT_KEYS = new Set(['Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Home', 'End', 'Delete', 'Backspace', 'PageUp', 'PageDown', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X'])

function modalOpen(): boolean {
  return !!dialog.peek() || settingsOpen.peek() || customizeOpen.peek() || slideshow.peek() || signatureDialog.peek() || !!editingId.peek() || adjustSizeOpen.peek() || exportOpen.peek()
}

/** Fields that take typing, where single-key shortcuts must not fire. */
function typingIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (modalOpen()) return
      // Hold Space to pan with the hand, whatever the tool (Photoshop, Figma, Acrobat).
      // Buttons and links keep Space for pressing.
      if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !typingIn(e.target) && !(e.target as HTMLElement).closest?.('button, a, [role="button"]')) {
        e.preventDefault()
        spaceHeld.value = true
        return
      }
      if (e.key === 'Escape' && (tool.peek() !== 'select' || selectedId.peek() || imageSelection.peek())) {
        if (imageSelection.peek()) imageSelection.value = null
        else if (tool.peek() !== 'select') setTool('select')
        selectedId.value = null
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      const editing = typingIn(e.target)
      if (editing && (TEXT_KEYS.has(combo) || !combo.includes('Ctrl'))) return
      // Let the text layer keep native copy.
      if (combo === 'Ctrl+C') return
      // Holding a tool key doesn't keep cycling through its group.
      if (e.repeat && /^[A-Z]$/.test(combo)) return
      const id = commandForCombo(combo)
      if (!id) return
      e.preventDefault()
      void runCommand(id)
    }
    const release = (e: KeyboardEvent | FocusEvent): void => {
      if (e.type === 'blur' || (e as KeyboardEvent).code === 'Space') spaceHeld.value = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', release)
    }
  }, [])
}
