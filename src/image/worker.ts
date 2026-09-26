/// <reference lib="webworker" />
/**
 * Full-resolution image operations off the UI thread. Each message carries its own
 * pixel buffer (transferred), so nothing is shared with the page.
 */
import { applyAdjust, type AdjustParams } from '../core/image/adjust'
import { applyMask, featherMask, floodMask, invertMask } from '../core/image/alpha'
import { selectionMask, type Selection } from '../core/image/select'
import type { Raster } from '../core/image/raster'
import { rotateAny } from '../core/image/transform'

export type WorkerRequest =
  | { id: number; op: 'adjust'; raster: Raster; params: AdjustParams }
  | { id: number; op: 'flood'; raster: Raster; x: number; y: number; tolerance: number }
  | { id: number; op: 'selectionMask'; raster: Raster; selection: Selection }
  | { id: number; op: 'applyMask'; raster: Raster; mask: Uint8Array; mode: 'erase' | 'keep'; feather: number; invert: boolean }
  | { id: number; op: 'resize'; raster: Raster; width: number; height: number }
  | { id: number; op: 'rotate'; raster: Raster; degrees: number; crop: boolean }

export type WorkerResponse = { id: number; raster?: Raster; mask?: Uint8Array; error?: string }

function resize(src: Raster, width: number, height: number): Raster {
  const from = new OffscreenCanvas(src.width, src.height)
  from.getContext('2d')!.putImageData(new ImageData(src.data as unknown as Uint8ClampedArray<ArrayBuffer>, src.width, src.height), 0, 0)
  // Halve repeatedly first so large reductions stay sharp and alias-free.
  let cur: OffscreenCanvas = from
  let w = src.width
  let h = src.height
  while (w / 2 >= width && h / 2 >= height) {
    const next = new OffscreenCanvas(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
    const g = next.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(cur, 0, 0, next.width, next.height)
    cur = next
    w = next.width
    h = next.height
  }
  const out = new OffscreenCanvas(width, height)
  const g = out.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(cur, 0, 0, width, height)
  const data = g.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data
  return { width, height, data }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    let res: WorkerResponse
    switch (req.op) {
      case 'adjust':
        applyAdjust(req.raster, req.params)
        res = { id: req.id, raster: req.raster }
        break
      case 'flood':
        res = { id: req.id, mask: floodMask(req.raster, req.x, req.y, req.tolerance) }
        break
      case 'selectionMask':
        res = { id: req.id, mask: selectionMask(req.selection, req.raster) }
        break
      case 'applyMask': {
        let m = req.invert ? invertMask(req.mask) : req.mask
        if (req.feather) m = featherMask(m, req.raster.width, req.raster.height, req.feather)
        applyMask(req.raster, m, req.mode)
        res = { id: req.id, raster: req.raster }
        break
      }
      case 'resize':
        res = { id: req.id, raster: resize(req.raster, req.width, req.height) }
        break
      case 'rotate':
        res = { id: req.id, raster: rotateAny(req.raster, req.degrees, req.crop) }
        break
    }
    const transfer: Transferable[] = []
    if (res.raster) transfer.push(res.raster.data.buffer as ArrayBuffer)
    if (res.mask) transfer.push(res.mask.buffer as ArrayBuffer)
    ;(self as unknown as Worker).postMessage(res, transfer)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: req.id, error: String(err) })
  }
}
