/** Instant Alpha and mask utilities. Masks are width*height bytes, 255 = selected. */
import type { IRect, Raster } from './raster'

/**
 * Contiguous region around (x, y) whose color is within `tolerance` (0..1) of the
 * seed color: Preview's Instant Alpha, where dragging farther widens the tolerance.
 */
export function floodMask(img: Raster, sx: number, sy: number, tolerance: number): Uint8Array {
  const { width: w, height: h, data } = img
  const mask = new Uint8Array(w * h)
  sx = Math.floor(sx)
  sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask
  const o = (sy * w + sx) * 4
  const [r0, g0, b0, a0] = [data[o], data[o + 1], data[o + 2], data[o + 3]]
  const limit = (tolerance * 441.7) ** 2 // max RGB distance is sqrt(3)*255
  const match = (i: number): boolean => {
    const p = i * 4
    // Already-transparent pixels always join, so repeated clicks grow the hole.
    if (data[p + 3] === 0 && a0 === 0) return true
    const dr = data[p] - r0
    const dg = data[p + 1] - g0
    const db = data[p + 2] - b0
    return dr * dr + dg * dg + db * db <= limit && Math.abs(data[p + 3] - a0) < 128
  }
  const stack = new Int32Array(w * h)
  let top = 0
  stack[top++] = sy * w + sx
  mask[sy * w + sx] = 255
  while (top) {
    const i = stack[--top]
    const x = i % w
    const y = (i - x) / w
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
    for (const n of next) {
      if (n >= 0 && !mask[n] && match(n)) {
        mask[n] = 255
        stack[top++] = n
      }
    }
  }
  return mask
}

/** Box-blurs a mask so edges fade over `radius` pixels instead of stair-stepping. */
export function featherMask(mask: Uint8Array, w: number, h: number, radius = 1): Uint8Array {
  if (radius <= 0) return mask
  const tmp = new Float32Array(w * h)
  const out = new Uint8Array(w * h)
  const size = radius * 2 + 1
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -radius; x <= radius; x++) acc += mask[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / size
      acc += mask[y * w + Math.min(w - 1, x + radius + 1)] - mask[y * w + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(acc / size)
      acc += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]
    }
  }
  return out
}

/** 'erase' makes selected pixels transparent; 'keep' makes everything else transparent. */
export function applyMask(img: Raster, mask: Uint8Array, mode: 'erase' | 'keep'): void {
  const { data } = img
  for (let i = 0; i < mask.length; i++) {
    const m = mode === 'erase' ? 255 - mask[i] : mask[i]
    data[i * 4 + 3] = (data[i * 4 + 3] * m) / 255
  }
}

export function invertMask(mask: Uint8Array): Uint8Array {
  return mask.map((v) => 255 - v)
}

/** Bounding box of non-zero mask values (or null if empty). */
export function maskBounds(mask: Uint8Array, w: number, h: number, threshold = 8): IRect | null {
  let x1 = w
  let y1 = h
  let x2 = -1
  let y2 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > threshold) {
        if (x < x1) x1 = x
        if (x > x2) x2 = x
        if (y < y1) y1 = y
        if (y > y2) y2 = y
      }
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 }
}

/** Alpha channel as a mask (for cropping to a cut-out subject). */
export function alphaMask(img: Raster): Uint8Array {
  const out = new Uint8Array(img.width * img.height)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3]
  return out
}

/** Bilinear upscale of a small mask (e.g. the 320×320 model output) to image size. */
export function resizeMask(mask: Uint8Array, mw: number, mh: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(mh - 1, Math.max(0, ((y + 0.5) * mh) / h - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(mh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(mw - 1, Math.max(0, ((x + 0.5) * mw) / w - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(mw - 1, x0 + 1)
      const tx = fx - x0
      const top = mask[y0 * mw + x0] * (1 - tx) + mask[y0 * mw + x1] * tx
      const bottom = mask[y1 * mw + x0] * (1 - tx) + mask[y1 * mw + x1] * tx
      out[y * w + x] = Math.round(top * (1 - ty) + bottom * ty)
    }
  }
  return out
}

/** Sharpens a soft matte: values near 0/255 snap, the edge band keeps a smooth ramp. */
export function refineMatte(mask: Uint8Array, low = 40, high = 215): Uint8Array {
  return mask.map((v) => (v <= low ? 0 : v >= high ? 255 : Math.round(((v - low) / (high - low)) * 255)))
}

/** Shift adds a new region to a selection (union); Alt takes it away (difference). */
export function combineMasks(base: Uint8Array, next: Uint8Array, mode: 'add' | 'subtract'): Uint8Array {
  const out = new Uint8Array(base.length)
  for (let i = 0; i < base.length; i++) out[i] = mode === 'add' ? Math.max(base[i], next[i]) : Math.min(base[i], 255 - next[i])
  return out
}
