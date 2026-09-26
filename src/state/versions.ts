/**
 * Version history glue (ADR 0005): the file as it was before Glance first
 * overwrote it, and every save afterwards, become versions. History never blocks
 * saving: failures are logged and ignored.
 */
import { signal } from '@preact/signals'
import * as platform from '../platform'
import type { Doc } from './documents'
import { showDialog } from './ui'

/** Documents whose on-disk original has been recorded this session. */
const originals = new WeakSet<Doc>()
/** Documents that had redactions applied since they were opened. */
export const redactedDocs = new WeakSet<Doc>()

export const versionsOpen = signal(false)

/** Call right before overwriting `path` for `doc`. */
export async function beforeOverwrite(doc: Doc, path: string): Promise<void> {
  if (originals.has(doc)) return
  originals.add(doc)
  try {
    await platform.historyRecordFile(path, 'Before editing')
  } catch (e) {
    console.warn('history: could not record the original', e)
  }
}

/** Call after `path` was written. */
export async function afterWrite(path: string, label: string, bytes?: Uint8Array): Promise<void> {
  try {
    if (bytes) await platform.historyRecord(path, bytes, label)
    else await platform.historyRecordFile(path, label)
  } catch (e) {
    console.warn('history: could not record a version', e)
  }
}

/** The file's stamp when this document last read or wrote it. */
const stamps = new WeakMap<Doc, platform.FileStamp>()
/** Documents whose file was changed by someone else; autosave waits for the user. */
export const conflicts = signal<ReadonlySet<Doc>>(new Set())

export async function rememberStamp(doc: Doc): Promise<void> {
  const path = doc.path.peek()
  const s = path ? await platform.fileStamp(path) : null
  if (s) stamps.set(doc, s)
  if (conflicts.peek().has(doc)) conflicts.value = new Set([...conflicts.peek()].filter((d) => d !== doc))
}

/**
 * Before overwriting: was the file changed by another app (or deleted) since we read
 * or wrote it? Autosave never overwrites such changes; a manual save asks. Either
 * way the other version is kept in the history first.
 */
export async function checkDisk(doc: Doc, path: string, auto: boolean): Promise<'ok' | 'cancel' | 'copy'> {
  const known = stamps.get(doc)
  const now = await platform.fileStamp(path)
  if (!known || !now || (now.modified === known.modified && now.size === known.size)) return 'ok'
  if (auto) {
    conflicts.value = new Set([...conflicts.peek(), doc])
    return 'cancel'
  }
  const choice = await showDialog<'replace' | 'copy' | 'cancel'>({
    title: `“${doc.name.peek()}” was changed by another app`,
    body: 'The file on disk is newer than the version you are editing. Replace it with your version, or save your version as a copy? If you replace it, the other version stays in File → Browse Versions.',
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save as copy…', value: 'copy' },
      { label: 'Replace', value: 'replace', primary: true }
    ]
  })
  if (choice === 'replace') {
    await afterWrite(path, 'Changed by another app')
    return 'ok'
  }
  return choice === 'copy' ? 'copy' : 'cancel'
}
