/** User-level operations shared by menus, toolbar, shortcuts and drag-and-drop. */
import * as platform from '../platform'
import type { Probe } from '../platform'
import type * as PageOps from '../core/pageOps'
import { MARKER_KEY, pageMaps, type Rect } from '../core/markup'
import { annotations, pageOps, redact } from './pdfModules'
import { openPdf } from '../pdf/engine'
import { PasswordRequired } from '../pdf/engine'
import {
  activeDoc,
  activeId,
  addDoc,
  docs,
  findByPath,
  ImageDoc,
  NoticeDoc,
  PdfDoc,
  removeDoc,
  type Doc
} from './documents'
import { alertDialog, promptText, showDialog, toast, withBusy } from './ui'
import { editableImage, rotateImage, saveImage, saveImageAs } from './imageActions'

const GS_INSTALL = 'winget install ArtifexSoftware.GhostScript'

export const OPEN_FILTERS: platform.FileFilter[] = [
  {
    name: 'All supported files',
    extensions: [
      'pdf', 'ai', 'ps', 'eps', 'epsf', 'xps', 'oxps', 'cbz',
      'jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'bmp', 'dib', 'ico', 'svg', 'avif',
      'tif', 'tiff', 'heic', 'heif', 'hif', 'jp2', 'j2k', 'jpf', 'jpx', 'jxl', 'jxr', 'wdp', 'hdp',
      'exr', 'hdr', 'tga', 'dds', 'qoi', 'ppm', 'pgm', 'pbm', 'pam', 'pnm', 'icns', 'psd', 'psb',
      'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'raw', 'dng', 'pef',
      'srw', 'x3f', 'erf', 'mef', 'mos', 'mrw', 'kdc', 'dcr', '3fr', 'fff', 'iiq', 'rwl', 'gpr',
      'glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'usdz', 'usda', 'usdc', 'dae', '3mf', '3ds'
    ]
  },
  { name: 'PDF documents', extensions: ['pdf', 'ai'] },
  { name: 'All files', extensions: ['*'] }
]

async function loadPdfDoc(doc: PdfDoc, bytes: Uint8Array): Promise<boolean> {
  for (;;) {
    try {
      await doc.load(bytes)
      return true
    } catch (e) {
      if (!(e instanceof PasswordRequired)) throw e
      const pw = await promptText(
        e.incorrect ? 'Incorrect password' : 'Password required',
        `“${doc.name.value}” is protected. Enter its password to open it.`,
        { password: true, ok: 'Open' }
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
  if (!proxy || doc.encrypted) return
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
    if (!markup.length) return bytes
    return (await annotations()).writeMarkup(bytes, markup)
  })
}

async function openOne(path: string): Promise<Doc | null> {
  const existing = findByPath(path)
  if (existing) {
    activeId.value = existing.id
    return existing
  }
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
    case 'xps':
      return notice(probe, 'XPS documents are coming soon', 'Glance will render XPS and OpenXPS through the Windows XPS engine in an upcoming update.')
    case 'model':
      return notice(probe, '3D models are coming soon', 'The 3D viewer (GLB, OBJ, STL, USDZ and more) is part of an upcoming update.')
    default:
      return notice(probe, 'Glance can’t open this file', 'This file type isn’t supported. If you think it should be, please open an issue on GitHub.')
  }
}

function notice(probe: Probe, title: string, message: string, actions: NoticeDoc['actions'] = []): Doc {
  const doc = new NoticeDoc(probe.name, probe.path, title, message, actions)
  addDoc(doc)
  return doc
}

async function openPostscript(probe: Probe): Promise<Doc | null> {
  try {
    const pdfPath = await withBusy('Converting PostScript…', () => platform.convertPostscript(probe.path))
    const doc = new PdfDoc(probe.name, null, probe.path)
    if (!(await loadPdfDoc(doc, await platform.readFile(pdfPath)))) return null
    addDoc(doc)
    return doc
  } catch (e) {
    const missing = String(e).includes('ghostscript-missing')
    const actions = [
      { label: 'Copy install command', run: () => void navigator.clipboard.writeText(GS_INSTALL).then(() => toast('Command copied. Paste it into Terminal.')) },
      { label: 'Ghostscript website', run: () => void platform.openUrl('https://ghostscript.com/releases/gsdnld.html') }
    ]
    const why = missing
      ? 'PostScript needs Ghostscript, a free program Glance can’t include for licensing reasons. Install it once and Glance will use it automatically.'
      : `Ghostscript couldn’t convert this file: ${String(e)}`
    if (/\.(eps|epsf|epsi)$/i.test(probe.path)) {
      // EPS files usually carry a preview image we can show meanwhile.
      const doc = new ImageDoc({ ...probe, kind: 'image', browserNative: false, pages: 1 }, `Showing the embedded preview. ${why}`)
      addDoc(doc)
      return doc
    }
    return notice(probe, 'Ghostscript is needed for PostScript', `${why}\n\n${GS_INSTALL}`, actions)
  }
}

