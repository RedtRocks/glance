import { raster, type IRect, type Raster } from './raster'

export function rotate90(img: Raster, clockwise: boolean): Raster {
  const { width: w, height: h, data } = img
  const out = raster(h, w)
  const src = new Uint32Array(data.buffer, data.byteOffset, w * h)
  const dst = new Uint32Array(out.data.buffer)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = clockwise ? h - 1 - y : y
      const ny = clockwise ? x : w - 1 - x
      dst[ny * h + nx] = src[y * w + x]
    }
  return out
}

export function flip(img: Raster, axis: 'horizontal' | 'vertical'): Raster {
  const { width: w, height: h, data } = img
  const out = raster(w, h)
  const src = new Uint32Array(data.buffer, data.byteOffset, w * h)
  const dst = new Uint32Array(out.data.buffer)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = axis === 'horizontal' ? w - 1 - x : x
      const sy = axis === 'vertical' ? h - 1 - y : y
      dst[y * w + x] = src[sy * w + sx]
    }
  return out
}

export function crop(img: Raster, r: IRect): Raster {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  const w = Math.min(img.width - x, Math.round(r.width))
  const h = Math.min(img.height - y, Math.round(r.height))
  if (w <= 0 || h <= 0) throw new Error('Nothing to crop')
  const out = raster(w, h)
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * img.width + x) * 4
    out.data.set(img.data.subarray(s, s + w * 4), row * w * 4)
  }
  return out
}
