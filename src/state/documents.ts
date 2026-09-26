import { computed, signal, type Signal } from '@preact/signals'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { History } from './history'
import { openPdf, readOutline, PasswordRequired, type OutlineNode } from '../pdf/engine'
import type { Probe } from '../platform'

let seq = 0
const nextId = (): string => `doc${++seq}`

export type Zoom = number | 'fit-width' | 'fit-page'
export type ViewMode = 'continuous' | 'single' | 'two'
export type SidebarMode = 'thumbnails' | 'toc' | 'none'

abstract class BaseDoc {
  readonly id = nextId()
  readonly name: Signal<string>
  /** On-disk path; null for documents that must be saved with Save As. */
  readonly path: Signal<string | null>
  readonly dirty = signal(false)
  readonly sidebar = signal<SidebarMode>('thumbnails')

  constructor(name: string, path: string | null) {
    this.name = signal(name)
    this.path = signal(path)
  }
}

export class PdfDoc extends BaseDoc {
  readonly kind = 'pdf' as const
  bytes: Uint8Array = new Uint8Array()
  password?: string
  /** Set when the PDF came from PostScript/EPS conversion or an .ai file. */
  readonly convertedFrom: string | null
  readonly proxy = signal<PDFDocumentProxy | null>(null)
  readonly pageCount = signal(0)
  /** Bumped whenever page content changes; thumbnails key their cache on it. */
  readonly revision = signal(0)
  readonly current = signal(0)
  readonly selection = signal<number[]>([])
  readonly zoom = signal<Zoom>('fit-width')
  /** Scale actually in effect (fit modes resolve to a number in the view). */
  readonly effectiveScale = signal(1)
  readonly viewMode = signal<ViewMode>('continuous')
  readonly outline = signal<OutlineNode[]>([])
  readonly contactSheet = signal(false)
  /** Scroll requests from page controls, sidebar, search and shortcuts. */
  readonly jump = signal<{ page: number; seq: number } | null>(null)
  readonly history = new History<Uint8Array>(25)
  readonly historyVersion = signal(0)
  encrypted = false

  constructor(name: string, path: string | null, convertedFrom: string | null = null) {
    super(name, path)
    this.convertedFrom = convertedFrom
  }

  goTo(page: number): void {
    const p = Math.min(Math.max(page, 0), this.pageCount.peek() - 1)
    this.current.value = p
    this.jump.value = { page: p, seq: (this.jump.peek()?.seq ?? 0) + 1 }
  }

  async load(bytes: Uint8Array): Promise<void> {
    const proxy = await openPdf(bytes, this.password)
    const old = this.proxy.peek()
    this.bytes = bytes
    this.proxy.value = proxy
    this.pageCount.value = proxy.numPages
    this.current.value = Math.min(this.current.peek(), proxy.numPages - 1)
    this.selection.value = this.selection.peek().filter((i) => i < proxy.numPages)
    this.revision.value++
    readOutline(proxy).then((o) => (this.outline.value = o)).catch(() => (this.outline.value = []))
    if (old) void old.loadingTask.destroy()
  }

  /** Applies a byte-level operation as one undoable step. */
  async apply(label: string, op: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<void> {
    if (this.encrypted) throw new Error('Remove the password protection before editing pages of this PDF.')
    const prev = this.bytes
    const next = await op(prev)
    await this.load(next)
    this.history.push(label, prev)
    this.historyVersion.value++
    this.dirty.value = true
  }

  async undo(): Promise<void> {
    const entry = this.history.undo(this.bytes)
    if (entry) {
      await this.load(entry.state)
      this.historyVersion.value++
      this.dirty.value = true
    }
  }

  async redo(): Promise<void> {
    const entry = this.history.redo(this.bytes)
    if (entry) {
      await this.load(entry.state)
      this.historyVersion.value++
      this.dirty.value = true
    }
  }
}

export class ImageDoc extends BaseDoc {
  readonly kind = 'image' as const
  readonly probe: Probe
  readonly pageCount: Signal<number>
  readonly current = signal(0)
  readonly selection = signal<number[]>([])
  readonly zoom = signal<number | 'fit'>('fit')
  readonly effectiveScale = signal(1)
  /** View-only rotation in degrees (editing tools arrive with the image milestone). */
  readonly rotation = signal(0)
  readonly natural = signal<{ width: number; height: number } | null>(null)
  readonly notice: string | null

  constructor(probe: Probe, notice: string | null = null) {
    super(probe.name, probe.path)
    this.probe = probe
    this.pageCount = signal(Math.max(1, probe.pages))
    this.notice = notice
    if (this.pageCount.value <= 1) this.sidebar.value = 'none'
  }
}

export interface NoticeAction {
  label: string
  run: () => void
}

/** Stand-in tab for files Glance can't show yet, with an explanation and next steps. */
export class NoticeDoc extends BaseDoc {
  readonly kind = 'notice' as const
  constructor(
    name: string,
    path: string | null,
    readonly title: string,
    readonly message: string,
    readonly actions: NoticeAction[] = []
  ) {
    super(name, path)
    this.sidebar.value = 'none'
  }
}

export type Doc = PdfDoc | ImageDoc | NoticeDoc

export const docs = signal<Doc[]>([])
export const activeId = signal<string | null>(null)
export const activeDoc = computed(() => docs.value.find((d) => d.id === activeId.value) ?? null)

export function addDoc(doc: Doc, activate = true): void {
  docs.value = [...docs.value, doc]
  if (activate) activeId.value = doc.id
}

export function removeDoc(id: string): void {
  const list = docs.value
  const idx = list.findIndex((d) => d.id === id)
  if (idx < 0) return
  const doc = list[idx]
  if (doc.kind === 'pdf') void doc.proxy.peek()?.loadingTask.destroy()
  const next = list.filter((d) => d.id !== id)
  docs.value = next
  if (activeId.value === id) activeId.value = next[Math.min(idx, next.length - 1)]?.id ?? null
}

export function findByPath(path: string): Doc | undefined {
  const norm = path.toLowerCase()
  return docs.value.find((d) => d.path.value?.toLowerCase() === norm)
}

export { PasswordRequired }
