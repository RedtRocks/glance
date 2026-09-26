/** Image editing actions (Preview's Tools menu for images). */
import { crop, flip, rotate90 } from '../core/image/transform'
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
import { msg, t } from '../i18n'

export function editableImage(doc: Doc | null = activeDoc.value): ImageDoc | null {
  return doc instanceof ImageDoc && doc.editable ? doc : null
}

/** `label` names the edit in the undo history: English, marked with msg(). */
async function pixels(doc: ImageDoc, label: string, op: (r: Raster) => Promise<Raster> | Raster): Promise<void> {
  try {
    await engine.ensureRaster(doc)
    await doc.applyPixels(label, op)
  } catch (e) {
    toast(t('{action} failed: {error}', { action: t(label), error: String((e as Error).message ?? e) }), 'error')
  }
}

export async function rotateImage(doc: ImageDoc, clockwise: boolean): Promise<void> {
  imageSelection.value = null
  // Markup would need rotating too; flatten-free rotation is simpler: rotate markup-free images only.
  if (doc.markup.peek().length) {
    toast(t('Rotating images with markup isn’t supported yet. Save first to flatten the markup.'), 'error')
    return
  }
  await pixels(doc, clockwise ? msg('Rotate Right') : msg('Rotate Left'), (r) => rotate90(r, clockwise))
}

export async function flipImage(doc: ImageDoc, axis: 'horizontal' | 'vertical'): Promise<void> {
  if (doc.markup.peek().length) {
    toast(t('Flipping images with markup isn’t supported yet. Save first to flatten the markup.'), 'error')
    return
  }
  await pixels(doc, axis === 'horizontal' ? msg('Flip Horizontal') : msg('Flip Vertical'), (r) => flip(r, axis))
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
    toast(t('Select an area first (rectangle, ellipse or lasso selection), then crop.'))
    return
  }
  if (doc.markup.peek().length) {
    toast(t('Cropping images with markup isn’t supported yet. Save first to flatten the markup.'), 'error')
    return
  }
  await pixels(doc, msg('Crop'), async (r) => {
    let src = r
    if (sel.kind !== 'rect') src = await engine.maskOut(r, (await selectionMask(r))!, 'keep')
    return crop(src, b)
  })
  imageSelection.value = null
}

/** Delete: selected pixels become transparent (Preview's Edit → Delete for images). */
export async function deleteSelection(doc: ImageDoc, invert = false): Promise<boolean> {
  const sel = imageSelection.peek()
  if (!sel) return false
  await pixels(doc, invert ? msg('Clear Outside Selection') : msg('Delete'), async (r) => engine.maskOut(r, (await selectionMask(r))!, 'erase', { invert }))
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
  await withBusy(t('Removing background…'), () => pixels(doc, msg('Remove Background'), (r) => engine.removeBackground(r)))
}

export async function copySubject(doc: ImageDoc): Promise<void> {
  try {
    const r = await engine.ensureRaster(doc)
    const png = await withBusy(t('Finding the subject…'), () => engine.subjectPng(r))
    await platform.copyPngToClipboard(png)
    toast(t('Subject copied. Paste it into any app.'))
  } catch (e) {
    toast(t('Copy Subject failed: {error}', { error: String((e as Error).message ?? e) }), 'error')
  }
}

export async function adjustSize(doc: ImageDoc, width: number, height: number): Promise<void> {
  if (doc.markup.peek().length) {
    toast(t('Resizing images with markup isn’t supported yet. Save first to flatten the markup.'), 'error')
    return
  }
  await withBusy(t('Resizing…'), () => pixels(doc, msg('Adjust Size'), (r) => engine.resize(r, width, height)))
}

export async function applyColorAdjustments(doc: ImageDoc, params: AdjustParams): Promise<void> {
  await withBusy(t('Applying…'), () => pixels(doc, msg('Adjust Color'), (r) => engine.adjust(r, params)))
}

