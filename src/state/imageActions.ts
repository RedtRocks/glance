/** Image editing actions (Preview's Tools menu for images). */
import { crop, flip, flipAffine, rotate90, rotate90Affine, straightenGeometry, type Affine } from '../core/image/transform'
import { maskBounds } from '../core/image/alpha'
import { selectionBounds } from '../core/image/select'
import type { Raster } from '../core/image/raster'
import type { AdjustParams } from '../core/image/adjust'
import * as engine from '../image/engine'
import * as platform from '../platform'
import { activeDoc, ImageDoc, type Doc } from './documents'
import { imageSelection } from './imageState'
import { showDialog, toast, withBusy } from './ui'
import { pageOps } from './pdfModules'
import { afterWrite, beforeOverwrite, checkDisk, redactedDocs, rememberStamp } from './versions'
import { offerToDeleteRedactedVersions } from './actions'

export function editableImage(doc: Doc | null = activeDoc.value): ImageDoc | null {
  return doc instanceof ImageDoc && doc.editable ? doc : null
}

async function pixels(doc: ImageDoc, label: string, op: (r: Raster) => Promise<Raster> | Raster, geometry?: (before: Raster, after: Raster) => Affine): Promise<void> {
  try {
    await engine.ensureRaster(doc)
    await doc.applyPixels(label, op, geometry)
  } catch (e) {
    toast(`${label} failed: ${(e as Error).message ?? e}`, 'error')
  }
}

export async function rotateImage(doc: ImageDoc, clockwise: boolean): Promise<void> {
  imageSelection.value = null
  await pixels(doc, clockwise ? 'Rotate Right' : 'Rotate Left', (r) => rotate90(r, clockwise), (r) => rotate90Affine(r.width, r.height, clockwise))
}

export async function flipImage(doc: ImageDoc, axis: 'horizontal' | 'vertical'): Promise<void> {
  imageSelection.value = null
  await pixels(doc, axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical', (r) => flip(r, axis), (r) => flipAffine(r.width, r.height, axis))
}

/**
 * Straighten (rotate by any angle). Markup and redactions turn with the pixels; with
 * `cropToFill` the empty corners are cropped away, otherwise they stay transparent.
 */
export async function straightenImage(doc: ImageDoc, degrees: number, cropToFill: boolean): Promise<void> {
  if (Math.abs(degrees) < 0.005) return
  imageSelection.value = null
  await withBusy('Straightening…', () =>
    pixels(doc, 'Straighten', (r) => engine.rotate(r, degrees, cropToFill), (r) => straightenGeometry(r.width, r.height, degrees, cropToFill).map)
  )
}

async function selectionMask(r: Raster): Promise<Uint8Array | null> {
  const sel = imageSelection.peek()
  if (!sel) return null
  if (sel.kind === 'mask') return sel.mask
  return engine.selectionToMask(r, sel)
}

function selBounds(): { x: number; y: number; width: number; height: number } | null {
  const sel = imageSelection.peek()
  if (!sel) return null
  return sel.kind === 'mask' ? sel.bounds : selectionBounds(sel)
}

/** Crop to Selection: rectangle crops; other shapes also clear what's outside them. */
export async function cropToSelection(doc: ImageDoc): Promise<void> {
  const sel = imageSelection.peek()
  const b = selBounds()
  if (!sel || !b || b.width < 1 || b.height < 1) {
    toast('Select an area first (rectangle, ellipse or lasso selection), then crop.')
    return
  }
  await pixels(
    doc,
    'Crop',
    async (r) => {
      let src = r
      if (sel.kind !== 'rect') src = await engine.maskOut(r, (await selectionMask(r))!, 'keep')
      return crop(src, b)
    },
    () => [1, 0, 0, 1, -Math.max(0, Math.floor(b.x)), -Math.max(0, Math.floor(b.y))]
  )
  imageSelection.value = null
}

/** Delete: selected pixels become transparent (Preview's Edit → Delete for images). */
export async function deleteSelection(doc: ImageDoc, invert = false): Promise<boolean> {
  const sel = imageSelection.peek()
  if (!sel) return false
  await pixels(doc, invert ? 'Clear Outside Selection' : 'Delete', async (r) => engine.maskOut(r, (await selectionMask(r))!, 'erase', { invert }))
  imageSelection.value = null
  return true
}

export async function invertSelection(doc: ImageDoc): Promise<void> {
  const sel = imageSelection.peek()
  if (!sel) return
  const r = await engine.ensureRaster(doc)
  const mask = (await selectionMask(r))!.map((v) => 255 - v)
  const bounds = maskBounds(mask, r.width, r.height) ?? { x: 0, y: 0, width: 0, height: 0 }
  imageSelection.value = { kind: 'mask', mask, width: r.width, height: r.height, bounds }
}

export async function removeBackground(doc: ImageDoc): Promise<void> {
  await withBusy('Removing background…', () => pixels(doc, 'Remove Background', (r) => engine.removeBackground(r)))
}

export async function copySubject(doc: ImageDoc): Promise<void> {
  try {
    const r = await engine.ensureRaster(doc)
    const png = await withBusy('Finding the subject…', () => engine.subjectPng(r))
    await platform.copyPngToClipboard(png)
    toast('Subject copied. Paste it into any app.')
  } catch (e) {
    toast(`Copy Subject failed: ${(e as Error).message ?? e}`, 'error')
  }
}

export async function adjustSize(doc: ImageDoc, width: number, height: number): Promise<void> {
  await withBusy('Resizing…', () =>
    pixels(doc, 'Adjust Size', (r) => engine.resize(r, width, height), (before, after) => [after.width / before.width, 0, 0, after.height / before.height, 0, 0])
  )
}

export async function applyColorAdjustments(doc: ImageDoc, params: AdjustParams): Promise<void> {
  await withBusy('Applying…', () => pixels(doc, 'Adjust Color', (r) => engine.adjust(r, params)))
}

// ---------------------------------------------------------------------------
// Save / export

export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG', exts: ['png'] },
  { id: 'jpg', label: 'JPEG', exts: ['jpg', 'jpeg'] },
  { id: 'webp', label: 'WebP (lossless)', exts: ['webp'] },
  { id: 'tiff', label: 'TIFF', exts: ['tif', 'tiff'] },
  { id: 'bmp', label: 'BMP', exts: ['bmp'] },
  { id: 'pdf', label: 'PDF', exts: ['pdf'] }
] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['id']

