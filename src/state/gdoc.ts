/**
 * Opening, saving, creating and exporting Glance documents (.gdoc, ADR 0018). The zip,
 * PDF and Word code loads only when it is used, so it stays off the startup path.
 */
import { signal } from '@preact/signals'
import * as platform from '../platform'
import { addDoc, GDoc } from './documents'
import * as versions from './versions'
import { findLook, loadLook, loadLookWithFonts } from './docLooks'
import { toast, withBusy } from './ui'
import { msg, t } from '../i18n'
import type { Doc as DocData } from '../core/doc/model'
import { DocError, type DocApplyResult, type DocOp } from '../core/doc/ops'
import { layoutDoc, type PageLayout } from '../core/doc/layout'
import { measureDocText } from '../doc/measure'
import { boardDoc, pageDoc, translateBlocks } from '../core/doc/template'

const docFile = () => import('../core/doc/file')

export const GDOC_FILTER = () => [{ name: msg('Glance document'), extensions: ['gdoc'] }]

export async function openGdoc(probe: platform.Probe): Promise<GDoc> {
  const { readDoc } = await docFile()
  const { doc, media, warnings } = await readDoc(await platform.readFile(probe.path), loadLook)
  const g = new GDoc(probe.name, probe.path)
  g.doc.value = doc
  for (const [path, bytes] of media) g.media.set(path, bytes)
  addDoc(g)
  if (warnings.length) toast(t('{count, plural, one {# part of this document couldn’t be read and was left out.} other {# parts of this document couldn’t be read and were left out.}}', { count: warnings.length }), 'error')
  return g
}

/** A new, unsaved document from a starting document (a template or an AI app's) . */
export function newGdoc(name: string, start: DocData, media?: Map<string, Uint8Array>): GDoc {
  const g = new GDoc(`${name}.gdoc`, null)
  g.doc.value = start
  for (const [path, bytes] of media ?? []) g.media.set(path, bytes)
  addDoc(g)
  void loadLook(start.look)
  return g
}

/**
 * A template as a new document: every page of it, or for a pack one page (a pack's
 * pages are separate documents). Empty texts keep the template's sample as a hint.
 */
export async function templateGdoc(look: string, design?: string): Promise<DocData | null> {
  const board = await loadLook(look)
  if (!board) return null
  const tr = (s: string) => (/[{}]/.test(s) ? s : t(s))
  return design ? pageDoc(board, design, tr) : boardDoc(board, tr)
}

/** A template with its text cleared, for "Make it about…": the boxes show their hints. */
export function blankOf(doc: DocData): DocData {
  return { ...doc, sections: doc.sections.map((s) => ({ ...s, texts: {}, tables: Object.fromEntries(Object.keys(s.tables).map((k) => [k, []])), ...(s.blocks ? { blocks: [] } : {}) })) }
}

export { translateBlocks }

export async function gdocBytes(g: GDoc): Promise<Uint8Array> {
  const { writeDoc } = await docFile()
  return writeDoc({ doc: g.doc.peek(), media: g.media })
}

export async function saveGdoc(g: GDoc, opts: { auto?: boolean } = {}): Promise<void> {
  const path = g.path.peek()
  if (!path) return opts.auto ? undefined : saveGdocAs(g)
  const disk = await versions.checkDisk(g, path, !!opts.auto)
  if (disk === 'cancel') return
  if (disk === 'copy') return saveGdocAs(g)
  await versions.beforeOverwrite(g, path)
  const run = async () => {
    const bytes = await gdocBytes(g)
    await platform.writeFile(path, bytes)
    return bytes
  }
  const bytes = opts.auto ? await run() : await withBusy(t('Saving…'), run)
  g.dirty.value = false
  await versions.rememberStamp(g)
  await versions.afterWrite(path, opts.auto ? msg('Autosaved') : msg('Saved'), bytes)
  if (!opts.auto) toast(t('Saved'))
}

