/** User-level operations shared by menus, toolbar, shortcuts and drag-and-drop. */
import * as platform from '../platform'
import type { Probe } from '../platform'
import type * as PageOps from '../core/pageOps'
import { MARKER_KEY, newId, pageMaps, type Markup, type Rect } from '../core/markup'
import { annotations, cleanup, pageOps, redact } from './pdfModules'
import { openPdf } from '../pdf/engine'
import { PasswordRequired } from '../pdf/engine'
import {
  activeDoc,
  activeId,
  addDoc,
  docs,
  findByPath,
  ImageDoc,
  ModelDoc,
  PreviewDoc,
  NoticeDoc,
  PdfDoc,
  removeDoc,
  type Doc
} from './documents'
import { alertDialog, promptText, showDialog, toast, withBusy } from './ui'
import { applyImageRedactions, editableImage, rotateImage, saveImage, saveImageAs } from './imageActions'
import * as versions from './versions'
import { flushAutosave } from './autosave'
import { msg, t } from '../i18n'
import { mayHaveSignatures } from '../core/signatureStatus'
import { PREVIEWS } from '../core/previews'

const GS_INSTALL = 'winget install ArtifexSoftware.GhostScript'

export const OPEN_FILTERS: platform.FileFilter[] = [
  {
    name: msg('All supported files'),
    extensions: [
      'pdf', 'ai', 'ps', 'eps', 'epsf', 'xps', 'oxps', 'cbz',
      'jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'bmp', 'dib', 'ico', 'svg', 'avif',
      'tif', 'tiff', 'heic', 'heif', 'hif', 'jp2', 'j2k', 'jpf', 'jpx', 'jxl', 'jxr', 'wdp', 'hdp',
      'exr', 'hdr', 'tga', 'dds', 'qoi', 'ppm', 'pgm', 'pbm', 'pam', 'pnm', 'icns', 'psd', 'psb',
      'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'raw', 'dng', 'pef',
      'srw', 'x3f', 'erf', 'mef', 'mos', 'mrw', 'kdc', 'dcr', '3fr', 'fff', 'iiq', 'rwl', 'gpr',
      'glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'usdz', 'usda', 'usdc', 'dae', '3mf', '3ds',
      ...PREVIEWS
    ]
  },
  { name: msg('PDF documents'), extensions: ['pdf', 'ai'] },
  { name: msg('Word, PowerPoint and Excel files'), extensions: PREVIEWS },
  { name: msg('All files'), extensions: ['*'] }
]

async function loadPdfDoc(doc: PdfDoc, bytes: Uint8Array): Promise<boolean> {
  for (;;) {
    try {
      await doc.load(bytes)
      return true
    } catch (e) {
      if (!(e instanceof PasswordRequired)) throw e
      const pw = await promptText(
        e.incorrect ? t('Incorrect password') : t('Password required'),
        t('“{file}” is protected. Enter its password to open it.', { file: doc.name.value }),
        { password: true, ok: t('Open') }
      )
      if (pw === null) return false
      doc.password = pw
      doc.encrypted = true
    }
  }
}

/** Makes markup Glance saved earlier editable again (only loads pdf-lib when present). */
async function importMarkup(doc: PdfDoc): Promise<void> {
  const proxy = doc.proxy.peek()
  // Pulling markup out rewrites the file, which would break its signatures.
  if (!proxy || doc.encrypted || mayHaveSignatures(doc.bytes)) return
  const meta = await proxy.getMetadata().catch(() => null)
  // PDF.js returns custom Info entries as a Map (older versions: a plain object).
  const custom = (meta?.info as { Custom?: Map<string, unknown> | Record<string, unknown> } | undefined)?.Custom
  const marked = custom instanceof Map ? custom.get(MARKER_KEY) : custom?.[MARKER_KEY]
  if (!marked) return
  const { extractMarkup } = await annotations()
  const { bytes, markup } = await extractMarkup(doc.bytes)
  await doc.load(bytes)
  doc.markup.value = markup
}

/** The document as it should be written: form values and markup included. */
export async function serialize(doc: PdfDoc): Promise<Uint8Array> {
  return doc.exclusive(async () => {
    const bytes = await doc.currentBytes()
    const markup = doc.markup.peek()
    // writeMarkup rewrites the whole file anyway; otherwise compact once appended
    // updates (other apps, form filling) pass a quarter of the file (ADR 0007).
    if (markup.length) return (await annotations()).writeMarkup(bytes, markup, { loadFont: platform.fontBytes })
    // Compacting drops the revisions certificate signatures cover, which breaks them.
    if (doc.password || mayHaveSignatures(bytes)) return bytes
    const c = await cleanup()
    return c.appendedShare(bytes) > c.COMPACT_THRESHOLD ? c.compact(bytes) : bytes
  })
}

