/**
 * Autosave (ADR 0004): a few seconds after edits stop, edited documents are saved
 * in place. Every save becomes a version, so nothing is lost. Skipped while a
 * dialog is open, while text is being typed into a markup box, for files that
 * must be saved as (no writable path), and for pending redactions (save() checks).
 */
import { effect } from '@preact/signals'
import { docs, type Doc } from './documents'
import { settings } from './settings'
import { dialog, toast } from './ui'
import { editingId } from './markupState'
import { save } from './actions'
import { conflicts } from './versions'
import { isTauri } from '../platform'

const DELAY = 4000

export function startAutosave(): () => void {
  const timers = new Map<string, number>()
  const failed = new Set<string>()

  const attempt = async (d: Doc): Promise<void> => {
    timers.delete(d.id)
    // (The browser build can only "save" as downloads, so it never autosaves.)
    if (!isTauri || !settings.peek().autosave || !d.dirty.peek() || !docs.peek().includes(d) || conflicts.peek().has(d)) return
    if (dialog.peek() || editingId.peek()) {
      timers.set(d.id, window.setTimeout(() => void attempt(d), DELAY))
      return
    }
    try {
      await save(d, { auto: true })
      failed.delete(d.id)
    } catch (e) {
      // Tell once per document; manual Save still reports every error.
      if (!failed.has(d.id)) toast(`Couldn’t save “${d.name.peek()}” automatically: ${(e as Error).message ?? e}`, 'error')
      failed.add(d.id)
    }
  }

  const dispose = effect(() => {
    if (!settings.value.autosave) return
    for (const d of docs.value) {
      if (d.kind === 'notice' || d.kind === 'model') continue
      void d.historyVersion.value // any edit
      if (!d.dirty.value) continue
      clearTimeout(timers.get(d.id))
      timers.set(d.id, window.setTimeout(() => void attempt(d), DELAY))
    }
  })
  return () => {
    dispose()
    timers.forEach((t) => clearTimeout(t))
  }
}
