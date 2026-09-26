/** Image editing engine: loading pixels, worker calls, subject detection, flattening. */
import { clone, raster as makeRaster, type Raster } from '../core/image/raster'
import { alphaMask, floodMask, maskBounds, refineMatte, resizeMask } from '../core/image/alpha'
import { crop } from '../core/image/transform'
import type { AdjustParams } from '../core/image/adjust'
import type { Selection } from '../core/image/select'
import { NOTE_SIZE, outlinePath, type Markup, type Redaction } from '../core/markup'
import type { ImageDoc } from '../state/documents'
import * as platform from '../platform'
import type { WorkerRequest, WorkerResponse } from './worker'

// ---------------------------------------------------------------------------
// Worker

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: WorkerResponse) => void>()

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

function call(req: Req): Promise<WorkerResponse> {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    pending.get(e.data.id)?.(e.data)
    pending.delete(e.data.id)
  }
  const id = ++seq
  const msg = { ...req, id } as WorkerRequest
  // Always send a copy: the caller's raster may still be referenced by undo history.
  const transfer: Transferable[] = []
  if ('raster' in msg) {
    msg.raster = clone(msg.raster)
    transfer.push(msg.raster.data.buffer as ArrayBuffer)
  }
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve(r)))
    worker!.postMessage(msg, transfer)
  })
}

export const adjust = async (r: Raster, params: AdjustParams): Promise<Raster> => (await call({ op: 'adjust', raster: r, params })).raster!
export const flood = async (r: Raster, x: number, y: number, tolerance: number): Promise<Uint8Array> =>
  (await call({ op: 'flood', raster: r, x, y, tolerance })).mask!
export const selectionToMask = async (r: Raster, selection: Selection): Promise<Uint8Array> => (await call({ op: 'selectionMask', raster: r, selection })).mask!
export const maskOut = async (r: Raster, mask: Uint8Array, mode: 'erase' | 'keep', opts: { feather?: number; invert?: boolean } = {}): Promise<Raster> =>
  (await call({ op: 'applyMask', raster: r, mask, mode, feather: opts.feather ?? 0, invert: !!opts.invert })).raster!
export const resize = async (r: Raster, width: number, height: number): Promise<Raster> => (await call({ op: 'resize', raster: r, width, height })).raster!

// ---------------------------------------------------------------------------
// Pixels <-> canvas

export function toCanvas(r: Raster): OffscreenCanvas {
  const c = new OffscreenCanvas(r.width, r.height)
  c.getContext('2d')!.putImageData(new ImageData(r.data as unknown as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0)
  return c
}

export function fromCanvas(c: OffscreenCanvas | HTMLCanvasElement): Raster {
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const { data } = g.getImageData(0, 0, c.width, c.height)
  return makeRaster(c.width, c.height, data)
}

/** Decodes the document's image into editable pixels (EXIF orientation applied). */
export async function loadRaster(doc: ImageDoc): Promise<Raster> {
  const res = await fetch(platform.imageUrl(doc.probe, doc.current.peek()))
  if (!res.ok) throw new Error(await res.text())
  const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image', premultiplyAlpha: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return fromCanvas(c)
}

export async function ensureRaster(doc: ImageDoc): Promise<Raster> {
  const existing = doc.raster.peek()
  if (existing) return existing
  const r = await loadRaster(doc)
  doc.raster.value = r
  doc.natural.value = { width: r.width, height: r.height }
  return r
}

/** Downscaled copy for live previews (Adjust Color, Instant Alpha tolerance). */
export async function previewCopy(r: Raster, maxSide = 1600): Promise<{ raster: Raster; scale: number }> {
  const scale = Math.min(1, maxSide / Math.max(r.width, r.height))
  if (scale === 1) return { raster: clone(r), scale }
  return { raster: await resize(r, Math.round(r.width * scale), Math.round(r.height * scale)), scale }
}

// ---------------------------------------------------------------------------
// Subject detection (ADR 0002)

const MODEL_SIZE = 320

async function subjectMaskFor(r: Raster): Promise<Uint8Array> {
  if (platform.isTauri) {
    const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE)
    const g = small.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(toCanvas(r), 0, 0, MODEL_SIZE, MODEL_SIZE)
    const rgba = g.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data
    const rgb = new Uint8Array(MODEL_SIZE * MODEL_SIZE * 3)
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      // Transparent pixels read as white, like a photo on paper.
      const a = rgba[i + 3] / 255
      rgb[j] = rgba[i] * a + 255 * (1 - a)
      rgb[j + 1] = rgba[i + 1] * a + 255 * (1 - a)
      rgb[j + 2] = rgba[i + 2] * a + 255 * (1 - a)
    }
    const small320 = await platform.subjectMask(rgb)
    return refineMatte(resizeMask(small320, MODEL_SIZE, MODEL_SIZE, r.width, r.height))
  }
  // Browser fallback (development only): treat colors touching the border as background.
  const corners: [number, number][] = [[0, 0], [r.width - 1, 0], [0, r.height - 1], [r.width - 1, r.height - 1]]
  const bg = new Uint8Array(r.width * r.height)
  for (const [x, y] of corners) floodMask(r, x, y, 0.12).forEach((v, i) => v && (bg[i] = 255))
  return bg.map((v) => 255 - v)
}