export async function openFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await openOne(p)
    } catch (e) {
      console.error(e)
      toast(`Couldn’t open ${platform.baseName(p)}: ${(e as Error).message ?? e}`, 'error')
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
    title: 'Apply redactions before saving?',
    body: `${n} marked ${n === 1 ? 'area is' : 'areas are'} not redacted yet. Until you apply redactions, the content underneath is still in the file.`,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save without applying', value: 'skip' },
      { label: 'Apply and save', value: 'apply', primary: true }
    ]
  })
  if (choice === 'apply') return applyRedactions(doc, false)
  return choice === 'skip'
}

export async function save(doc: Doc | null = activeDoc.value): Promise<void> {
  if (doc instanceof ImageDoc) return saveImage(doc)
  if (!doc || doc.kind !== 'pdf') return
  const path = doc.path.value
  if (!path) return saveAs(doc)
  if (!(await resolvePendingRedactions(doc))) return
  await withBusy('Saving…', async () => platform.writeFile(path, await serialize(doc)))
  doc.dirty.value = false
  toast('Saved')
}

export async function saveAs(doc: Doc | null = activeDoc.value): Promise<void> {
  if (doc instanceof ImageDoc) return saveImageAs(doc)
  if (!doc || doc.kind !== 'pdf') return
  const base = doc.name.value.replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base}.pdf`, [{ name: 'PDF document', extensions: ['pdf'] }])
  if (!target) return
  if (!(await resolvePendingRedactions(doc))) return
  await withBusy('Saving…', async () => platform.writeFile(target, await serialize(doc)))
  doc.path.value = target
  doc.name.value = platform.baseName(target)
  doc.dirty.value = false
  toast('Saved')
}

export async function closeDoc(doc: Doc | null = activeDoc.value): Promise<void> {
  if (!doc) return
  if (doc.dirty.value) {
    const choice = await showDialog<'save' | 'discard' | 'cancel'>({
      title: `Save changes to “${doc.name.value}”?`,
      body: 'Your changes will be lost if you don’t save them.',
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Don’t save', value: 'discard' },
        { label: 'Save', value: 'save', primary: true }
      ]
    })
    if (choice === null || choice === 'cancel') return
    if (choice === 'save') {
      await save(doc)
      if (doc.dirty.value) return
    }
  }
  removeDoc(doc.id)
}

// ---------------------------------------------------------------------------
// Page management

function selectedOrCurrent(doc: PdfDoc): number[] {
  const sel = doc.selection.value
  return sel.length ? [...sel].sort((a, b) => a - b) : [doc.current.value]
}

async function run(doc: PdfDoc, label: string, op: Parameters<PdfDoc['apply']>[1], pages?: Parameters<PdfDoc['apply']>[2]): Promise<boolean> {
  try {
    await withBusy(`${label}…`, () => doc.apply(label, op, pages))
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
  await run(doc, delta > 0 ? 'Rotate Right' : 'Rotate Left', async (b) => (await pageOps()).rotatePages(b, pages, delta))
}

export async function deletePages(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const pages = selectedOrCurrent(doc)
  if (await run(doc, pages.length > 1 ? 'Delete Pages' : 'Delete Page', async (b) => (await pageOps()).deletePages(b, pages), pageMaps.delete(pages))) {
    doc.selection.value = []
  }
}

export async function insertBlankPage(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const at = Math.max(...selectedOrCurrent(doc)) + 1
  if (await run(doc, 'Insert Blank Page', async (b) => (await pageOps()).insertBlankPage(b, at), pageMaps.insert(at, 1))) {
    doc.selection.value = [at]
    doc.goTo(at)
  }
}

export async function movePages(doc: PdfDoc, pages: number[], to: number): Promise<void> {
  const order = (await pageOps()).computeMoveOrder(doc.pageCount.value, pages, to)
  if (order.every((v, i) => v === i)) return
  if (await run(doc, 'Move Pages', async (b) => (await pageOps()).reorderPages(b, order), pageMaps.reorder(order))) {
    const moved = new Set(pages)
    doc.selection.value = order.flatMap((src, i) => (moved.has(src) ? [i] : []))
  }
}

/** Converts any image Glance can display into PNG/JPEG bytes pdf-lib can embed. */
async function imageForPdf(probe: Probe): Promise<PageOps.ImageInput> {
  if (/\.(jpe?g|jfif)$/i.test(probe.path)) return { bytes: await platform.readFile(probe.path), type: 'jpg' }
  if (/\.png$/i.test(probe.path)) return { bytes: await platform.readFile(probe.path), type: 'png' }
  const res = await fetch(platform.imageUrl(probe))
  const bitmap = await createImageBitmap(await res.blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' }
}

/** Inserts files (PDF pages or images) into a PDF at a page position. */
export async function insertFiles(doc: PdfDoc, paths: string[], at: number): Promise<void> {
  const label = paths.length > 1 ? 'Insert Files' : 'Insert Pages'
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
        throw new Error(`${probe.name} can’t be inserted into a PDF.`)
      }
    }
    // Inserted PDFs may carry Glance markup; keep it editable.
    const extracted = await (await annotations()).extractMarkup(out)
    return { bytes: extracted.bytes, markup: extracted.markup, pages: pageMaps.insert(at, pos - at) }
  })
}

export async function insertFromFileDialog(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const paths = await platform.openDialog({ multiple: true, filters: OPEN_FILTERS })
  if (paths.length) await insertFiles(doc, paths, Math.max(...selectedOrCurrent(doc)) + 1)
}

/** Copies (or moves, with Shift) pages from one PDF into another. */
export async function transferPages(src: PdfDoc, pages: number[], dst: PdfDoc, at: number, move: boolean): Promise<void> {
  const sorted = [...pages].sort((a, b) => a - b)
  // Serialize so the pages' markup travels with them (and becomes editable in dst).
  const bytes = await serialize(src)
  const ok = await run(dst, move ? 'Move Pages' : 'Copy Pages', async (b) => {
    const merged = await (await pageOps()).insertPdfPages(b, bytes, at, sorted)
    const extracted = await (await annotations()).extractMarkup(merged)
    return { bytes: extracted.bytes, markup: extracted.markup, pages: pageMaps.insert(at, sorted.length) }
  })
  if (ok && move && src !== dst) {
    if (sorted.length >= src.pageCount.value) {
      toast('Pages copied. The source keeps its last page because a PDF needs at least one.')
      return
    }
    await run(src, 'Move Pages', async (b) => (await pageOps()).deletePages(b, sorted), pageMaps.delete(sorted))
    src.selection.value = []
  }
}

function pagesLabel(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b).map((p) => p + 1)
  return sorted.length === 1 ? `page ${sorted[0]}` : `pages ${sorted[0]}-${sorted.at(-1)}`
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

export async function exportSelectedPages(doc = activeDoc.value): Promise<void> {
  if (doc?.kind !== 'pdf') return
  const pages = selectedOrCurrent(doc)
  const base = doc.name.value.replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base} (${pagesLabel(pages)}).pdf`, [{ name: 'PDF document', extensions: ['pdf'] }])
  if (!target) return
  const bytes = await withBusy('Exporting…', async () => (await pageOps()).extractPages(await serialize(doc), pages))
  await platform.writeFile(target, bytes)
  toast(`Exported ${pagesLabel(pages)}`)
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
  await alertDialog('About Glance', 'Glance 0.1.0: a free, open-source viewer for PDFs, images and 3D models. Apache-2.0.')
}

