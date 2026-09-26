import { computed, signal, type Signal } from '@preact/signals'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { History } from './history'
import { openPdf, readOutline, PasswordRequired, type OutlineNode } from '../pdf/engine'
import { releaseFile, type Probe } from '../platform'
import { remapPages, type Markup, type PageMap, type Redaction } from '../core/markup'
import type { Raster } from '../core/image/raster'

let seq = 0
const nextId = (): string => `doc${++seq}`

export type Zoom = number | 'fit-width' | 'fit-page'
export type ViewMode = 'continuous' | 'single' | 'two'
export type SidebarMode = 'thumbnails' | 'toc' | 'notes' | 'bookmarks' | 'none'

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

export class PdfDoc extends BaseDoc implements MarkupHost {
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
  /** Editable markup, kept outside the page bytes until save (ADR 0003). */
  readonly markup = signal<Markup[]>([])
  /** Marked but not yet applied redactions (ADR 0005). */
  readonly redactions = signal<Redaction[]>([])
  readonly history = new History<Snapshot>(40)
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

  private snapshot(): Snapshot {
    return { bytes: this.bytes, markup: this.markup.peek(), redactions: this.redactions.peek() }
  }

  private async restore(snap: Snapshot): Promise<void> {
    if (snap.bytes !== this.bytes) await this.load(snap.bytes)
    this.markup.value = snap.markup
    this.redactions.value = snap.redactions
  }

  private queue: Promise<unknown> = Promise.resolve()

  /**
   * Runs document operations one at a time, so e.g. Save issued right after Rotate
   * waits for the rotation instead of writing the old bytes.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Bytes including form values typed into the page since the last load. Page
   * operations start from these so filled-in fields are never lost.
   */
  async currentBytes(): Promise<Uint8Array> {
    const proxy = this.proxy.peek()
    if (proxy && proxy.annotationStorage.size > 0 && this.formsEdited) {
      this.bytes = await proxy.saveDocument()
      this.formsEdited = false
    }
    return this.bytes
  }
  formsEdited = false

  /**
   * Applies a byte-level operation as one undoable step. `pages` tells where each
   * old page ended up, so markup and redactions stay on their pages.
   */
  async apply(
    label: string,
    op: (bytes: Uint8Array) => Promise<Uint8Array | { bytes: Uint8Array; markup?: Markup[]; pages?: PageMap }>,
    pages?: PageMap
  ): Promise<void> {
    return this.exclusive(() => this.applyNow(label, op, pages))
  }

  private async applyNow(
    label: string,
    op: (bytes: Uint8Array) => Promise<Uint8Array | { bytes: Uint8Array; markup?: Markup[]; pages?: PageMap }>,
    pages?: PageMap
  ): Promise<void> {
    if (this.encrypted) throw new Error('Remove the password protection before editing pages of this PDF.')
    const before = this.snapshot()
    const result = await op(await this.currentBytes())
    const next = result instanceof Uint8Array ? { bytes: result } : result
    await this.load(next.bytes)
    pages ??= next.pages
    if (pages) {
      this.markup.value = remapPages(this.markup.peek(), pages)
      this.redactions.value = remapPages(this.redactions.peek(), pages)
    }
    if (next.markup?.length) this.markup.value = [...this.markup.peek(), ...next.markup]
    this.history.push(label, before)
    this.historyVersion.value++
    this.dirty.value = true
  }

  /** Markup/redaction edits: no page re-render, still one undo step each. */
  edit(label: string, change: { markup?: Markup[]; redactions?: Redaction[] }): void {
    this.history.push(label, this.snapshot())
    if (change.markup) this.markup.value = change.markup
    if (change.redactions) this.redactions.value = change.redactions
    this.historyVersion.value++
    this.dirty.value = true
  }

  async undo(): Promise<void> {
    return this.exclusive(() => this.step('undo'))
  }

  async redo(): Promise<void> {
    return this.exclusive(() => this.step('redo'))
  }

  private async step(dir: 'undo' | 'redo'): Promise<void> {
    const entry = dir === 'undo' ? this.history.undo(this.snapshot()) : this.history.redo(this.snapshot())
    if (entry) {
      await this.restore(entry.state)
      this.historyVersion.value++
      this.dirty.value = true
    }
  }

}

interface Snapshot {
  bytes: Uint8Array
  markup: Markup[]
  redactions: Redaction[]
}

