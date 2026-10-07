/**
 * The tools Glance offers AI apps (names, descriptions and arguments: core/mcp/tools.json).
 *
 * File tools work headless on the paths they're given and never change them: every
 * edit goes to a new file (output_path). The live tools work with the window's tabs.
 * Messages here are read by the AI app, not shown in Glance's UI, so they're English.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ToolError, type Content, type ToolHandler, type ToolResult } from '../core/mcp/protocol'
import {
  checkInput,
  checkOutput,
  extension,
  matchOcrLines,
  pageIndex,
  parsePages,
  partPath,
  searchRegexes,
  toBase64,
  type Box,
  type SearchArgs
} from '../core/mcp/helpers'
import { samePath } from '../core/paths'
import { canvasMeasure, findMatches, type TextItem } from '../core/findText'
import { newId, type Rect, type Redaction } from '../core/markup'
import type { ImageInput } from '../core/pageOps'
import * as engine from '../image/engine'
import * as platform from '../platform'
import { openPdf, PasswordRequired } from '../pdf/engine'
import { imageForPdf, makeRasterizer, openFiles, serialize } from './actions'
import { activeDoc, activeId, docs, findByPath, ImageDoc, PdfDoc, type Doc } from './documents'
import { pageOps, redact } from './pdfModules'
import { editHandlers } from './aiEdit'
import { toast } from './ui'
import { t } from '../i18n'

type Canvas = HTMLCanvasElement | OffscreenCanvas

const VIEW_SIZE = 1568
/** Largest bitmap a tool renders, so a huge page can't exhaust memory. */
const MAX_PIXELS = 40_000_000
/** Text returned at once; longer documents are read in page ranges. */
const MAX_TEXT = 200_000
const IMAGE_OUTPUTS = ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp']
/** Formats that can carry transparency: shown as PNG, everything else as JPEG. */
const ALPHA = ['png', 'apng', 'gif', 'webp', 'svg', 'ico', 'icns', 'psd', 'tga', 'dds', 'qoi', 'avif', 'tif', 'tiff', 'exr', 'jxl']

// ---------------------------------------------------------------------------
// Opening files without a tab

type Source =
  | { kind: 'pdf'; path: string; probe: platform.Probe; bytes: Uint8Array; proxy: PDFDocumentProxy; pages: number }
  | { kind: 'raster'; path: string; probe: platform.Probe; pages: number }

async function exists(path: string): Promise<boolean> {
  return (await platform.fileStamp(path)) !== null
}

async function probeExisting(path: string): Promise<platform.Probe> {
  if (!(await exists(path))) throw new ToolError(`${path} doesn't exist`)
  return platform.probe(path)
}

async function pdfSource(path: string, probe: platform.Probe, bytes: Uint8Array): Promise<Source> {
  try {
    const proxy = await openPdf(bytes)
    return { kind: 'pdf', path, probe, bytes, proxy, pages: proxy.numPages }
  } catch (e) {
    if (e instanceof PasswordRequired) throw new ToolError(`${probe.name} is password protected. Open it in Glance (glance_open) so the user can enter the password.`)
    throw e
  }
}

async function open(path: string): Promise<Source> {
  const probe = await probeExisting(path)
  switch (probe.kind) {
    case 'pdf':
      return pdfSource(path, probe, await platform.readFile(path))
    case 'postscript':
      try {
        return await pdfSource(path, probe, await platform.readFile(await platform.convertPostscript(path)))
      } catch (e) {
        // EPS usually carries a preview image.
        if (/\.(eps|epsf|epsi)$/i.test(path)) return { kind: 'raster', path, probe: { ...probe, kind: 'image', browserNative: false, pages: 1 }, pages: 1 }
        throw new ToolError(String(e).includes('ghostscript-missing') ? 'PostScript needs Ghostscript, which isn’t installed on this PC.' : String(e))
      }
    case 'image':
    case 'archive':
    case 'xps':
      return { kind: 'raster', path, probe, pages: Math.max(1, probe.pages) }
    case 'model':
      throw new ToolError('3D models can’t be rendered by this tool. Use glance_open to show the model to the user.')
    default:
      throw new ToolError(`Glance can’t open ${probe.name}: unsupported file type.`)
  }
}