function extOf(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
}

async function writeImage(doc: ImageDoc, path: string, format: string, quality: number, profile?: platform.ColorProfile): Promise<void> {
  const flat = await engine.flatten(doc)
  if (format === 'pdf') {
    const png = await engine.encodePng(flat)
    const pdf = await (await pageOps()).pdfFromImages([{ bytes: png, type: 'png' }])
    await platform.writeFile(path, pdf)
    return
  }
  await platform.saveImage(path, format, flat.width, flat.height, flat.data, quality, profile)
}

function hasTransparency(r: Raster): boolean {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] < 255) return true
  return false
}

export async function saveImage(doc: ImageDoc, opts: { auto?: boolean } = {}): Promise<void> {
  const path = doc.path.peek()
  if (!path || !doc.writableInPlace) return opts.auto ? undefined : saveImageAs(doc)
  if (!doc.dirty.peek()) return
  // Autosave re-encodes only lossless formats; JPEG would lose quality on every save.
  if (opts.auto && (LOSSY.includes(extOf(path)) || doc.redactions.peek().length)) return
  const ext = extOf(path)
  if (['jpg', 'jpeg', 'jfif', 'bmp', 'dib'].includes(ext) && doc.raster.peek() && hasTransparency(doc.raster.peek()!)) {
    const choice = await showDialog<'png' | 'flatten' | 'cancel'>({
      title: 'Keep the transparency?',
      body: `${ext.toUpperCase()} files can’t store transparent areas. Save a PNG copy to keep them, or save as ${ext.toUpperCase()} with a white background.`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: `Save ${ext.toUpperCase()}`, value: 'flatten' },
        { label: 'Save PNG copy', value: 'png', primary: true }
      ]
    })
    if (choice === 'png') return saveImageAs(doc, 'png')
    if (choice !== 'flatten') return
  }
  const disk = await checkDisk(doc, path, !!opts.auto)
  if (disk === 'cancel') return
  if (disk === 'copy') return saveImageAs(doc)
  await beforeOverwrite(doc, path)
  if (opts.auto) await writeImage(doc, path, extOf(path), 92)
  else await withBusy('Saving…', () => writeImage(doc, path, extOf(path), 92))
  if (doc.redactions.peek().length) redactedDocs.add(doc)
  // Markup is now part of the pixels.
  if (doc.markup.peek().length || doc.redactions.peek().length) {
    doc.raster.value = await engine.flatten(doc)
    doc.markup.value = []
    doc.redactions.value = []
  }
  doc.dirty.value = false
  await rememberStamp(doc)
  await afterWrite(path, opts.auto ? 'Autosaved' : 'Saved')
  if (!opts.auto) toast('Saved')
  await offerToDeleteRedactedVersions(doc, path)
}

const LOSSY = ['jpg', 'jpeg', 'jfif', 'webp']

export async function saveImageAs(doc: ImageDoc, format: ExportFormat = 'png', quality = 92, switchTo = true, profile?: platform.ColorProfile): Promise<void> {
  const base = doc.name.peek().replace(/\.[^.]+$/, '')
  const fmt = EXPORT_FORMATS.find((f) => f.id === format)!
  const target = await platform.saveDialog(`${base}.${fmt.exts[0]}`, [{ name: fmt.label, extensions: [...fmt.exts] }])
  if (!target) return
  const chosen = EXPORT_FORMATS.find((f) => (f.exts as readonly string[]).includes(extOf(target)))?.id ?? format
  if (switchTo) await afterWrite(target, 'Before replacing')
  await withBusy('Saving…', () => writeImage(doc, target, chosen, quality, profile))
  if (switchTo) await afterWrite(target, 'Saved')
  if (switchTo && chosen !== 'pdf') {
    const old = doc.path.value
    if (old) void platform.releaseFile(old)
    void platform.claimFile(target)
    doc.path.value = target
    doc.name.value = platform.baseName(target)
    doc.dirty.value = false
    await rememberStamp(doc)
  }
  toast(switchTo ? 'Saved' : 'Exported')
}

/**
 * File → New from Clipboard (Ctrl+N): the copied image opens as a new, unsaved
 * document; Save asks where to put it.
 */
export async function newFromClipboard(): Promise<void> {
  const img = await platform.readClipboardImage()
  if (!img) return toast('There’s no image on the clipboard.')
  const png = await engine.encodePng({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength) })
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')
  const tmp = await platform.writeTemp(`Clipboard ${stamp}.png`, png)
  const { openFiles } = await import('./actions')
  const { findByPath } = await import('./documents')
  await openFiles([tmp])
  const doc = findByPath(tmp)
  if (doc instanceof ImageDoc) {
    doc.name.value = 'Untitled.png'
    doc.path.value = null // Save → Save As
    doc.dirty.value = true
  }
}