/** Remove Background: keeps the subject, makes everything else transparent. */
export async function removeBackground(r: Raster): Promise<Raster> {
  const mask = await subjectMaskFor(r)
  return maskOut(r, mask, 'keep', { feather: 1 })
}

/** Copy Subject: the subject alone, cropped tight, as PNG bytes. */
export async function subjectPng(r: Raster): Promise<Uint8Array> {
  const cut = await removeBackground(r)
  const b = maskBounds(alphaMask(cut), cut.width, cut.height, 24)
  if (!b) throw new Error('No subject found in this image.')
  return encodePng(crop(cut, b))
}

export async function encodePng(r: Raster): Promise<Uint8Array> {
  const blob = await toCanvas(r).convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

// ---------------------------------------------------------------------------
// Flattening markup into pixels (images store markup only while editing)

function wrapLines(g: OffscreenCanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line && g.measureText(next.trimEnd()).width > width) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else line = next
    }
    out.push(line.trimEnd())
  }
  return out
}

const rgbCss = (c: [number, number, number] | null, a = 1): string =>
  c ? `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})` : 'transparent'

/** Draws markup (in y-up image space) onto a canvas holding `base`. */
export async function drawMarkup(g: OffscreenCanvasRenderingContext2D, markup: Markup[], redactions: Redaction[], base: OffscreenCanvas, H: number): Promise<void> {
  for (const m of markup) {
    const s = m.style
    g.save()
    g.globalAlpha = s.opacity
    g.lineCap = 'round'
    g.lineJoin = 'round'
    if (m.type === 'loupe') {
      const [x1, y1, x2, y2] = m.rect
      const cx = (x1 + x2) / 2
      const cy = H - (y1 + y2) / 2
      const r = (x2 - x1) / 2
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.clip()
      const src = r / m.zoom
      g.drawImage(base, cx - src, cy - src, src * 2, src * 2, cx - r, cy - r, r * 2, r * 2)
      g.restore()
      g.save()
      g.lineWidth = s.width
      g.strokeStyle = rgbCss(s.stroke)
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.stroke()
      g.restore()
      continue
    }
    if (m.type === 'signature') {
      const bmp = await createImageBitmap(new Blob([m.png as BlobPart], { type: 'image/png' }))
      const [x1, y1, x2, y2] = m.rect
      g.drawImage(bmp, x1, H - y2, x2 - x1, y2 - y1)
      bmp.close()
      g.restore()
      continue
    }
    if (m.type === 'text') {
      const [x1, y1, x2, y2] = m.rect
      if (s.fill || s.stroke) {
        g.fillStyle = rgbCss(s.fill)
        g.strokeStyle = rgbCss(s.stroke)
        g.lineWidth = s.width
        if (s.fill) g.fillRect(x1, H - y2, x2 - x1, y2 - y1)
        if (s.stroke) g.strokeRect(x1, H - y2, x2 - x1, y2 - y1)
      }
      g.fillStyle = rgbCss(m.color)
      g.font = `${m.fontSize}px Helvetica, Arial, sans-serif`
      g.textBaseline = 'top'
      wrapLines(g, m.text, x2 - x1 - 8).forEach((line, i) => g.fillText(line, x1 + 4, H - y2 + 4 + i * m.fontSize * 1.2))
      g.restore()
      continue
    }
    if (m.type === 'note') {
      g.restore()
      continue // notes are PDF-only
    }
    // Vector shapes: the shared path data is y-up, so flip the canvas.
    g.setTransform(1, 0, 0, -1, 0, H)
    const path = new Path2D(outlinePath(m))
    if (m.type === 'highlight') {
      g.globalCompositeOperation = 'multiply'
      g.fillStyle = rgbCss(s.stroke ?? [1, 0.85, 0.2])
      g.fill(path)
    } else {
      const closed = ['rect', 'roundRect', 'oval', 'star', 'bubble'].includes(m.type) || (m.type === 'polygon' && m.closed)
      if (closed && s.fill) {
        g.fillStyle = rgbCss(s.fill)
        g.fill(path)
      }
      if (s.stroke) {
        g.strokeStyle = rgbCss(s.stroke)
        g.lineWidth = s.width
        g.stroke(path)
      }
      if (m.type === 'arrow') {
        const { headPath } = await import('../core/markup')
        g.fillStyle = rgbCss(s.stroke)
        g.fill(new Path2D(headPath(m)))
      }
    }
    g.restore()
  }
  g.save()
  g.fillStyle = '#000'
  for (const r of redactions) g.fillRect(r.rect[0], H - r.rect[3], r.rect[2] - r.rect[0], r.rect[3] - r.rect[1])
  g.restore()
  void NOTE_SIZE
}

/** The image as it will be saved: pixels with markup and redactions burned in. */
export async function flatten(doc: ImageDoc): Promise<Raster> {
  const r = await ensureRaster(doc)
  const markup = doc.markup.peek()
  const reds = doc.redactions.peek()
  if (!markup.length && !reds.length) return r
  const base = toCanvas(r)
  const out = toCanvas(r)
  await drawMarkup(out.getContext('2d')!, markup, reds, base, r.height)
  return fromCanvas(out)
}
