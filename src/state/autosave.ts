/**
 * Autosave (ADR 0004): once edits stop, edited documents are saved in place, at
 * most once a minute each (timing in core/autosave). Every save becomes a version,
 * so nothing is lost. Skipped while a dialog is open, while text is being typed
 * into a markup box or form field, for files that must be saved as (no writable
 * path), and for pending redactions (save() checks).
 */
import { effect } from '@preact/signals'
import { activeId, docs, ImageDoc, type Doc } from './documents'
import { settings } from './settings'
import { dialog, toast } from './ui'
import { editingId } from './markupState'
import { save } from './actions'
import { conflicts } from './versions'
import { isTauri } from '../platform'
import { t } from '../i18n'
import { Autosaver, type Fingerprint } from '../core/autosave'

type Editable = Extract<Doc, { historyVersion: unknown }>

/** What a save would write, by reference; unknown while PDF form fields have unsaved input. */
function fingerprint(d: Editable): Fingerprint {
  if (d instanceof ImageDoc) return [d.raster.peek(), d.markup.peek(), d.redactions.peek()]
  return d.formsEdited ? null : [d.bytes, d.markup.peek(), d.redactions.peek()]
}

/** Typing into a fillable PDF field: saving now would write half a word. */
function typingInForm(): boolean {
  return !!(document.activeElement as HTMLElement | null)?.closest?.('.annotationLayer')
}

let running: Autosaver<Editable> | null = null

const editable = (d: Doc): d is Editable => d.kind === 'pdf' || d.kind === 'image'

/**
 * Saves edited documents now rather than when their countdown ends (all of them,
 * or just `doc`). Used when the window loses focus, the tab changes, and before
 * closing, so only what autosave never writes is left to ask about.
 */
export async function flushAutosave(doc?: Doc): Promise<void> {
  const saver = running
  if (!saver) return
  const targets = (doc ? [doc] : docs.peek()).filter(editable).filter((d) => d.dirty.peek())
  await Promise.all(targets.map((d) => saver.flush(d)))
}

export function startAutosave(): () => void {
  const failed = new Set<string>()
  const saver = new Autosaver<Editable>({
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
    isDirty: (d) => d.dirty.peek(),
    setDirty: (d, v) => (d.dirty.value = v),
    editCount: (d) => d.historyVersion.peek(),
    fingerprint,
    // (The browser build can only "save" as downloads, so it never autosaves.)
    canSave: (d) => isTauri && settings.peek().autosave && docs.peek().includes(d) && !conflicts.peek().has(d),
    mustWait: () => !!dialog.peek() || !!editingId.peek() || typingInForm(),
    save: async (d) => {
      await save(d, { auto: true })
      failed.delete(d.id)
    },
    onError: (d, e) => {
      // Tell once per document; manual Save still reports every error.
      if (!failed.has(d.id)) toast(t('Couldn’t save “{file}” automatically: {error}', { file: d.name.peek(), error: String((e as Error).message ?? e) }), 'error')
      failed.add(d.id)
    }
  })

  // Last edit state seen per document, so re-runs caused by other documents
  // (or by settings) don't count as edits and restart everyone's countdown.
  const seen = new Map<Editable, string>()
  const dispose = effect(() => {
    const open = new Set<Editable>()
    if (settings.value.autosave) {
      for (const d of docs.value) {
        if (!editable(d)) continue
        open.add(d)
        const version = d.historyVersion.value
        const dirty = d.dirty.value
        // A PDF's bytes arrive after the tab opens; keep the clean baseline current.
        if (!dirty && d.kind === 'pdf') void d.revision.value
        const key = `${version}:${dirty}`
        if (seen.get(d) === key && dirty) continue
        seen.set(d, key)
        if (dirty) saver.edited(d)
        else saver.clean(d)
      }
    }
    for (const d of [...seen.keys()]) {
      if (open.has(d)) continue
      seen.delete(d)
      saver.forget(d)
    }
  })
  running = saver

  // Like Preview: switching to another app or another tab saves what you left.
  const onBlur = (): void => void flushAutosave()
  window.addEventListener('blur', onBlur)
  let previous = activeId.peek()
  const disposeTabs = effect(() => {
    const id = activeId.value
    const left = previous && previous !== id ? docs.peek().find((d) => d.id === previous) : undefined
    previous = id
    if (left) void flushAutosave(left)
  })

  return () => {
    dispose()
    disposeTabs()
    window.removeEventListener('blur', onBlur)
    saver.dispose()
    if (running === saver) running = null
  }
}