async function openOne(path: string): Promise<Doc | null> {
  const existing = findByPath(path)
  if (existing) {
    activeId.value = existing.id
    return existing
  }
  // The same file is only ever open in one window: hand over to the window that has it.
  const owner = await platform.claimFile(path)
  if (owner) {
    await platform.focusFile(owner, path).catch(() => undefined)
    return null
  }
  const doc = await openFresh(path).catch((e) => {
    void platform.releaseFile(path)
    throw e
  })
  if (!doc) void platform.releaseFile(path)
  else void versions.rememberStamp(doc)
  return doc
}

async function openFresh(path: string): Promise<Doc | null> {
  const probe = await platform.probe(path)
  switch (probe.kind) {
    case 'pdf': {
      const doc = new PdfDoc(probe.name, probe.path)
      if (!(await loadPdfDoc(doc, await platform.readFile(path)))) return null
      await importMarkup(doc)
      addDoc(doc)
      return doc
    }
    case 'postscript':
      return openPostscript(probe)
    case 'image':
    case 'archive': {
      const doc = new ImageDoc(probe)
      addDoc(doc)
      return doc
    }
    case 'xps': {
      // Pages come from the Windows XPS rasterizer (view-only, like multi-page TIFF).
      if (probe.pages < 1) return notice(probe, t('Glance can’t show this XPS document'), t('XPS pages are rendered by Windows. The file may be damaged, or this system has no XPS support.'))
      const doc = new ImageDoc(probe)
      addDoc(doc)
      return doc
    }
    case 'model': {
      const doc = new ModelDoc(probe)
      addDoc(doc)
      return doc
    }
    case 'preview': {
      const doc = new PreviewDoc(probe)
      addDoc(doc)
      return doc
    }
    default:
      return notice(probe, t('Glance can’t open this file'), t('This file type isn’t supported. If you think it should be, please open an issue on GitHub.'))
  }
}

function notice(probe: Probe, title: string, message: string, actions: NoticeDoc['actions'] = []): Doc {
  // Whatever Glance can't show, another installed app probably can.
  const all = platform.isTauri ? [...actions, { label: t('Open with another app…'), run: () => void platform.openWith(probe.path).catch((e) => toast(String(e), 'error')) }] : actions
  const doc = new NoticeDoc(probe.name, probe.path, title, message, all)
  addDoc(doc)
  return doc
}

async function openPostscript(probe: Probe): Promise<Doc | null> {
  try {
    const pdfPath = await withBusy(t('Converting PostScript…'), () => platform.convertPostscript(probe.path))
    const doc = new PdfDoc(probe.name, null, probe.path)
    if (!(await loadPdfDoc(doc, await platform.readFile(pdfPath)))) return null
    addDoc(doc)
    return doc
  } catch (e) {
    const missing = String(e).includes('ghostscript-missing')
    const actions = [
      { label: t('Copy install command'), run: () => void navigator.clipboard.writeText(GS_INSTALL).then(() => toast(t('Command copied. Paste it into Terminal.'))) },
      { label: t('Ghostscript website'), run: () => void platform.openUrl('https://ghostscript.com/releases/gsdnld.html') }
    ]
    const why = missing
      ? t('PostScript needs Ghostscript, a free program Glance can’t include for licensing reasons. Install it once and Glance will use it automatically.')
      : t('Ghostscript couldn’t convert this file: {error}', { error: String(e) })
    if (/\.(eps|epsf|epsi)$/i.test(probe.path)) {
      // EPS files usually carry a preview image we can show meanwhile.
      const doc = new ImageDoc({ ...probe, kind: 'image', browserNative: false, pages: 1 }, t('Showing the embedded preview. {reason}', { reason: why }))
      addDoc(doc)
      return doc
    }
    return notice(probe, t('Ghostscript is needed for PostScript'), `${why}\n\n${GS_INSTALL}`, actions)
  }
}