// ---------------------------------------------------------------------------
// Save / export

/** Labels are marked with msg(): show them with t(). */
export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG', exts: ['png'] }, // i18n-ignore: format name
  { id: 'jpg', label: 'JPEG', exts: ['jpg', 'jpeg'] }, // i18n-ignore: format name
  { id: 'webp', label: msg('WebP (lossless)'), exts: ['webp'] },
  { id: 'tiff', label: 'TIFF', exts: ['tif', 'tiff'] }, // i18n-ignore: format name
  { id: 'bmp', label: 'BMP', exts: ['bmp'] }, // i18n-ignore: format name
  { id: 'pdf', label: 'PDF', exts: ['pdf'] } // i18n-ignore: format name
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
      title: t('Keep the transparency?'),
      body: t('{format} files can’t store transparent areas. Save a PNG copy to keep them, or save as {format} with a white background.', { format: ext.toUpperCase() }),
      buttons: [
        { label: t('Cancel'), value: 'cancel' },
        { label: t('Save {format}', { format: ext.toUpperCase() }), value: 'flatten' },
        { label: t('Save PNG copy'), value: 'png', primary: true }
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
  else await withBusy(t('Saving…'), () => writeImage(doc, path, extOf(path), 92))
  if (doc.redactions.peek().length) redactedDocs.add(doc)
  // Markup is now part of the pixels.
  if (doc.markup.peek().length || doc.redactions.peek().length) {
    doc.raster.value = await engine.flatten(doc)
    doc.markup.value = []
    doc.redactions.value = []
  }
  doc.dirty.value = false
  await rememberStamp(doc)
  await afterWrite(path, opts.auto ? msg('Autosaved') : msg('Saved'))
  if (!opts.auto) toast(t('Saved'))
  await offerToDeleteRedactedVersions(doc, path)
}

const LOSSY = ['jpg', 'jpeg', 'jfif', 'webp']

export async function saveImageAs(doc: ImageDoc, format: ExportFormat = 'png', quality = 92, switchTo = true, profile?: platform.ColorProfile): Promise<void> {
  const base = doc.name.peek().replace(/\.[^.]+$/, '')
  const fmt = EXPORT_FORMATS.find((f) => f.id === format)!
  const target = await platform.saveDialog(`${base}.${fmt.exts[0]}`, [{ name: fmt.label, extensions: [...fmt.exts] }])
  if (!target) return
  const chosen = EXPORT_FORMATS.find((f) => (f.exts as readonly string[]).includes(extOf(target)))?.id ?? format
  if (switchTo) await afterWrite(target, msg('Before replacing'))
  await withBusy(t('Saving…'), () => writeImage(doc, target, chosen, quality, profile))
  if (switchTo) await afterWrite(target, msg('Saved'))
  if (switchTo && chosen !== 'pdf') {
    const old = doc.path.value
    if (old) void platform.releaseFile(old)
    void platform.claimFile(target)
    doc.path.value = target
    doc.name.value = platform.baseName(target)
    doc.dirty.value = false
    await rememberStamp(doc)
  }
  toast(switchTo ? t('Saved') : t('Exported'))
}

/**
 * File → New from Clipboard (Ctrl+N): the copied image opens as a new, unsaved
 * document; Save asks where to put it.
 */
export async function newFromClipboard(): Promise<void> {
  const img = await platform.readClipboardImage()
  if (!img) return toast(t('There’s no image on the clipboard.'))
  const png = await engine.encodePng({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength) })
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')
  const tmp = await platform.writeTemp(`Clipboard ${stamp}.png`, png)
  const { openFiles } = await import('./actions')
  const { findByPath } = await import('./documents')
  await openFiles([tmp])
  const doc = findByPath(tmp)
  if (doc instanceof ImageDoc) {
    doc.name.value = t('Untitled') + '.png'
    doc.path.value = null // Save → Save As
    doc.dirty.value = true
  }
}
