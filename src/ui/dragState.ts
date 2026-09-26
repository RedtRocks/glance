import { signal } from '@preact/signals'

/** Page drag in progress (thumbnails / contact sheet). */
export interface PageDrag {
  docId: string
  pages: number[]
  /** Insertion index in the target document, or null when not over a page list. */
  targetDocId: string | null
  insertAt: number | null
}

export const pageDrag = signal<PageDrag | null>(null)
/** Tab being hovered while dragging pages (dropping there appends to that document). */
export const dropTabId = signal<string | null>(null)
/** OS file drag hovering the window. */
export const fileDragOver = signal(false)
