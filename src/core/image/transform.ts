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

/**
 * A 2D affine map in canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f.
 * Image transforms use pixel space (y down, pixel i spans [i, i+1]).
 */
export type Affine = [number, number, number, number, number, number]

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

export function applyAffine([a, b, c, d, e, f]: Affine, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f]
}

export function rotate90Affine(w: number, h: number, clockwise: boolean): Affine {
  return clockwise ? [0, 1, -1, 0, h, 0] : [0, -1, 1, 0, 0, w]
}

export function flipAffine(w: number, h: number, axis: 'horizontal' | 'vertical'): Affine {
  return axis === 'horizontal' ? [-1, 0, 0, 1, w, 0] : [1, 0, 0, -1, 0, h]
}

/** Largest straighten angle the tool offers; beyond it, Rotate Left/Right fits better. */
export const MAX_STRAIGHTEN = 45

export interface Straighten {
  width: number
  height: number
  /** Source pixel space → result pixel space. */
  map: Affine
}

/**
 * Geometry of rotating a w×h image by `degrees` (positive turns clockwise on screen)
 * about its center. With `crop`, the result is the largest centered rectangle of the
 * original aspect ratio that has no empty corners (Preview and Photos do the same);
 * without it, the canvas grows to hold the whole rotated image.
 */
export function straightenGeometry(w: number, h: number, degrees: number, crop: boolean): Straighten {
  const t = (degrees * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const c = Math.abs(cos)
  const s = Math.abs(sin)
  let width: number
  let height: number
  if (crop) {
    const k = Math.min(1, w / (w * c + h * s), h / (w * s + h * c))
    // Round down so rounding never exposes an empty corner pixel.
    width = Math.max(1, Math.floor(w * k + 1e-9))
    height = Math.max(1, Math.floor(h * k + 1e-9))
  } else {
    width = Math.max(1, Math.ceil(w * c + h * s - 1e-6))
    height = Math.max(1, Math.ceil(w * s + h * c - 1e-6))
  }
  const cx = w / 2
  const cy = h / 2
  const ox = width / 2
  const oy = height / 2
  return { width, height, map: [cos, sin, -sin, cos, ox - cos * cx + sin * cy, oy - sin * cx - cos * cy] }
}

/**
 * Rotates by any angle with bilinear sampling (premultiplied, so transparent pixels
 * don't bleed dark fringes). Corners outside the source come out transparent.
 */
export function rotateAny(img: Raster, degrees: number, cropToFill: boolean): Raster {
  const { width: w, height: h, data: src } = img
  const g = straightenGeometry(w, h, degrees, cropToFill)
  const out = raster(g.width, g.height)
  const dst = out.data
  const [cos, sin, , , e, f] = g.map
  // Inverse of a rotation plus translation.
  const ix = (x: number, y: number): number => cos * (x - e) + sin * (y - f)
  const iy = (x: number, y: number): number => -sin * (x - e) + cos * (y - f)
  const clamp = cropToFill
  for (let v = 0; v < g.height; v++) {
    for (let u = 0; u < g.width; u++) {
      const sx = ix(u + 0.5, v + 0.5) - 0.5
      const sy = iy(u + 0.5, v + 0.5) - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      let r = 0
      let gg = 0
      let b = 0
      let a = 0
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          let px = x0 + i
          let py = y0 + j
          if (clamp) {
            px = px < 0 ? 0 : px >= w ? w - 1 : px
            py = py < 0 ? 0 : py >= h ? h - 1 : py
          } else if (px < 0 || py < 0 || px >= w || py >= h) continue
          const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
          const o = (py * w + px) * 4
          const al = src[o + 3] * wgt
          r += src[o] * al
          gg += src[o + 1] * al
          b += src[o + 2] * al
          a += al
        }
      }
      const o = (v * g.width + u) * 4
      if (a > 0) {
        dst[o] = r / a
        dst[o + 1] = gg / a
        dst[o + 2] = b / a
        dst[o + 3] = a
      }
    }
  }
  return out
}