async function close(src: Source): Promise<void> {
  if (src.kind === 'pdf') await src.proxy.loadingTask.destroy()
}

async function withSource<T>(path: unknown, fn: (src: Source) => Promise<T>): Promise<T> {
  const src = await open(checkInput(path))
  try {
    return await fn(src)
  } finally {
    await close(src)
  }
}

// ---------------------------------------------------------------------------
// Rendering

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width))
  c.height = Math.max(1, Math.round(height))
  return c
}

function capScale(width: number, height: number, scale: number): number {
  const px = width * height * scale * scale
  return px > MAX_PIXELS ? scale * Math.sqrt(MAX_PIXELS / px) : scale
}

/** Renders a PDF page at `dpi`, or to fit `maxSide` pixels. */
async function renderPdfPage(proxy: PDFDocumentProxy, index: number, opts: { dpi?: number; maxSide?: number }) {
  const page = await proxy.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const scale = capScale(base.width, base.height, opts.maxSide ? opts.maxSide / Math.max(base.width, base.height) : (opts.dpi ?? 150) / 72)
  const viewport = page.getViewport({ scale })
  const c = canvas(viewport.width, viewport.height)
  await page.render({ canvas: c, viewport, background: 'white' }).promise
  page.cleanup()
  return { canvas: c, viewport }
}

async function decodeImage(probe: platform.Probe, index: number, max?: number): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(await platform.imageUrlAsync(probe, index, max))
  if (!res.ok) throw new ToolError(`couldn’t decode ${probe.name}: ${(await res.text().catch(() => '')) || res.status}`)
  const blob = await res.blob()
  try {
    return await createImageBitmap(blob)
  } catch {
    // SVG: only an <img> can rasterize it.
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

const sizeOf = (b: ImageBitmap | HTMLImageElement) => (b instanceof HTMLImageElement ? { w: b.naturalWidth || 300, h: b.naturalHeight || 150 } : { w: b.width, h: b.height })

/** One page of an image file, scaled down to `maxSide` if given. */
async function renderImage(probe: platform.Probe, index: number, maxSide?: number): Promise<HTMLCanvasElement> {
  // Formats the WebView decodes itself are served as is and scaled here.
  const bitmap = await decodeImage(probe, index, probe.browserNative ? undefined : maxSide)
  const { w, h } = sizeOf(bitmap)
  const scale = capScale(w, h, maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1)
  const c = canvas(w * scale, h * scale)
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height)
  if ('close' in bitmap) bitmap.close()
  return c
}

function fit(source: Canvas, maxSide: number): Canvas {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  if (scale === 1) return source
  const c = canvas(source.width * scale, source.height * scale)
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height)
  return c
}