export function allDocs(): Doc[] {
  return docs.value
}

// ---------------------------------------------------------------------------
// Redaction (ADR 0005)

const REDACT_DPI = 300
const MAX_RASTER_PIXELS = 36_000_000

async function makeRasterizer(bytes: Uint8Array): Promise<import('../core/redact').Rasterize> {
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
  if (doc?.kind !== 'pdf') return false
  const reds = doc.redactions.peek()
  if (!reds.length) return true
  const pages = new Set(reds.map((r) => r.page)).size
  if (confirm) {
    const ok = await showDialog<boolean>({
      title: 'Apply redactions?',
      body: `The content under ${reds.length} marked ${reds.length === 1 ? 'area' : 'areas'} will be permanently removed. ${pages === 1 ? 'The affected page becomes an image' : `The ${pages} affected pages become images`}: its text can no longer be selected or searched, and its links, comments and form fields are removed.`,
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Apply redactions', value: true, primary: true }
      ]
    })
    if (!ok) return false
  }
  const done = await run(doc, 'Apply Redactions', async (b) => {
    const rasterize = await makeRasterizer(b)
    return (await redact()).applyRedactions(b, reds, rasterize)
  })
  if (done) {
    doc.redactions.value = []
    toast(`Redacted ${reds.length} ${reds.length === 1 ? 'area' : 'areas'}`)
  }
  return done
}

export function discardRedactions(doc: Doc | null = activeDoc.value): void {
  if (doc?.kind === 'pdf' && doc.redactions.peek().length) doc.edit('Discard Redactions', { redactions: [] })
}
