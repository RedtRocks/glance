/**
 * Changes AI edits made (see state/aiEdit.ts), kept small so the page view can outline
 * them without loading the editing code.
 */
import { signal } from '@preact/signals'
import type { Markup, Rect } from '../core/markup'
import { PdfDoc, type ImageDoc } from './documents'

export interface AiChange {
  id: string
  doc: PdfDoc | ImageDoc
  page: number
  /** Markup the change added. */
  ids: string[]
  /** Earlier AI markup it replaced, put back if it's undone. */
  removed: Markup[]
  /** Where it is, for the outline (markup space). */
  rect: Rect
  /** What changed, in English for the AI. */
  label: string
  /** What changed, for the sidebar to word in the user's language. */
  what: { kind: 'replace' | 'delete' | 'add' | 'erase'; old?: string; text?: string }
}

/** Changes shown outlined on the page until the user keeps or undoes them. */
export const pending = signal<AiChange[]>([])
/** Every change made, so the sidebar can collect the ones from one request. */
let made: AiChange[] = []

export const changesSince = (n: number): AiChange[] => made.slice(n)
export const changeCount = (): number => made.length

export function record(c: AiChange): void {
  made = [...made, c]
  pending.value = [...pending.peek(), c]
}

/** Stops outlining these changes; they stay in the document. */
export function keep(ids: string[]): void {
  pending.value = pending.peek().filter((c) => !ids.includes(c.id))
}

/**
 * Removes these changes from their documents, newest first, putting back what each one
 * replaced (an edit can redraw an earlier one's text), as one undoable step per document.
 */
export function undoChanges(ids: string[]): number {
  const list = made.filter((c) => ids.includes(c.id)).reverse()
  let count = 0
  for (const doc of new Set(list.map((c) => c.doc))) {
    let markup = doc.markup.peek()
    for (const c of list.filter((x) => x.doc === doc)) {
      const drop = new Set(c.ids)
      const next = markup.filter((m) => !drop.has(m.id))
      if (next.length !== markup.length) count++
      markup = [...next, ...c.removed]
    }
    if (markup !== doc.markup.peek()) doc.edit('Undo AI Edit', { markup })
  }
  keep(ids)
  return count
}

/** Whether a change is still in its document (the user may have undone or deleted it). */
export function isLive(c: AiChange): boolean {
  const have = new Set(c.doc.markup.peek().map((m) => m.id))
  return c.ids.some((id) => have.has(id))
}

export function findChange(id: string): AiChange | undefined {
  return made.find((c) => c.id === id)
}

/** Shows a change: its page, scrolled into view. */
export function reveal(c: AiChange): void {
  if (c.doc instanceof PdfDoc) c.doc.goTo(c.page)
  else c.doc.current.value = c.page
}