async function encode(c: Canvas, type: 'image/png' | 'image/jpeg', quality = 0.88): Promise<Uint8Array> {
  const blob =
    c instanceof HTMLCanvasElement
      ? await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encoding failed'))), type, quality))
      : await c.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

async function imageContent(c: Canvas, png: boolean): Promise<Content> {
  const mimeType = png ? 'image/png' : 'image/jpeg'
  return { type: 'image', data: toBase64(await encode(c, mimeType)), mimeType }
}

const hasAlpha = (path: string) => ALPHA.includes(extension(path))

function pixels(c: Canvas): ImageData {
  return (c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).getImageData(0, 0, c.width, c.height)
}

// ---------------------------------------------------------------------------
// Text and OCR

async function pageItems(proxy: PDFDocumentProxy, index: number): Promise<TextItem[]> {
  const content = await (await proxy.getPage(index + 1)).getTextContent()
  const items = content.items.filter((it) => 'str' in it) as unknown as (TextItem & { fontName: string })[]
  return items.map((it) => ({ ...it, fontFamily: content.styles[it.fontName]?.fontFamily }))
}

function itemsText(items: TextItem[]): string {
  return items
    .map((it) => it.str + (it.hasEOL ? '\n' : ''))
    .join('')
    .trim()
}

const textChars = (items: TextItem[]) => items.reduce((n, it) => n + it.str.trim().length, 0)

function needOcr(): void {
  if (!platform.ocrAvailable) throw new ToolError('Text recognition (OCR) uses the Windows OCR engine, available in the Windows app.')
}

async function ocrMax(): Promise<number> {
  return Math.min(await platform.ocrMaxDimension(), 4000) || 2600
}

async function ocr(c: Canvas): Promise<platform.OcrResult> {
  const px = pixels(c)
  return platform.ocrImage(px.data, px.width, px.height)
}

const ocrText = (r: platform.OcrResult) => r.lines.map((l) => l.text).join('\n')

/** OCR of a PDF page, with each word's box converted to PDF space. */
async function ocrPdfPage(proxy: PDFDocumentProxy, index: number) {
  const max = await ocrMax()
  const page = await proxy.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const { canvas: c, viewport } = await renderPdfPage(proxy, index, { dpi: Math.min(300, (max / Math.max(base.width, base.height)) * 72) })
  const result = await ocr(c)
  c.width = c.height = 0
  const toPdf = (b: Box): Rect => {
    const [ax, ay] = viewport.convertToPdfPoint(b.x, b.y) as [number, number]
    const [bx, by] = viewport.convertToPdfPoint(b.x + b.w, b.y + b.h) as [number, number]
    const pad = Math.abs(by - ay) * 0.08
    return [Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad]
  }
  return { result, toPdf }
}

interface Found {
  page: number
  text: string
  rects: Rect[]
}

/** Every match on these PDF pages; pages without selectable text are searched with OCR. */
async function findInPdf(proxy: PDFDocumentProxy, indices: number[], regexes: RegExp[]) {
  const measure = canvasMeasure(new OffscreenCanvas(1, 1).getContext('2d')!)
  const found: Found[] = []
  const ocrPages: number[] = []
  const unsearched: number[] = []
  for (const i of indices) {
    const items = await pageItems(proxy, i)
    if (textChars(items) >= 10) {
      for (const m of findMatches(items, regexes, measure)) found.push({ page: i, text: m.text, rects: m.rects })
    } else if (platform.ocrAvailable) {
      const { result, toPdf } = await ocrPdfPage(proxy, i)
      ocrPages.push(i)
      for (const m of matchOcrLines(result.lines, regexes)) found.push({ page: i, text: m.text, rects: m.boxes.map(toPdf) })
    } else {
      unsearched.push(i)
    }
  }
  return { found, ocrPages, unsearched }
}

const pageList = (indices: number[]) => indices.map((i) => i + 1).join(', ')

function describeMatches(found: Found[]): string {
  if (!found.length) return 'No matches.'
  const lines = found.slice(0, 200).map((f) => `page ${f.page + 1}: ${f.text}`)
  if (found.length > 200) lines.push(`… and ${found.length - 200} more`)
  return `${found.length} match${found.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// Writing

async function prepareOutput(output: unknown, inputs: string[], overwrite: unknown): Promise<string> {
  if (typeof output !== 'string') throw new ToolError('output_path is required')
  checkOutput(output, inputs, await exists(output), overwrite === true, platform.pathPolicy)
  // A file open in Glance with unsaved edits would silently lose them.
  const open = findByPath(output)
  if (open?.dirty.peek()) throw new ToolError(`${output} is open in Glance with unsaved changes`)
  return output
}

const written = (path: string, extra = '') => `Wrote ${path}${extra}`

// ---------------------------------------------------------------------------
// The live window

function findTab(tab: unknown): Doc {
  if (tab === undefined || tab === null || tab === '') {
    const d = activeDoc.value
    if (!d) throw new ToolError('No document is open in Glance. Open one with glance_open.')
    return d
  }
  const d = docs.value.find((x) => x.id === tab || (x.path.peek() && samePath(x.path.peek()!, String(tab), platform.pathPolicy)))
  if (!d) throw new ToolError(`No open tab "${String(tab)}". glance_list_open lists the tabs.`)
  return d
}

function describeTab(d: Doc) {
  const paged = d instanceof PdfDoc || d instanceof ImageDoc
  return {
    tab: d.id,
    name: d.name.peek(),
    path: d.path.peek(),
    kind: d.kind,
    page: 'current' in d ? d.current.peek() + 1 : null,
    pages: 'pageCount' in d ? d.pageCount.peek() : null,
    selected_pages: paged ? d.selection.peek().map((i) => i + 1) : [],
    unsaved_changes: d.dirty.peek(),
    active: activeId.peek() === d.id
  }
}

function goTo(d: Doc, index: number): void {
  activeId.value = d.id
  if (d instanceof PdfDoc) d.goTo(index)
  else if (d instanceof ImageDoc) d.current.value = index
}

// ---------------------------------------------------------------------------
// Tools

const info: ToolHandler = async ({ path }) => {
  const p = checkInput(path)
  const probe = await probeExisting(p)
  const out: Record<string, unknown> = { path: p, name: probe.name, kind: probe.kind, size_bytes: probe.size }
  if (probe.kind === 'model' || probe.kind === 'unsupported') return json(out)
  await withSource(p, async (src) => {
    out.pages = src.pages
    if (src.kind === 'pdf') {
      if (src.probe.kind !== 'pdf') out.converted_from = src.probe.kind
      const meta = (await src.proxy.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined
      for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) if (meta?.[k]) out[k.toLowerCase()] = meta[k]
      const sizes = new Map<string, number[]>()
      const withText: number[] = []
      for (let i = 0; i < Math.min(src.pages, 100); i++) {
        const page = await src.proxy.getPage(i + 1)
        const vp = page.getViewport({ scale: 1 })
        const key = `${Math.round(vp.width)}×${Math.round(vp.height)} pt (${((vp.width / 72) * 25.4).toFixed(0)}×${((vp.height / 72) * 25.4).toFixed(0)} mm)`
        sizes.set(key, [...(sizes.get(key) ?? []), i + 1])
        if (i < 30 && textChars(await pageItems(src.proxy, i)) >= 10) withText.push(i + 1)
      }
      out.page_sizes = Object.fromEntries([...sizes].map(([k, v]) => [k, v.length === src.pages ? 'all pages' : v.join(', ')]))
      out.pages_with_selectable_text = withText.length === Math.min(src.pages, 30) ? (src.pages > 30 ? 'first 30 checked: all' : 'all') : withText
    } else {
      const first = await decodeImage(src.probe, 0)
      const { w, h } = sizeOf(first)
      if ('close' in first) first.close()
      out.width = w
      out.height = h
      const meta = await platform.imageMetadata(p).catch(() => null)
      if (meta) {
        out.metadata = Object.fromEntries(meta.groups.map((g) => [g.title, Object.fromEntries(g.fields.map((f) => [f.label, f.value]))]))
        if (meta.location) out.location = { latitude: meta.location[0], longitude: meta.location[1] }
        if (meta.color_profile) out.color_profile = meta.color_profile
      }
    }
  })
  return json(out)
}

function json(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value }
}

const view: ToolHandler = async ({ path, page, max_size }) =>
  withSource(path, async (src) => {
    const i = pageIndex(page, src.pages)
    const max = Number(max_size ?? VIEW_SIZE)
    const c = src.kind === 'pdf' ? (await renderPdfPage(src.proxy, i, { maxSide: max })).canvas : await renderImage(src.probe, i, max)
    const image = await imageContent(c, src.kind === 'pdf' || hasAlpha(src.path))
    // i18n-ignore: read by the AI app, not shown in Glance
    return { content: [{ type: 'text', text: `${src.probe.name}, page ${i + 1} of ${src.pages}` }, image] }
  })

const readText: ToolHandler = async ({ path, pages, ocr: mode = 'auto' }) =>
  withSource(path, async (src) => {
    const indices = parsePages(pages as string | undefined, src.pages)
    if (mode === 'always' || src.kind === 'raster') needOcr()
    const parts: string[] = []
    let total = 0
    for (const i of indices) {
      let text: string
      let how = ''
      if (src.kind === 'pdf') {
        text = itemsText(await pageItems(src.proxy, i))
        if (mode === 'always' || (mode === 'auto' && text.replace(/\s/g, '').length < 10 && platform.ocrAvailable)) {
          text = ocrText((await ocrPdfPage(src.proxy, i)).result)
          how = ' (OCR)'
        }
      } else {
        const c = await renderImage(src.probe, i, await ocrMax())
        text = ocrText(await ocr(c))
        how = ' (OCR)'
      }
      const part = `--- Page ${i + 1}${how} ---\n${text || '(no text found)'}`
      if (total + part.length > MAX_TEXT) {
        parts.push(`--- Stopped before page ${i + 1}: the text is long. Ask for pages "${i + 1}-" to continue. ---`)
        break
      }
      parts.push(part)
      total += part.length
    }
    return parts.join('\n\n')
  })

const convert: ToolHandler = async ({ path, output_path, page, max_size, quality, overwrite }) => {
  const p = checkInput(path)
  const out = await prepareOutput(output_path, [p], overwrite)
  const ext = extension(out)
  if (ext !== 'pdf' && !IMAGE_OUTPUTS.includes(ext)) throw new ToolError(`can’t write .${ext}: use .png, .jpg, .webp, .tif, .bmp or .pdf`)
  return withSource(p, async (src) => {
    const i = pageIndex(page, src.pages)
    const max = max_size === undefined ? undefined : Number(max_size)
    const ops = await pageOps()
    if (ext === 'pdf') {
      if (src.kind === 'pdf') {
        await platform.writeFile(out, await ops.extractPages(src.bytes, [i]))
      } else {
        const image: ImageInput =
          src.pages === 1 && !max && /\.(jpe?g|jfif|png)$/i.test(p) ? await imageForPdf(src.probe) : { bytes: await encode(await renderImage(src.probe, i, max), 'image/png'), type: 'png' }
        await platform.writeFile(out, await ops.pdfFromImages([image]))
      }
      return written(out)
    }
    const c = src.kind === 'pdf' ? (await renderPdfPage(src.proxy, i, max ? { maxSide: max } : { dpi: 200 })).canvas : await renderImage(src.probe, i, max)
    const px = pixels(c)
    await platform.saveImage(out, ext, px.width, px.height, px.data, Number(quality ?? 90))
    return written(out, ` (${px.width}×${px.height})`)
  })
}

/** Pages of any file Glance opens, as PDF bytes or images to add as pages. */
async function pdfParts(path: string): Promise<{ pdf: Uint8Array } | { images: ImageInput[] }> {
  const probe = await probeExisting(path)
  if (probe.kind === 'pdf') return { pdf: await platform.readFile(path) }
  if (probe.kind === 'image' && probe.pages <= 1) return { images: [await imageForPdf(probe)] }
  return withSource(path, async (src) => {
    if (src.kind === 'pdf') return { pdf: src.bytes }
    const images: ImageInput[] = []
    for (let i = 0; i < src.pages; i++) images.push({ bytes: await encode(await renderImage(src.probe, i), 'image/png'), type: 'png' })
    return { images }
  })
}

const combine: ToolHandler = async ({ inputs, output_path, overwrite }) => {
  const paths = (inputs as unknown[]).map(checkInput)
  const out = await prepareOutput(output_path, paths, overwrite)
  if (extension(out) !== 'pdf') throw new ToolError('output_path must end in .pdf')
  const ops = await pageOps()
  let bytes: Uint8Array | null = null
  for (const p of paths) {
    let part: Awaited<ReturnType<typeof pdfParts>>
    try {
      part = await pdfParts(p)
    } catch (e) {
      throw new ToolError(`${platform.baseName(p)}: ${(e as Error).message ?? e}`)
    }
    if ('pdf' in part) bytes = bytes ? await ops.insertPdfPages(bytes, part.pdf, await ops.pageCount(bytes)) : part.pdf
    else bytes = bytes ? await ops.insertImagePages(bytes, part.images, await ops.pageCount(bytes)) : await ops.pdfFromImages(part.images)
  }
  await platform.writeFile(out, bytes!)
  return written(out, ` (${await ops.pageCount(bytes!)} pages)`)
}

const ROTATION: Record<number, 90 | -90 | 180> = { 90: 90, 180: 180, 270: -90, [-90]: -90 }

const pdfPages: ToolHandler = async ({ path, action, output_path, pages, degrees, order, every, overwrite }) => {
  const p = checkInput(path)
  const out = action === 'split' ? String(output_path ?? '') : await prepareOutput(output_path, [p], overwrite)
  return withSource(p, async (src) => {
    if (src.kind !== 'pdf') throw new ToolError(`${src.probe.name} isn’t a PDF`)
    const ops = await pageOps()
    const n = src.pages
    const need = () => {
      if (pages === undefined) throw new ToolError(`${String(action)} needs pages`)
      return parsePages(pages as string, n)
    }
    switch (action) {
      case 'extract':
        await platform.writeFile(out, await ops.extractPages(src.bytes, need()))
        return written(out)
      case 'delete': {
        const idx = need()
        if (idx.length >= n) throw new ToolError('a PDF must keep at least one page')
        await platform.writeFile(out, await ops.deletePages(src.bytes, idx))
        return written(out, ` (${n - idx.length} pages)`)
      }
      case 'rotate': {
        const delta = ROTATION[Number(degrees)]
        if (!delta) throw new ToolError('rotate needs degrees: 90, 180 or 270')
        await platform.writeFile(out, await ops.rotatePages(src.bytes, parsePages(pages as string | undefined, n), delta))
        return written(out)
      }
      case 'reorder': {
        const list = (order as number[] | undefined) ?? []
        const sorted = [...list].sort((a, b) => a - b)
        if (list.length !== n || sorted.some((v, k) => v !== k + 1)) throw new ToolError(`order must list every page from 1 to ${n} exactly once`)
        await platform.writeFile(out, await ops.reorderPages(src.bytes, list.map((v) => v - 1)))
        return written(out)
      }
      case 'split': {
        const groups = every ? ops.splitGroups(n, { every: Number(every) }) : pages ? ops.splitGroups(n, { starts: parsePages(pages as string, n) }) : null
        if (!groups) throw new ToolError('split needs every or pages')
        const names = groups.map((_, k) => partPath(out, k + 1))
        for (const name of names) await prepareOutput(name, [p], overwrite)
        const parts = await ops.splitPdf(src.bytes, groups)
        for (let k = 0; k < parts.length; k++) await platform.writeFile(names[k], parts[k])
        return `Wrote ${parts.length} PDFs:\n${names.map((name, k) => `${name} (pages ${groups[k][0] + 1}-${groups[k][groups[k].length - 1] + 1})`).join('\n')}`
      }
      default:
        throw new ToolError(`unknown action ${String(action)}`)
    }
  })
}

const redactFile: ToolHandler = async (args) => {
  const p = checkInput(args.path)
  const regexes = searchRegexes(args as SearchArgs)
  const dry = args.dry_run === true
  const out = dry ? '' : await prepareOutput(args.output_path, [p], args.overwrite)
  return withSource(p, async (src) => {
    if (src.kind === 'pdf') {
      if (!dry && extension(out) !== 'pdf') throw new ToolError('output_path must end in .pdf')
      const { found, ocrPages, unsearched } = await findInPdf(src.proxy, parsePages(args.pages as string | undefined, src.pages), regexes)
      const notes = [
        ...(ocrPages.length ? [`Searched pages ${pageList(ocrPages)} with OCR (no selectable text).`] : []),
        ...(unsearched.length ? [`Pages ${pageList(unsearched)} have no selectable text and OCR isn’t available, so they weren’t searched.`] : [])
      ]
      const report = [describeMatches(found), ...notes].join('\n')
      if (dry || !found.length) return dry ? report : `${report}\nNothing to redact; no file written.`
      const reds: Redaction[] = found.flatMap((f) => f.rects.map((rect) => ({ id: newId('redact'), page: f.page, rect })))
      const bytes = await (await redact()).applyRedactions(src.bytes, reds, await makeRasterizer(src.bytes))
      await platform.writeFile(out, bytes)
      const pagesHit = [...new Set(found.map((f) => f.page))]
      return `${report}\n${written(out)}. Redacted pages (${pageList(pagesHit)}) are now images; their text can no longer be selected.`
    }
    // Images: OCR finds the words; their boxes are painted black in the pixels.
    needOcr()
    if (src.pages > 1) throw new ToolError('multi-page images can’t be redacted; convert the pages first (glance_convert)')
    if (!dry && !IMAGE_OUTPUTS.includes(extension(out))) throw new ToolError('output_path must be .png, .jpg, .webp, .tif or .bmp')
    const full = await renderImage(src.probe, 0)
    const small = fit(full, await ocrMax())
    const k = full.width / small.width
    const matches = matchOcrLines((await ocr(small)).lines, regexes)
    const found: Found[] = matches.map((m) => ({ page: 0, text: m.text, rects: [] }))
    if (dry || !matches.length) return dry ? describeMatches(found) : `${describeMatches(found)}\nNothing to redact; no file written.`
    const g = full.getContext('2d')!
    g.fillStyle = '#000'
    for (const m of matches) for (const b of m.boxes) g.fillRect(b.x * k - 2, b.y * k - 2, b.w * k + 4, b.h * k + 4)
    const px = pixels(full)
    await platform.saveImage(out, extension(out), px.width, px.height, px.data, 92)
    return `${describeMatches(found)}\n${written(out)} (metadata not copied).`
  })
}

const removeLocation: ToolHandler = async ({ path, output_path, overwrite }) => {
  const p = checkInput(path)
  const out = await prepareOutput(output_path, [p], overwrite)
  if (extension(out) !== extension(p)) throw new ToolError(`output_path must have the same extension (.${extension(p)})`)
  const meta = await platform.imageMetadata(p).catch(() => null)
  if (meta && !meta.can_remove_location) throw new ToolError('Glance can’t remove location info from this format')
  await platform.writeFile(out, await platform.readFile(p))
  const failed = await platform.removeLocation([out])
  if (failed.length) throw new ToolError(failed.join('\n'))
  return written(out, meta?.has_location ? ' without its location' : ' (the photo had no location to begin with)')
}

const openTabs: ToolHandler = async ({ paths, page }) => {
  const list = (paths as unknown[]).map(checkInput)
  for (const p of list) if (!(await exists(p))) throw new ToolError(`${p} doesn't exist`)
  await platform.showForAi()
  await openFiles(list)
  const opened = list.map((p) => findByPath(p)).filter((d): d is Doc => !!d)
  if (page !== undefined && opened[0] && 'pageCount' in opened[0]) goTo(opened[0], pageIndex(page, opened[0].pageCount.peek()))
  else if (opened[0]) activeId.value = opened[0].id
  return json({ opened: opened.map(describeTab), ...(opened.length < list.length ? { note: 'Some files opened in another Glance window or couldn’t be opened.' } : {}) })
}

const listOpen: ToolHandler = async () => json({ tabs: docs.value.map(describeTab) })

/** Renders page `index` of an open tab as the user sees it (unsaved edits included), with its text for PDFs. */
export async function renderTab(d: Doc, index: number, max: number): Promise<{ canvas: Canvas; text: string; pages: number; png: boolean }> {
  if (d instanceof PdfDoc) {
    const proxy = await openPdf(await serialize(d), d.password)
    try {
      const { canvas: c } = await renderPdfPage(proxy, index, { maxSide: max })
      return { canvas: c, text: itemsText(await pageItems(proxy, index)), pages: proxy.numPages, png: true }
    } finally {
      await proxy.loadingTask.destroy()
    }
  }
  if (d instanceof ImageDoc) {
    const edited = d.editable && (d.raster.peek() || d.markup.peek().length)
    const c = edited ? fit(engine.toCanvas(await engine.flatten(d)), max) : await renderImage(d.probe, index, max)
    return { canvas: c, text: '', pages: d.pageCount.peek(), png: hasAlpha(d.probe.path) }
  }
  throw new ToolError(`${d.name.peek()} is a ${d.kind === 'model' ? '3D model' : 'notice'}; only documents and images can be captured`)
}

/** PNG or JPEG for an AI agent, as base64. */
export async function encodeForAi(c: Canvas, png: boolean): Promise<{ data: string; mimeType: string }> {
  const { data, mimeType } = (await imageContent(c, png)) as { data: string; mimeType: string }
  return { data, mimeType }
}

const currentView: ToolHandler = async ({ tab, max_size }) => {
  const d = findTab(tab)
  const max = Number(max_size ?? VIEW_SIZE)
  const i = 'current' in d ? d.current.peek() : 0
  const r = await renderTab(d, i, max)
  const head = `${d.name.peek()}, page ${i + 1} of ${r.pages}${d.dirty.peek() ? ' (unsaved changes included)' : ''}`
  const text = d instanceof PdfDoc ? `${head}\n\n${r.text || '(no selectable text on this page)'}` : head
  return { content: [{ type: 'text', text }, await imageContent(r.canvas, r.png)] }
}

const goToPage: ToolHandler = async ({ tab, page }) => {
  const d = findTab(tab)
  if (!('pageCount' in d)) throw new ToolError(`${d.name.peek()} has no pages`)
  goTo(d, pageIndex(page, d.pageCount.peek()))
  await platform.showForAi()
  return `Showing page ${Number(page)} of ${d.name.peek()}`
}

const markRedactions: ToolHandler = async (args) => {
  const d = findTab(args.tab)
  if (!(d instanceof PdfDoc)) throw new ToolError('only PDFs can be marked in the window; for images use glance_redact')
  const proxy = d.proxy.peek()
  if (!proxy) throw new ToolError(`${d.name.peek()} is still loading`)
  const { found, unsearched } = await findInPdf(proxy, parsePages(args.pages as string | undefined, d.pageCount.peek()), searchRegexes(args as SearchArgs))
  if (found.length) {
    const reds = found.flatMap((f) => f.rects.map((rect) => ({ id: newId('redact'), page: f.page, rect })))
    d.edit('Mark Text for Redaction', { redactions: [...d.redactions.peek(), ...reds] })
    goTo(d, Math.min(...found.map((f) => f.page)))
    await platform.showForAi()
    toast(t('{count, plural, one {# match marked.} other {# matches marked.}} Review, then Apply Redactions.', { count: found.length }))
  }
  return [
    describeMatches(found),
    found.length ? 'Marked for the user to review in Glance. Nothing is removed until they choose Apply Redactions.' : '',
    unsearched.length ? `Pages ${pageList(unsearched)} have no selectable text and weren’t searched.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export const handlers: Record<string, ToolHandler> = {
  glance_info: info,
  glance_view: view,
  glance_read_text: readText,
  glance_convert: convert,
  glance_combine: combine,
  glance_pdf_pages: pdfPages,
  glance_redact: redactFile,
  glance_remove_location: removeLocation,
  glance_open: openTabs,
  glance_list_open: listOpen,
  glance_current_view: currentView,
  glance_go_to_page: goToPage,
  glance_mark_redactions: markRedactions,
  ...editHandlers
}
