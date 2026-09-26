/**
 * Hand-offs to Windows: open the file in another app, or use an image as the
 * desktop background / lock screen.
 */
import * as engine from '../image/engine'
import * as platform from '../platform'
import { activeDoc, ImageDoc, PdfDoc, type Doc } from './documents'
import { alertDialog, toast, withBusy } from './ui'

/** Formats that are really another app's working files; Glance shows a flattened preview. */
const EXTERNAL: Record<string, { kind: string; detail: string }> = {
  psd: { kind: 'Photoshop document', detail: 'Glance shows the flattened image. To edit layers, text or effects, open it in Photoshop or another image editor.' },
  psb: { kind: 'Photoshop document', detail: 'Glance shows the flattened image. To edit layers, text or effects, open it in Photoshop or another image editor.' },
  ai: { kind: 'Illustrator artwork', detail: 'Glance shows the PDF-compatible version. To edit the artwork, open it in Illustrator or another vector editor.' },
  eps: { kind: 'EPS artwork', detail: 'Glance shows a rendered preview. To edit it, open it in a vector editor.' },
  xcf: { kind: 'GIMP image', detail: 'To edit layers, open it in GIMP.' },
  ...Object.fromEntries(
    ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw', 'x3f', 'erf', '3fr', 'iiq', 'mrw', 'kdc', 'dcr'].map((e) => [
      e,
      { kind: 'Camera RAW photo', detail: 'Glance shows the preview the camera embedded. To develop the RAW data, open it in a photo editor.' }
    ])
  )
}

function ext(doc: Doc): string {
  return /\.([^.\\/]+)$/.exec(doc.path.peek() ?? doc.name.peek())?.[1]?.toLowerCase() ?? ''
}

/** Why this file is better edited elsewhere, or null for Glance's own formats. */
export function externalHint(doc: Doc | null): { kind: string; detail: string } | null {
  return doc ? (EXTERNAL[ext(doc)] ?? null) : null
}

export function canOpenWith(doc: Doc | null = activeDoc.value): boolean {
  return platform.isTauri && !!doc?.path.peek()
}

export async function openWithOtherApp(doc: Doc | null = activeDoc.value): Promise<void> {
  const path = doc?.path.peek()
  if (!path) return
  try {
    await platform.openWith(path)
  } catch (e) {
    toast(String(e), 'error')
  }
}

const AS_IS = ['jpg', 'jpeg', 'png', 'bmp']

/** The image as shown (edits, markup and rotation included), in a format Windows accepts. */
async function imageBytes(doc: ImageDoc): Promise<{ bytes: Uint8Array; ext: string }> {
  const e = ext(doc)
  if (!doc.dirty.peek() && doc.rotation.peek() === 0 && doc.pageCount.peek() <= 1 && AS_IS.includes(e) && doc.path.peek()) {
    return { bytes: await platform.readFile(doc.path.peek()!), ext: e }
  }
  if (doc.editable && doc.raster.peek()) return { bytes: await engine.encodePng(await engine.flatten(doc)), ext: 'png' }
  // View-only images (multi-page TIFF, RAW previews…): the page currently shown.
  const bitmap = await createImageBitmap(await (await fetch(platform.imageUrl(doc.probe, doc.current.peek()))).blob())
  const turn = doc.rotation.peek()
  const side = turn % 180 !== 0
  const canvas = new OffscreenCanvas(side ? bitmap.height : bitmap.width, side ? bitmap.width : bitmap.height)
  const g = canvas.getContext('2d')!
  g.translate(canvas.width / 2, canvas.height / 2)
  g.rotate((turn * Math.PI) / 180)
  g.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  return { bytes: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()), ext: 'png' }
}

export async function setAsWallpaper(target: 'desktop' | 'lock', doc: Doc | null = activeDoc.value): Promise<void> {
  if (!(doc instanceof ImageDoc)) return
  try {
    await withBusy(target === 'desktop' ? 'Setting background…' : 'Setting lock screen…', async () => {
      const { bytes, ext } = await imageBytes(doc)
      await platform.setWallpaper(bytes, ext, target)
    })
    toast(target === 'desktop' ? 'Set as desktop background' : 'Set as lock screen')
  } catch (e) {
    await alertDialog(target === 'desktop' ? 'Couldn’t set the background' : 'Couldn’t set the lock screen', String(e))
  }
}

/**
 * File → Share: the saved file, or, with unsaved edits, a temporary copy that
 * includes them (markup, form entries, pixel edits).
 */
export async function shareDoc(doc: Doc | null = activeDoc.value): Promise<void> {
  if (!doc || doc.kind === 'notice') return
  try {
    let path = doc.path.peek()
    if (!path || doc.dirty.peek()) {
      const name = doc.name.peek()
      if (doc instanceof PdfDoc) {
        const { serialize } = await import('./actions')
        path = await platform.writeTemp(name.replace(/\.[^.]+$/, '') + '.pdf', await serialize(doc))
      } else if (doc instanceof ImageDoc) {
        const { bytes, ext } = await imageBytes(doc)
        path = await platform.writeTemp(`${name.replace(/\.[^.]+$/, '')}.${ext}`, bytes)
      }
    }
    if (path) await platform.shareFiles([path], doc.name.peek())
  } catch (e) {
    toast(String((e as Error).message ?? e), 'error')
  }
}
