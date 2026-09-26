/** Selections (rectangle, ellipse, lasso, smart lasso) rasterized to masks. */
import type { Raster } from './raster'

export type Pt = [number, number]

export type Selection =
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'lasso'; points: Pt[] }
  | { kind: 'smart'; points: Pt[]; band: number }

export function selectionBounds(s: Selection): { x: number; y: number; width: number; height: number } {
  if (s.kind === 'rect' || s.kind === 'ellipse') return { x: s.x, y: s.y, width: s.width, height: s.height }
  const xs = s.points.map((p) => p[0])
  const ys = s.points.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Even-odd scanline fill of a polygon. */
export function polygonMask(points: Pt[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h)
  if (points.length < 3) return mask
  const xs: number[] = []
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5
    xs.length = 0
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[j]
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5))
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = from; x <= to; x++) mask[y * w + x] = 255
    }
  }
  return mask
}

/** Square structuring-element erosion/dilation (separable running min/max). */
function morph(mask: Uint8Array, w: number, h: number, r: number, op: 'min' | 'max'): Uint8Array {
  const pick = op === 'min' ? Math.min : Math.max
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = mask[y * w + x]
      for (let d = -r; d <= r; d++) v = pick(v, mask[y * w + Math.min(w - 1, Math.max(0, x + d))])
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let d = -r; d <= r; d++) v = pick(v, tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x])
      out[y * w + x] = v
    }
  return out
}

/**
 * Smart lasso: the user's loose outline is a band; inside the band each pixel joins
 * the selection if its color is closer to the region inside the outline than to
 * the surroundings, so the edge snaps to the object.
 */
export function smartLassoMask(img: Raster, points: Pt[], band: number): Uint8Array {
  const { width: w, height: h, data } = img
  const inside = polygonMask(points, w, h)
  const r = Math.max(1, Math.round(band))
  const core = morph(inside, w, h, r, 'min')
  const outer = morph(inside, w, h, r, 'max')
  const mean = (sel: (i: number) => boolean): [number, number, number] => {
    let n = 0
    const s = [0, 0, 0]
    for (let i = 0; i < w * h; i++)
      if (sel(i)) {
        n++
        s[0] += data[i * 4]
        s[1] += data[i * 4 + 1]
        s[2] += data[i * 4 + 2]
      }
    return n ? [s[0] / n, s[1] / n, s[2] / n] : [0, 0, 0]
  }
  const fg = mean((i) => core[i] > 0)
  const bg = mean((i) => outer[i] > 0 && inside[i] === 0)
  const out = new Uint8Array(core)
  for (let i = 0; i < w * h; i++) {
    if (core[i] || !outer[i]) continue
    const p = i * 4
    const df = (data[p] - fg[0]) ** 2 + (data[p + 1] - fg[1]) ** 2 + (data[p + 2] - fg[2]) ** 2
    const db = (data[p] - bg[0]) ** 2 + (data[p + 1] - bg[1]) ** 2 + (data[p + 2] - bg[2]) ** 2
    out[i] = df <= db ? 255 : 0
  }
  return out
}

export function selectionMask(s: Selection, img: Raster): Uint8Array {
  const { width: w, height: h } = img
  switch (s.kind) {
    case 'rect': {
      const m = new Uint8Array(w * h)
      const x1 = Math.max(0, Math.round(s.x))
      const y1 = Math.max(0, Math.round(s.y))
      const x2 = Math.min(w, Math.round(s.x + s.width))
      const y2 = Math.min(h, Math.round(s.y + s.height))
      for (let y = y1; y < y2; y++) m.fill(255, y * w + x1, y * w + x2)
      return m
    }
    case 'ellipse': {
      const m = new Uint8Array(w * h)
      const cx = s.x + s.width / 2
      const cy = s.y + s.height / 2
      const rx = s.width / 2
      const ry = s.height / 2
      if (rx <= 0 || ry <= 0) return m
      for (let y = Math.max(0, Math.floor(s.y)); y < Math.min(h, Math.ceil(s.y + s.height)); y++)
        for (let x = Math.max(0, Math.floor(s.x)); x < Math.min(w, Math.ceil(s.x + s.width)); x++)
          if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) m[y * w + x] = 255
      return m
    }
    case 'lasso':
      return polygonMask(s.points, w, h)
    case 'smart':
      return smartLassoMask(img, s.points, s.band)
  }
}