export async function openFiles(paths: string[], opts: { quiet?: boolean } = {}): Promise<void> {
  for (const p of paths) {
    try {
      await openOne(p)
    } catch (e) {
      console.error(e)
      if (!opts.quiet) toast(t('Couldn’t open {file}: {error}', { file: platform.baseName(p), error: String((e as Error).message ?? e) }), 'error')
    }
  }
}

export async function openWithDialog(): Promise<void> {
  const paths = await platform.openDialog({ multiple: true, filters: OPEN_FILTERS })
  await openFiles(paths)
}

// ---------------------------------------------------------------------------
// Saving (explicit; autosave arrives with the Versions milestone, ADR 0004)

/** Pending redactions are never written silently: apply them, or keep them out. */
async function resolvePendingRedactions(doc: PdfDoc): Promise<boolean> {
  const n = doc.redactions.peek().length
  if (!n) return true
  const choice = await showDialog<'apply' | 'skip' | 'cancel'>({
    title: t('Apply redactions before saving?'),
    body: t('{count, plural, one {# marked area is} other {# marked areas are}} not redacted yet. Until you apply redactions, the content underneath is still in the file.', { count: n }),
    buttons: [
      { label: t('Cancel'), value: 'cancel' },
      { label: t('Save without applying'), value: 'skip' },
      { label: t('Apply and save'), value: 'apply', primary: true }
    ]
  })
  if (choice === 'apply') return applyRedactions(doc, false)
  return choice === 'skip'
}

export async function save(doc: Doc | null = activeDoc.value, opts: { auto?: boolean } = {}): Promise<void> {
  if (doc instanceof ImageDoc) return saveImage(doc, opts)
  if (!doc || doc.kind !== 'pdf') return
  const path = doc.path.value
  if (!path) return opts.auto ? undefined : saveAs(doc)
  // Autosave never asks questions: it waits while redactions are pending.
  if (opts.auto && doc.redactions.peek().length) return
  if (!opts.auto && !(await resolvePendingRedactions(doc))) return
  const disk = await versions.checkDisk(doc, path, !!opts.auto)
  if (disk === 'cancel') return
  if (disk === 'copy') return saveAs(doc)
  await versions.beforeOverwrite(doc, path)
  const run = async () => {
    const bytes = await serialize(doc)
    await platform.writeFile(path, bytes)
    return bytes
  }
  const bytes = opts.auto ? await run() : await withBusy(t('Saving…'), run)
  doc.dirty.value = false
  await versions.rememberStamp(doc)
  await versions.afterWrite(path, opts.auto ? msg('Autosaved') : msg('Saved'), bytes)
  if (!opts.auto) toast(t('Saved'))
  await offerToDeleteRedactedVersions(doc, path)
}

/**
 * After redactions reach the file, earlier versions still contain the removed
 * content (ADR 0006): say so and offer to delete them. Never mandatory.
 */
export async function offerToDeleteRedactedVersions(doc: Doc, path: string): Promise<void> {
  if (!versions.redactedDocs.has(doc)) return
  versions.redactedDocs.delete(doc)
  const older = (await platform.historyList(path).catch(() => [])).slice(1)
  if (!older.length) return
  const choice = await showDialog<'keep' | 'delete'>({
    title: t('Earlier versions still contain the redacted content'),
    body: t('“{file}” has {count, plural, one {# earlier version} other {# earlier versions}} in Glance’s version history, made before you redacted it. Anyone with access to this PC’s account could restore them.', { file: doc.name.peek(), count: older.length }),
    buttons: [
      { label: t('Keep versions'), value: 'keep' },
      { label: t('Delete earlier versions'), value: 'delete', primary: true }
    ]
  })
  if (choice === 'delete') {
    const n = await platform.historyDelete(path, older.map((v) => v.id))
    toast(t('{count, plural, one {Deleted # earlier version} other {Deleted # earlier versions}}', { count: n }))
  }
}