/** What the markup layer needs from a document (PDF pages or an image). */
export interface MarkupHost {
  readonly id: string
  readonly markup: Signal<Markup[]>
  readonly redactions: Signal<Redaction[]>
  edit(label: string, change: { markup?: Markup[]; redactions?: Redaction[] }): void
}

interface ImageSnapshot {
  raster: Raster | null
  markup: Markup[]
  redactions: Redaction[]
}

/** Formats Glance can write back in place (see src-tauri/src/encode.rs). */
export const WRITABLE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'bmp', 'dib', 'tif', 'tiff', 'tga', 'qoi', 'ico']

export class ImageDoc extends BaseDoc implements MarkupHost {
  readonly kind = 'image' as const
  readonly probe: Probe
  readonly pageCount: Signal<number>
  readonly current = signal(0)
  readonly selection = signal<number[]>([])
  readonly zoom = signal<number | 'fit'>('fit')
  readonly effectiveScale = signal(1)
  /** Display rotation for view-only images (editable images rotate their pixels). */
  readonly rotation = signal(0)
  readonly natural = signal<{ width: number; height: number } | null>(null)
  readonly notice: string | null
  /** Decoded pixels, created on the first edit; until then the <img> path is used. */
  readonly raster = signal<Raster | null>(null)
  readonly markup = signal<Markup[]>([])
  readonly redactions = signal<Redaction[]>([])
  readonly history = new History<ImageSnapshot>(12)
  readonly historyVersion = signal(0)
  /** Temporary pixels shown instead of `raster` (live Adjust Color preview). */
  readonly preview = signal<Raster | null>(null)

  constructor(probe: Probe, notice: string | null = null) {
    super(probe.name, probe.path)
    this.probe = probe
    this.pageCount = signal(Math.max(1, probe.pages))
    this.notice = notice
    if (this.pageCount.value <= 1) this.sidebar.value = 'none'
  }

  /** Multi-page images (TIFF, CBZ) and EPS previews are view-only for now. */
  get editable(): boolean {
    return this.pageCount.peek() <= 1 && !this.notice
  }

  get writableInPlace(): boolean {
    const ext = /\.([^.\\/]+)$/.exec(this.path.peek() ?? '')?.[1]?.toLowerCase() ?? ''
    return WRITABLE_IMAGE_EXTS.includes(ext)
  }

  private queue: Promise<unknown> = Promise.resolve()
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private snapshot(): ImageSnapshot {
    return { raster: this.raster.peek(), markup: this.markup.peek(), redactions: this.redactions.peek() }
  }

  /** Replaces the pixels as one undoable step. `op` must not mutate its input. */
  async applyPixels(label: string, op: (r: Raster) => Promise<Raster> | Raster): Promise<void> {
    return this.exclusive(async () => {
      const current = this.raster.peek()
      if (!current) throw new Error('image not loaded')
      const next = await op(current)
      this.history.push(label, this.snapshot())
      this.raster.value = next
      this.natural.value = { width: next.width, height: next.height }
      this.historyVersion.value++
      this.dirty.value = true
    })
  }

  edit(label: string, change: { markup?: Markup[]; redactions?: Redaction[] }): void {
    this.history.push(label, this.snapshot())
    if (change.markup) this.markup.value = change.markup
    if (change.redactions) this.redactions.value = change.redactions
    this.historyVersion.value++
    this.dirty.value = true
  }

  private restore(s: ImageSnapshot): void {
    this.raster.value = s.raster
    if (s.raster) this.natural.value = { width: s.raster.width, height: s.raster.height }
    this.markup.value = s.markup
    this.redactions.value = s.redactions
  }

  async undo(): Promise<void> {
    const e = this.history.undo(this.snapshot())
    if (e) {
      this.restore(e.state)
      this.historyVersion.value++
      this.dirty.value = true
    }
  }

  async redo(): Promise<void> {
    const e = this.history.redo(this.snapshot())
    if (e) {
      this.restore(e.state)
      this.historyVersion.value++
      this.dirty.value = true
    }
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
  const path = doc.path.peek() ?? (doc.kind === 'pdf' ? doc.convertedFrom : null)
  if (path) void releaseFile(path)
  const next = list.filter((d) => d.id !== id)
  docs.value = next
  if (activeId.value === id) activeId.value = next[Math.min(idx, next.length - 1)]?.id ?? null
}

export function findByPath(path: string): Doc | undefined {
  const norm = path.toLowerCase()
  return docs.value.find((d) => d.path.value?.toLowerCase() === norm)
}

export { PasswordRequired }