export async function saveGdocAs(g: GDoc): Promise<void> {
  const base = g.name.peek().replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base}.gdoc`, GDOC_FILTER())
  if (!target) return
  await versions.afterWrite(target, msg('Before replacing')).catch(() => undefined)
  const bytes = await withBusy(t('Saving…'), async () => {
    const b = await gdocBytes(g)
    await platform.writeFile(target, b)
    return b
  })
  const old = g.path.peek()
  g.path.value = target
  g.name.value = platform.baseName(target)
  g.dirty.value = false
  if (old) void platform.releaseFile(old)
  void platform.claimFile(target)
  await versions.rememberStamp(g)
  await versions.afterWrite(target, msg('Saved'), bytes)
  toast(t('Saved'))
}

/** Applies `ops` as one undo step, saying why in a toast when they can't apply. */
export function changeGdoc(g: GDoc, label: string, ops: DocOp[]): DocApplyResult | null {
  try {
    return g.apply(label, ops)
  } catch (e) {
    if (!(e instanceof DocError)) throw e
    toast(t('Couldn’t change the document: {error}', { error: e.message }), 'error')
    return null
  }
}

/** Pictures' shapes, read once each, so pages lay out at the pictures' own proportions. */
const aspects = new WeakMap<Uint8Array, number>()
export function aspectOf(g: GDoc) {
  return (src: string): number | undefined => {
    const bytes = g.media.get(src)
    return bytes ? aspects.get(bytes) : undefined
  }
}

/** Reads the shapes of pictures not read yet, then bumps mediaVersion so pages lay out again. */
export async function readAspects(g: GDoc): Promise<void> {
  let changed = false
  for (const [src, bytes] of g.media) {
    if (aspects.has(bytes)) continue
    try {
      const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]))
      aspects.set(bytes, bmp.width / Math.max(1, bmp.height))
      bmp.close()
      changed = true
    } catch {
      aspects.set(bytes, 1.5)
      void src
    }
  }
  if (changed) g.mediaVersion.value++
}

/** The document's pages as they are drawn now. */
export function pagesOf(g: GDoc): PageLayout[] {
  const doc = g.doc.peek()
  return layoutDoc(doc, findLook(doc.look), { measure: measureDocText, aspect: aspectOf(g) })
}

// ---------------------------------------------------------------------------
// Exports: PDF, Word and pictures. The engines load only when used.

export type GdocExport = 'pdf' | 'docx' | 'png'

async function readyPages(g: GDoc): Promise<PageLayout[]> {
  await loadLookWithFonts(g.doc.peek().look)
  await readAspects(g)
  return pagesOf(g)
}

const titleOf = (g: GDoc) => {
  const d = g.doc.peek()
  for (const s of d.sections) {
    const h = s.blocks?.find((b) => b.type === 'heading')
    if (h && h.type === 'heading') return h.runs.map((r) => r.text).join('').trim()
    const first = Object.values(s.texts).find((v) => v.trim())
    if (first) return first.trim().split('\n')[0]
  }
  return g.name.peek().replace(/\.[^.]+$/, '')
}

export async function gdocExportBytes(g: GDoc, format: 'pdf' | 'docx'): Promise<Uint8Array> {
  const pages = await readyPages(g)
  const board = findLook(g.doc.peek().look)
  const { pageCanvas, canvasPng } = await import('../doc/raster')
  if (format === 'pdf') {
    const { fontFile, hasItalic } = await import('../deck/fonts')
    const { deckFontBytes } = await import('./deck')
    const file = async (family: string, italic: boolean) => {
      const bytes = await fontFile(family, italic)
      return bytes ? { bytes, italic: italic && hasItalic(family) } : null
    }
    const { docToPdf } = await import('../doc/exportPdf')
    return docToPdf({ pages, art: async (p) => canvasPng(await pageCanvas(p, board, g.media, 595 * 3, true)), fonts: { regular: await deckFontBytes(), file }, title: titleOf(g) })
  }
  const { docToDocx } = await import('../doc/exportDocx')
  const firsts = new Map(pages.filter((p) => p.first).map((p) => [p.section, p]))
  return docToDocx({
    doc: g.doc.peek(),
    board,
    media: g.media,
    aspect: aspectOf(g),
    title: titleOf(g),
    // The page's art with nothing of the document on it: only the design's drawing.
    art: async (s) => {
      const p = firsts.get(s.id)
      const draw = async (page: PageLayout | undefined) => (page?.design?.art ? canvasPng(await pageCanvas({ ...page, items: [] }, board, g.media, 595 * 2)) : null)
      const next = pages.find((x) => x.section === s.id && !x.first)
      return { first: await draw(p), ...(next && next.design?.id !== p?.design?.id ? { rest: await draw(next) } : {}) }
    }
  })
}

/** PNG of every page, 1240 pixels wide (150 dpi on A4), named "<doc> 01.png" and so on. */
export async function gdocPictures(g: GDoc, first: string): Promise<number> {
  const pages = await readyPages(g)
  const board = findLook(g.doc.peek().look)
  const { pageCanvas, canvasPng } = await import('../doc/raster')
  const stem = first.replace(/(\s*\d+)?\.png$/i, '')
  for (const [i, p] of pages.entries()) {
    const path = pages.length === 1 ? `${stem}.png` : `${stem} ${String(i + 1).padStart(2, '0')}.png`
    await platform.writeFile(path, await canvasPng(await pageCanvas(p, board, g.media, 1240)))
  }
  return pages.length
}

export async function exportGdoc(g: GDoc, format: GdocExport): Promise<void> {
  const base = g.name.peek().replace(/\.[^.]+$/, '')
  const filter = { pdf: { name: msg('PDF document'), extensions: ['pdf'] }, docx: { name: msg('Word document'), extensions: ['docx'] }, png: { name: msg('PNG pictures'), extensions: ['png'] } }[format]
  const target = await platform.saveDialog(`${base}.${format}`, [filter])
  if (!target) return
  try {
    if (format === 'png') {
      const n = await withBusy(t('Exporting…'), () => gdocPictures(g, target))
      toast(t('{count, plural, one {Exported # page as a picture} other {Exported # pages as pictures}}', { count: n }))
      return
    }
    const bytes = await withBusy(t('Exporting…'), () => gdocExportBytes(g, format))
    await platform.writeFile(target, bytes)
    toast(t('Exported {file}', { file: platform.baseName(target) }))
  } catch (e) {
    console.error(e)
    toast(t('Couldn’t export: {error}', { error: String((e as Error).message ?? e) }), 'error')
  }
}

// ---------------------------------------------------------------------------
// Editing: the editor's toolbar, menus and shortcuts come through here.

/** A block the editor should start typing in once it is drawn (a new heading, paragraph or list). */
export const editRequest = signal<string | null>(null)

/** Adds a block after the picked one (or at the end of the section on screen). */
export function addBlock(g: GDoc, block: Record<string, unknown>, label = msg('Add Block')): string | null {
  const sel = g.selection.peek()
  const doc = g.doc.peek()
  const section = sel?.section ?? [...doc.sections].reverse().find((s) => s.blocks)?.id
  const s = doc.sections.find((x) => x.id === section)
  if (!s?.blocks) {
    toast(t('Pick a page with flowing text first.'), 'error')
    return null
  }
  const after = sel?.block && s.blocks.some((b) => b.id === sel.block) ? sel.block : undefined
  const r = changeGdoc(g, label, [{ op: 'addBlocks', section: s.id, ...(after ? { after } : {}), blocks: [block] }])
  if (!r) return null
  g.selection.value = { section: s.id, block: r.added[0] }
  if (['heading', 'paragraph', 'list', 'quote'].includes(String(block.type))) editRequest.value = r.added[0]
  return r.added[0]
}

export function deleteBlock(g: GDoc): void {
  const sel = g.selection.peek()
  if (sel?.block && changeGdoc(g, msg('Delete Block'), [{ op: 'deleteBlocks', ids: [sel.block] }])) g.selection.value = { section: sel.section }
}

/** Moves the picked block one place up or down within its list. */
export function nudgeBlock(g: GDoc, dir: -1 | 1): void {
  const sel = g.selection.peek()
  const s = g.doc.peek().sections.find((x) => x.id === sel?.section)
  const list = s?.blocks
  if (!sel?.block || !list) return
  const i = list.findIndex((b) => b.id === sel.block)
  if (i < 0) return
  if (dir < 0 && i > 0) changeGdoc(g, msg('Move Block'), [{ op: 'moveBlocks', ids: [sel.block], after: i - 2 >= 0 ? list[i - 2].id : null, section: s.id }])
  if (dir > 0 && i < list.length - 1) changeGdoc(g, msg('Move Block'), [{ op: 'moveBlocks', ids: [sel.block], after: list[i + 1].id }])
}

export function addPage(g: GDoc, design: string): void {
  const sel = g.selection.peek()
  const r = changeGdoc(g, msg('Add Page'), [{ op: 'addSection', design, ...(sel ? { after: sel.section } : {}) }])
  if (r) g.selection.value = { section: r.added[0] }
}

export function deletePage(g: GDoc): void {
  const sel = g.selection.peek()
  if (sel && g.doc.peek().sections.length > 1 && changeGdoc(g, msg('Delete Page'), [{ op: 'deleteSection', ids: [sel.section] }])) g.selection.value = null
}

export async function setLook(g: GDoc, look: string): Promise<void> {
  await loadLook(look)
  const r = changeGdoc(g, msg('Change Look'), [{ op: 'setLook', look }])
  if (r?.dropped.length) toast(t('{count, plural, one {# part didn’t fit the new look. Undo to get it back.} other {# parts didn’t fit the new look. Undo to get them back.}}', { count: r.dropped.length }))
}