export async function saveAs(doc: Doc | null = activeDoc.value): Promise<void> {
  if (doc instanceof ImageDoc) return saveImageAs(doc)
  if (!doc || doc.kind !== 'pdf') return
  const base = doc.name.value.replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base}.pdf`, [{ name: msg('PDF document'), extensions: ['pdf'] }])
  if (!target) return
  if (!(await resolvePendingRedactions(doc))) return
  // Replacing another file: keep what was there as a version.
  await versions.afterWrite(target, msg('Before replacing')).catch(() => undefined)
  const bytes = await withBusy(t('Saving…'), async () => {
    const b = await serialize(doc)
    await platform.writeFile(target, b)
    return b
  })
  const old = doc.path.value
  doc.path.value = target
  doc.name.value = platform.baseName(target)
  doc.dirty.value = false
  if (old) void platform.releaseFile(old)
  void platform.claimFile(target)
  await versions.rememberStamp(doc)
  await versions.afterWrite(target, msg('Saved'), bytes)
  toast(t('Saved'))
  await offerToDeleteRedactedVersions(doc, target)
}

/** Asks to save or discard unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(doc: Doc): Promise<boolean> {
  if (!doc.dirty.peek()) return true
  activeId.value = doc.id
  const pending = doc.kind === 'pdf' || doc.kind === 'image' ? doc.redactions.peek().length : 0
  const choice = await showDialog<'save' | 'discard' | 'cancel'>({
    title: t('Save changes to “{file}”?', { file: doc.name.value }),
    body: pending
      ? t('{count, plural, one {# area is} other {# areas are}} marked for redaction but not yet applied. If you don’t save, the redactions and your other changes will be lost.', { count: pending })
      : t('Your changes will be lost if you don’t save them.'),
    buttons: [
      { label: t('Cancel'), value: 'cancel' },
      { label: t('Don’t save'), value: 'discard' },
      { label: t('Save'), value: 'save', primary: true }
    ]
  })
  if (choice === null || choice === 'cancel') return false
  if (choice === 'save') {
    try {
      await save(doc)
    } catch (e) {
      await alertDialog(t('Couldn’t save'), String(e))
      return false
    }
    return !doc.dirty.peek()
  }
  return true
}

export async function closeDoc(doc: Doc | null = activeDoc.value): Promise<void> {
  if (!doc) return
  await flushAutosave(doc)
  if (await confirmDiscard(doc)) removeDoc(doc.id)
}

/** Before the window closes: every edited document is saved or discarded first. */
export async function confirmCloseWindow(): Promise<boolean> {
  await flushAutosave()
  for (const doc of docs.peek().filter((d) => d.dirty.peek())) {
    if (!(await confirmDiscard(doc))) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Page management

function selectedOrCurrent(doc: PdfDoc): number[] {
  const sel = doc.selection.value
  return sel.length ? [...sel].sort((a, b) => a - b) : [doc.current.value]
}

/** `label` names the edit (undo history, busy indicator): English, marked with msg(). */
async function run(doc: PdfDoc, label: string, op: Parameters<PdfDoc['apply']>[1], pages?: Parameters<PdfDoc['apply']>[2]): Promise<boolean> {
  try {
    await withBusy(t('{action}…', { action: t(label) }), () => doc.apply(label, op, pages))
    return true
  } catch (e) {
    toast((e as Error).message ?? String(e), 'error')
    return false
  }
}

export async function rotatePages(delta: 90 | -90, doc = activeDoc.value): Promise<void> {
  const img = editableImage(doc)
  if (img) return rotateImage(img, delta > 0)
  if (doc?.kind === 'image') {
    doc.rotation.value = (doc.rotation.value + delta + 360) % 360
    return
  }
  if (doc?.kind !== 'pdf') return
  const pages = selectedOrCurrent(doc)
  await run(doc, delta > 0 ? msg('Rotate Right') : msg('Rotate Left'), async (b) => (await pageOps()).rotatePages(b, pages, delta))
}

export async function deletePages(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const pages = selectedOrCurrent(doc)
  if (await run(doc, pages.length > 1 ? msg('Delete Pages') : msg('Delete Page'), async (b) => (await pageOps()).deletePages(b, pages), pageMaps.delete(pages))) {
    doc.selection.value = []
  }
}

export async function insertBlankPage(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const at = Math.max(...selectedOrCurrent(doc)) + 1
  if (await run(doc, msg('Insert Blank Page'), async (b) => (await pageOps()).insertBlankPage(b, at), pageMaps.insert(at, 1))) {
    doc.selection.value = [at]
    doc.goTo(at)
  }
}

export async function movePages(doc: PdfDoc, pages: number[], to: number): Promise<void> {
  const order = (await pageOps()).computeMoveOrder(doc.pageCount.value, pages, to)
  if (order.every((v, i) => v === i)) return
  if (await run(doc, msg('Move Pages'), async (b) => (await pageOps()).reorderPages(b, order), pageMaps.reorder(order))) {
    const moved = new Set(pages)
    doc.selection.value = order.flatMap((src, i) => (moved.has(src) ? [i] : []))
  }
}

/** Converts any image Glance can display into PNG/JPEG bytes pdf-lib can embed. */
export async function imageForPdf(probe: Probe): Promise<PageOps.ImageInput> {
  if (/\.(jpe?g|jfif)$/i.test(probe.path)) return { bytes: await platform.readFile(probe.path), type: 'jpg' }
  if (/\.png$/i.test(probe.path)) return { bytes: await platform.readFile(probe.path), type: 'png' }
  const res = await fetch(await platform.imageUrlAsync(probe))
  const bitmap = await createImageBitmap(await res.blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' }
}

/** Inserts files (PDF pages or images) into a PDF at a page position. */
export async function insertFiles(doc: PdfDoc, paths: string[], at: number): Promise<void> {
  const label = paths.length > 1 ? msg('Insert Files') : msg('Insert Pages')
  await run(doc, label, async (bytes) => {
    let out = bytes
    let pos = at
    for (const path of paths) {
      const probe = await platform.probe(path)
      if (probe.kind === 'pdf') {
        const src = await platform.readFile(path)
        const n = await (await pageOps()).pageCount(src)
        out = await (await pageOps()).insertPdfPages(out, src, pos)
        pos += n
      } else if (probe.kind === 'image') {
        out = await (await pageOps()).insertImagePages(out, [await imageForPdf(probe)], pos)
        pos += 1
      } else {
        throw new Error(t('{file} can’t be inserted into a PDF.', { file: probe.name }))
      }
    }
    // Inserted PDFs may carry Glance markup; keep it editable.
    const extracted = await (await annotations()).extractMarkup(out)
    return { bytes: extracted.bytes, markup: freshIds(extracted.markup), pages: pageMaps.insert(at, pos - at) }
  })
}

/**
 * Explorer → Combine into PDF: the files' pages and images, in name order, as a new PDF
 * next to the first file, which then opens. Returns the new file's path.
 */
export async function combineIntoPdf(paths: string[]): Promise<string | null> {
  const { combineOrder, combinedName } = await import('../core/explorer')
  const ordered = combineOrder(paths)
  if (!ordered.length) return null
  const ops = await pageOps()
  const skipped: string[] = []
  const bytes = await withBusy(t('Combining into PDF…'), async () => {
    let out: Uint8Array | null = null
    for (const path of ordered) {
      try {
        const probe = await platform.probe(path)
        if (probe.kind === 'pdf') {
          const src = await platform.readFile(path)
          out = out ? await ops.insertPdfPages(out, src, await ops.pageCount(out)) : src
        } else if (probe.kind === 'image') {
          const image = await imageForPdf(probe)
          out = out ? await ops.insertImagePages(out, [image], await ops.pageCount(out)) : await ops.pdfFromImages([image])
        } else {
          skipped.push(platform.baseName(path))
        }
      } catch (e) {
        console.error(e)
        skipped.push(platform.baseName(path))
      }
    }
    return out
  })
  if (!bytes) {
    await alertDialog(t('Couldn’t combine into PDF'), t('None of these files can be added to a PDF: {files}', { files: skipped.join(', ') }))
    return null
  }
  const target = await platform.uniquePath(platform.dirName(ordered[0]), combinedName(ordered[0]))
  await platform.writeFile(target, bytes)
  await openFiles([target])
  toast(skipped.length ? t('Created {file}. Skipped {skipped}.', { file: platform.baseName(target), skipped: skipped.join(', ') }) : t('Created {file}', { file: platform.baseName(target) }))
  return target
}

export async function insertFromFileDialog(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const paths = await platform.openDialog({ multiple: true, filters: OPEN_FILTERS })
  if (paths.length) await insertFiles(doc, paths, Math.max(...selectedOrCurrent(doc)) + 1)
}

/** Copied pages bring copies of their markup; new ids keep them distinct from the originals. */
function freshIds(markup: Markup[]): Markup[] {
  return markup.map((m) => ({ ...m, id: newId() }))
}

/** Copies (or moves, with Shift) pages from one PDF into another. */
export async function transferPages(src: PdfDoc, pages: number[], dst: PdfDoc, at: number, move: boolean): Promise<void> {
  const sorted = [...pages].sort((a, b) => a - b)
  // Serialize so the pages' markup travels with them (and becomes editable in dst).
  const bytes = await serialize(src)
  const ok = await run(dst, move ? msg('Move Pages') : msg('Copy Pages'), async (b) => {
    const merged = await (await pageOps()).insertPdfPages(b, bytes, at, sorted)
    const extracted = await (await annotations()).extractMarkup(merged)
    return { bytes: extracted.bytes, markup: freshIds(extracted.markup), pages: pageMaps.insert(at, sorted.length) }
  })
  if (ok && move && src !== dst) {
    if (sorted.length >= src.pageCount.value) {
      toast(t('Pages copied. The source keeps its last page because a PDF needs at least one.'))
      return
    }
    await run(src, msg('Move Pages'), async (b) => (await pageOps()).deletePages(b, sorted), pageMaps.delete(sorted))
    src.selection.value = []
  }
}

/** "page 3" / "pages 2-5", for file names and messages. */
function pagesLabel(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b).map((p) => p + 1)
  return sorted.length === 1 ? t('page {page}', { page: sorted[0] }) : t('pages {first}-{last}', { first: sorted[0], last: sorted.at(-1)! })
}

/** Drag Out: writes the pages to a temporary PDF and hands it to the OS drag loop. */
export async function dragOutPages(doc: PdfDoc, pages: number[], icon: HTMLCanvasElement | null): Promise<void> {
  const bytes = await (await pageOps()).extractPages(await serialize(doc), [...pages].sort((a, b) => a - b))
  const base = doc.name.value.replace(/\.[^.]+$/, '')
  const file = await platform.writeTemp(`${base} (${pagesLabel(pages)}).pdf`, bytes)
  let iconPath = file
  if (icon) {
    const blob = await new Promise<Blob | null>((r) => icon.toBlob(r, 'image/png'))
    if (blob) iconPath = await platform.writeTemp('drag-icon.png', new Uint8Array(await blob.arrayBuffer()))
  }
  await platform.dragOut(file, iconPath)
}

export async function exportSelectedPages(doc = activeDoc.value, opts: { protect?: import('../core/protect').ProtectOptions } = {}): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const pages = selectedOrCurrent(doc)
  const all = pages.length === doc.pageCount.value
  const base = doc.name.value.replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(all ? `${base}.pdf` : `${base} (${pagesLabel(pages)}).pdf`, [{ name: msg('PDF document'), extensions: ['pdf'] }])
  if (!target) return
  const bytes = await withBusy(t('Exporting…'), async () => {
    const out = await (await pageOps()).extractPages(await serialize(doc), pages)
    return opts.protect ? (await import('../core/protect')).protectPdf(out, opts.protect) : out
  })
  await platform.writeFile(target, bytes)
  toast(
    all
      ? opts.protect ? t('Exported the document with a password') : t('Exported the document')
      : opts.protect ? t('Exported {pages} with a password', { pages: pagesLabel(pages) }) : t('Exported {pages}', { pages: pagesLabel(pages) })
  )
}

export type PageImageFormat = 'png' | 'jpg' | 'tiff'

/**
 * Exports pages as images (PDF → PNG/JPEG/TIFF), markup and form values included.
 * One page is written to the chosen name; more pages get " (page N)" names beside it.
 */
export async function exportPagesAsImages(
  doc: PdfDoc,
  opts: { format: PageImageFormat; dpi: number; quality: number; which: 'all' | 'selected' | 'current' }
): Promise<void> {
  const pages = opts.which === 'all' ? [...Array(doc.pageCount.value).keys()] : opts.which === 'current' ? [doc.current.value] : selectedOrCurrent(doc)
  const ext = opts.format
  let base = doc.name.value.replace(/\.[^.]+$/, '')
  const name = (p: number) => (pages.length === 1 ? `${base}.${ext}` : `${base} (page ${p + 1}).${ext}`)
  const first = await platform.saveDialog(name(pages[0]), [{ name: ext.toUpperCase(), extensions: [ext] }])
  if (!first) return
  // The chosen name sets the pattern for the other pages.
  base = platform.baseName(first).replace(/\.[^.]+$/, '').replace(/ \(page \d+\)$/, '')
  const dir = platform.dirName(first)
  const sep = dir.includes('\\') ? '\\' : '/'
  await withBusy(t('Exporting…'), async () => {
    const proxy = await openPdf(await serialize(doc))
    try {
      for (const [k, p] of pages.entries()) {
        const page = await proxy.getPage(p + 1)
        const base1 = page.getViewport({ scale: 1 })
        let scale = opts.dpi / 72
        if (base1.width * base1.height * scale * scale > MAX_RASTER_PIXELS) scale = Math.sqrt(MAX_RASTER_PIXELS / (base1.width * base1.height))
        const vp = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(vp.width)
        canvas.height = Math.ceil(vp.height)
        await page.render({ canvas, viewport: vp, annotationMode: 1 /* ENABLE: annotations and form values */, background: 'white' }).promise
        const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        const target = k === 0 ? first : dir ? `${dir}${sep}${name(p)}` : name(p)
        await platform.saveImage(target, opts.format, canvas.width, canvas.height, img.data, opts.quality)
        canvas.width = canvas.height = 0
      }
    } finally {
      await proxy.loadingTask.destroy()
    }
  })
  toast(pages.length === 1 ? t('Exported') : t('{count, plural, one {Exported # image} other {Exported # images}}', { count: pages.length }))
}

/** Inserts copies of the selected pages right after the last of them. */
export async function duplicatePages(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const pages = selectedOrCurrent(doc)
  const at = Math.max(...pages) + 1
  await transferPages(doc, pages, doc, at, false)
  doc.selection.value = pages.map((_, k) => at + k)
}

/** Copies or moves the selected pages to the end of another open PDF. */
export async function sendPagesTo(dst: PdfDoc, move: boolean, doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf' || dst === doc) return
  await transferPages(doc, selectedOrCurrent(doc), dst, dst.pageCount.peek(), move)
  toast(move ? t('Moved to “{file}”', { file: dst.name.peek() }) : t('Copied to “{file}”', { file: dst.name.peek() }))
}

/** Splits the PDF into separate files: every N pages, or before each selected page. */
export async function splitDocument(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const n = doc.pageCount.value
  if (n < 2) return toast(t('A one-page PDF can’t be split.'))
  const selected = doc.selection.value.filter((p) => p > 0)
  const choice = await showDialog<'every' | 'selected' | null>({
    title: t('Split “{file}”', { file: doc.name.value }),
    body: selected.length
      ? t('Start a new file at each selected page ({count, plural, one {# file} other {# files}}), or split into files of a fixed length.', { count: selected.length + 1 })
      : t('Split into files with a fixed number of pages. (To split at specific pages, select where each new file starts first.)'),
    buttons: [
      { label: t('Cancel'), value: null },
      ...(selected.length ? [{ label: t('At selected pages'), value: 'selected' as const, primary: true }] : []),
      { label: t('Every N pages…'), value: 'every' as const, primary: !selected.length }
    ]
  })
  if (!choice) return
  const ops = await pageOps()
  let groups: number[][]
  if (choice === 'every') {
    const v = await promptText(t('Split PDF'), t('Pages per file'), { initial: '1', ok: t('Split') })
    const every = Math.floor(Number(v))
    if (!v || !(every >= 1)) return
    groups = ops.splitGroups(n, { every })
  } else {
    groups = ops.splitGroups(n, { starts: selected })
  }
  if (groups.length < 2) return toast(t('That would produce a single file; nothing to split.'))
  const base = doc.name.value.replace(/\.[^.]+$/, '')
  const first = await platform.saveDialog(`${base} (part 1).pdf`, [{ name: msg('PDF document'), extensions: ['pdf'] }])
  if (!first) return
  // The chosen name is the pattern: "Report (part 1).pdf" → "Report (part 2).pdf", …
  const dir = platform.dirName(first)
  const stem = platform.baseName(first).replace(/\.pdf$/i, '').replace(/\s*\(part 1\)$|[-_ ]?1$/i, '')
  const sep = dir.includes('\\') ? '\\' : '/'
  await withBusy(t('Splitting…'), async () => {
    const parts = await ops.splitPdf(await serialize(doc), groups)
    for (let k = 0; k < parts.length; k++) {
      const name = k === 0 ? platform.baseName(first) : `${stem} (part ${k + 1}).pdf`
      await platform.writeFile(dir ? `${dir}${sep}${name}` : name, parts[k])
    }
  })
  toast(t('{count, plural, one {Split into # file} other {Split into # files}}', { count: groups.length }))
}

export function selectAllPages(doc = activeDoc.value): void {
  if (doc?.kind === 'pdf') doc.selection.value = [...Array(doc.pageCount.value).keys()]
}

export async function undo(doc = activeDoc.value): Promise<void> {
  if (doc?.kind === 'pdf' || doc?.kind === 'image') await doc.undo()
}
export async function redo(doc = activeDoc.value): Promise<void> {
  if (doc?.kind === 'pdf' || doc?.kind === 'image') await doc.redo()
}

export async function showAbout(): Promise<void> {
  await alertDialog(t('About Glance'), t('Glance 0.1.0: a free, open-source viewer for PDFs, images and 3D models. Apache-2.0.'))
}

export function allDocs(): Doc[] {
  return docs.value
}

// ---------------------------------------------------------------------------
// Redaction (ADR 0005)

const REDACT_DPI = 300
const MAX_RASTER_PIXELS = 36_000_000

export async function makeRasterizer(bytes: Uint8Array): Promise<import('../core/redact').Rasterize> {
  const proxy = await openPdf(bytes)
  return async (pageIndex: number, rects: Rect[]) => {
    const page = await proxy.getPage(pageIndex + 1)
    const base = page.getViewport({ scale: 1, rotation: 0 })
    let scale = REDACT_DPI / 72
    if (base.width * base.height * scale * scale > MAX_RASTER_PIXELS) scale = Math.sqrt(MAX_RASTER_PIXELS / (base.width * base.height))
    const vp = page.getViewport({ scale, rotation: 0 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    await page.render({ canvas, viewport: vp, annotationMode: 1 /* ENABLE: keep other apps' annotations visible */, background: 'white' }).promise
    const g = canvas.getContext('2d')!
    g.fillStyle = '#000'
    for (const r of rects) {
      const [ax, ay] = vp.convertToViewportPoint(r[0], r[1])
      const [bx, by] = vp.convertToViewportPoint(r[2], r[3])
      g.fillRect(Math.min(ax, bx) - 1, Math.min(ay, by) - 1, Math.abs(bx - ax) + 2, Math.abs(by - ay) + 2)
    }
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.92))
    canvas.width = canvas.height = 0
    page.cleanup()
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' as const }
  }
}

/** Applies pending redactions after confirmation. Returns false if cancelled or failed. */
export async function applyRedactions(doc: Doc | null = activeDoc.value, confirm = true): Promise<boolean> {
  if (doc instanceof ImageDoc) {
    const n = doc.redactions.peek().length
    if (!n) return true
    if (confirm) {
      const ok = await showDialog<boolean>({
        title: t('Apply redactions?'),
        body: t('{count, plural, one {The marked area is painted solid black in the image.} other {The # marked areas are painted solid black in the image.}} When you save, the original pixels underneath are gone from the file.', { count: n }),
        buttons: [
          { label: t('Cancel'), value: false },
          { label: t('Apply redactions'), value: true, primary: true }
        ]
      })
      if (!ok) return false
    }
    const done = await applyImageRedactions(doc)
    if (done) toast(t('{count, plural, one {Redacted # area} other {Redacted # areas}}', { count: n }))
    return done
  }
  if (doc?.kind !== 'pdf') return false
  const reds = doc.redactions.peek()
  if (!reds.length) return true
  const pages = new Set(reds.map((r) => r.page)).size
  if (confirm) {
    const ok = await showDialog<boolean>({
      title: t('Apply redactions?'),
      body: t(
        '{count, plural, one {The content under # marked area will be permanently removed.} other {The content under # marked areas will be permanently removed.}} {pages, plural, one {The affected page becomes an image} other {The # affected pages become images}}: its text can no longer be selected or searched, and its links, comments and form fields are removed.',
        { count: reds.length, pages }
      ),
      buttons: [
        { label: t('Cancel'), value: false },
        { label: t('Apply redactions'), value: true, primary: true }
      ]
    })
    if (!ok) return false
  }
  const done = await run(doc, msg('Apply Redactions'), async (b) => {
    const rasterize = await makeRasterizer(b)
    return (await redact()).applyRedactions(b, reds, rasterize)
  })
  if (done) {
    doc.redactions.value = []
    versions.redactedDocs.add(doc)
    toast(t('{count, plural, one {Redacted # area} other {Redacted # areas}}', { count: reds.length }))
  }
  return done
}

export function discardRedactions(doc: Doc | null = activeDoc.value): void {
  if ((doc?.kind === 'pdf' || doc?.kind === 'image') && doc.redactions.peek().length) doc.edit(msg('Discard Redactions'), { redactions: [] })
}
