/**
 * Adjust Color (Preview's Tools → Adjust Color): tone, color and sharpness.
 * All values are 0 at "no change".
 */
import type { Raster } from './raster'

export interface AdjustParams {
  /** Stops, -3..3. */
  exposure: number
  /** -1..1 */
  contrast: number
  /** -1..1: negative recovers bright areas. */
  highlights: number
  /** -1..1: positive lifts dark areas. */
  shadows: number
  /** -1..1: -1 = black & white. */
  saturation: number
  /** -1..1: cooler (blue) to warmer (yellow). */
  temperature: number
  /** -1..1: green to magenta. */
  tint: number
  /** 0..1 */
  sepia: number
  /** 0..1 */
  sharpness: number
  /** -1..1: local contrast (clarity); negative softens. */
  definition: number
  /** Levels: input black and white points (0..255) and midtone gamma (0.2..5). */
  black: number
  white: number
  gamma: number
}

export const DEFAULT_ADJUST: AdjustParams = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  sepia: 0,
  sharpness: 0,
  definition: 0,
  black: 0,
  white: 255,
  gamma: 1
}

export function isIdentity(p: AdjustParams): boolean {
  return (Object.keys(DEFAULT_ADJUST) as (keyof AdjustParams)[]).every((k) => Math.abs(p[k] - DEFAULT_ADJUST[k]) < 1e-6)
}

/** Levels + exposure + contrast as one 256-entry tone curve. */
export function toneCurve(p: AdjustParams): Float32Array {
  const lut = new Float32Array(256)
  const range = Math.max(1, p.white - p.black)
  const gain = 2 ** p.exposure
  const k = p.contrast >= 0 ? 1 + p.contrast * 2 : 1 + p.contrast
  for (let i = 0; i < 256; i++) {
    let v = Math.min(1, Math.max(0, (i - p.black) / range))
    v = v ** (1 / p.gamma)
    v *= gain
    v = (v - 0.5) * k + 0.5
    lut[i] = Math.min(1, Math.max(0, v))
  }
  return lut
}

export function applyAdjust(img: Raster, p: AdjustParams): void {
  if (isIdentity(p)) return
  const { data } = img
  const tone = toneCurve(p)
  const sat = 1 + p.saturation
  const temp = p.temperature * 0.12
  const tint = p.tint * 0.1
  for (let i = 0; i < data.length; i += 4) {
    let r = tone[data[i]]
    let g = tone[data[i + 1]]
    let b = tone[data[i + 2]]
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    // Shadows/highlights: luminance-weighted lift or pull.
    if (p.shadows || p.highlights) {
      const s = p.shadows * (1 - L) ** 2 * 0.6
      const h = p.highlights * L ** 2 * 0.6
      const d = s + h
      r += d
      g += d
      b += d
    }
    r += temp
    b -= temp
    g -= tint
    if (sat !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = l + (r - l) * sat
      g = l + (g - l) * sat
      b = l + (b - l) * sat
    }
    if (p.sepia > 0) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b
      const sg = 0.349 * r + 0.686 * g + 0.168 * b
      const sb = 0.272 * r + 0.534 * g + 0.131 * b
      r += (sr - r) * p.sepia
      g += (sg - g) * p.sepia
      b += (sb - b) * p.sepia
    }
    data[i] = r * 255
    data[i + 1] = g * 255
    data[i + 2] = b * 255
  }
  if (p.definition) define(img, p.definition)
  if (p.sharpness > 0) sharpen(img, p.sharpness)
}

/** Box blur of one channel plane, horizontal then vertical (running sums, O(n)). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/**
 * Definition: unsharp mask on luminance with a wide radius (2% of the short side),
 * boosting mid-scale contrast without halos on fine detail. The radius follows the
 * image size so the reduced live preview looks like the full-resolution result.
 */
export function define(img: Raster, amount: number): void {
  const { width: w, height: h, data } = img
  const r = Math.max(2, Math.round(Math.min(w, h) * 0.02))
  const L = new Float32Array(w * h)
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  // Two box passes approximate a Gaussian.
  const blur = boxBlur(boxBlur(L, w, h, r), w, h, r)
  const k = amount * 0.8
  for (let i = 0, j = 0; j < L.length; i += 4, j++) {
    // Midtone-weighted so shadows and highlights don't clip.
    const t = L[j] / 255
    const d = (L[j] - blur[j]) * k * (1 - (2 * t - 1) ** 2)
    data[i] += d
    data[i + 1] += d
    data[i + 2] += d
  }
}

/** Unsharp mask with a 3×3 box blur. */
export function sharpen(img: Raster, amount: number): void {
  const { width: w, height: h, data } = img
  const src = new Uint8ClampedArray(data)
  const k = amount * 1.5
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[o + (dy * w + dx) * 4 + c]
        const v = src[o + c]
        data[o + c] = v + (v - sum / 9) * k
      }
    }
  }
}

export interface Histogram {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  luma: Uint32Array
}

export function histogram(img: Raster, step = 1): Histogram {
  const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), luma: new Uint32Array(256) }
  const { data } = img
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] === 0) continue
    h.r[data[i]]++
    h.g[data[i + 1]]++
    h.b[data[i + 2]]++
    h.luma[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++
  }
  return h
}

/** Preview's Auto Levels: stretch luminance so 0.5% of pixels clip at each end. */
export function autoLevels(hist: Histogram, clip = 0.005): Pick<AdjustParams, 'black' | 'white' | 'gamma'> {
  const total = hist.luma.reduce((a, b) => a + b, 0)
  if (!total) return { black: 0, white: 255, gamma: 1 }
  const limit = total * clip
  let acc = 0
  let black = 0
  for (; black < 255; black++) if ((acc += hist.luma[black]) > limit) break
  acc = 0
  let white = 255
  for (; white > 0; white--) if ((acc += hist.luma[white]) > limit) break
  if (white - black < 8) return { black: 0, white: 255, gamma: 1 }
  // Gamma that maps the median to the middle.
  let median = 0
  acc = 0
  for (; median < 255; median++) if ((acc += hist.luma[median]) >= total / 2) break
  const m = Math.min(0.95, Math.max(0.05, (median - black) / (white - black)))
  const gamma = Math.min(3, Math.max(0.33, Math.log(0.5) / Math.log(m)))
  return { black, white, gamma: Math.round(gamma * 100) / 100 }
}
