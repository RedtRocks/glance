import type { Doc } from '../state/documents'
import { removeDoc } from '../state/documents'
import { openFiles, save } from '../state/actions'
import { conflicts } from '../state/versions'
import * as platform from '../platform'
import { InfoBar } from './InfoBar'

/** Shown when another app changed the file: autosave waits until the user decides. */
export function ConflictBar({ doc }: { doc: Doc }) {
  if (!conflicts.value.has(doc)) return null
  const reload = async (): Promise<void> => {
    const path = doc.path.peek()
    if (!path) return
    if (doc.dirty.peek() && !(await platform.confirmDialog('Discard your unsaved changes and load the file as it is on disk now?', 'Reload', 'Discard and reload'))) return
    removeDoc(doc.id)
    await openFiles([path])
  }
  return (
    <InfoBar
      severity="warning"
      title="This file was changed by another app"
      actions={
        <>
          <button class="btn" onClick={() => void reload()}>
            Reload
          </button>
          <button class="btn primary" onClick={() => void save(doc)}>
            Keep my version…
          </button>
        </>
      }
    >
      Autosave is paused so neither version is lost.
    </InfoBar>
  )
}
