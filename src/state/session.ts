/**
 * Reopen tabs on launch (off by default). The first window keeps the list of its
 * open files, with each tab's page and zoom, in local storage as they change, and
 * reopens them at the next launch. Files that have since moved or been deleted
 * are skipped without a message. Windows opened later (tabs moved out) aren't
 * remembered.
 */
import { effect } from '@preact/signals'
import { activeId, docs, findByPath, type Doc } from './documents'
import { settings } from './settings'
import { openFiles } from './actions'
import { captureSession, parseSession, type Session, type SessionSource } from '../core/session'
import * as platform from '../platform'

const KEY = 'glance.session.v1'

function source(d: Doc, active: string | null): SessionSource {
  const page = 'current' in d ? d.current.value : 0
  const zoom = d.kind === 'pdf' || d.kind === 'image' ? d.zoom.value : 'fit'
  return { kind: d.kind, path: d.path.value, convertedFrom: d.kind === 'pdf' ? d.convertedFrom : null, page, zoom, active: d.id === active }
}

function write(session: Session | null): void {
  try {
    if (session?.tabs.length) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable */
  }
}

function read(): Session | null {
  try {
    return parseSession(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

function applyView(d: Doc, page: number, zoom: number | string): void {
  if (d.kind === 'pdf') {
    if (typeof zoom === 'number' || zoom === 'fit-width' || zoom === 'fit-page') d.zoom.value = zoom
    if (page > 0 && page < d.pageCount.peek()) d.goTo(page)
  } else if (d.kind === 'image') {
    if (typeof zoom === 'number' || zoom === 'fit') d.zoom.value = zoom
    if (page > 0 && page < d.pageCount.peek()) d.current.value = page
  }
}

/** Reopens the last session's tabs (when enabled), then keeps the stored list current. */
export async function restoreSession(): Promise<() => void> {
  // Browser builds open files as blobs that don't survive a reload.
  if (!platform.isTauri || (await platform.windowLabel()) !== 'main') return () => {}
  const saved = settings.peek().reopenTabs ? read() : null
  if (saved) {
    const present: typeof saved.tabs = []
    for (const t of saved.tabs) if (await platform.fileStamp(t.path)) present.push(t)
    await openFiles(
      present.map((t) => t.path),
      { quiet: true }
    )
    for (const t of present) {
      const d = findByPath(t.path)
      if (d) applyView(d, t.page, t.zoom)
    }
    const front = saved.tabs[saved.active] && findByPath(saved.tabs[saved.active].path)
    if (front) activeId.value = front.id
  }
  return effect(() => {
    if (!settings.value.reopenTabs) return write(null)
    const active = activeId.value
    write(captureSession(docs.value.map((d) => source(d, active)), platform.pathPolicy))
  })
}
