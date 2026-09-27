import { describe, expect, it } from 'vitest'
import { DEFAULT_ADJUST, applyAdjust, autoLevels, histogram, isIdentity } from '../src/core/image/adjust'
import { applyMask, featherMask, floodMask, maskBounds, refineMatte, resizeMask } from '../src/core/image/alpha'
import { polygonMask, selectionMask, smartLassoMask } from '../src/core/image/select'
import { crop, flip, rotate90 } from '../src/core/image/transform'
import { fitInto, fromPixels, proportional, toPixels } from '../src/core/image/size'
import { burnRedactions, raster, redactionBox, type Raster } from '../src/core/image/raster'

function fill(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster {
  const r = raster(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) r.data.set(f(x, y), (y * w + x) * 4)
  return r
}
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)]

describe('adjust color', () => {
  it('is a no-op at defaults', () => {
    const img = fill(4, 4, (x, y) => [x * 40, y * 40, 100, 255])
    const before = [...img.data]
    applyAdjust(img, { ...DEFAULT_ADJUST })
    expect([...img.data]).toEqual(before)
    expect(isIdentity(DEFAULT_ADJUST)).toBe(true)
  })
  it('exposure +1 stop doubles midtones', () => {
    const img = fill(1, 1, () => [60, 60, 60, 255])
    applyAdjust(img, { ...DEFAULT_ADJUST, exposure: 1 })
    expect(px(img, 0, 0)[0]).toBeGreaterThanOrEqual(118)
    expect(px(img, 0, 0)[0]).toBeLessThanOrEqual(122)
  })
  it('saturation -1 produces grayscale, alpha untouched', () => {
    const img = fill(1, 1, () => [200, 50, 20, 77])
    applyAdjust(img, { ...DEFAULT_ADJUST, saturation: -1 })
    const [r, g, b, a] = px(img, 0, 0)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1)
    expect(a).toBe(77)
  })
  it('warmer temperature raises red and lowers blue', () => {
    const img = fill(1, 1, () => [128, 128, 128, 255])
    applyAdjust(img, { ...DEFAULT_ADJUST, temperature: 1 })
    const [r, , b] = px(img, 0, 0)
    expect(r).toBeGreaterThan(140)
    expect(b).toBeLessThan(116)
  })
  it('auto levels stretches a low-contrast image', () => {
    const img = fill(100, 1, (x) => [80 + x, 80 + x, 80 + x, 255])
    const lv = autoLevels(histogram(img))
    expect(lv.black).toBeGreaterThanOrEqual(79)
    expect(lv.white).toBeLessThanOrEqual(180)
    applyAdjust(img, { ...DEFAULT_ADJUST, ...lv })
    expect(px(img, 0, 0)[0]).toBeLessThan(10)
    expect(px(img, 99, 0)[0]).toBeGreaterThan(245)
  })
})

describe('instant alpha', () => {
  // White background with a red square in the middle.
  const scene = () => fill(20, 20, (x, y) => (x >= 5 && x < 15 && y >= 5 && y < 15 ? [220, 30, 30, 255] : [250, 250, 250, 255]))
  it('selects the contiguous background but not the subject', () => {
    const m = floodMask(scene(), 0, 0, 0.1)
    expect(m[0]).toBe(255)
    expect(m[10 * 20 + 10]).toBe(0)
    expect(m.filter((v) => v).length).toBe(400 - 100)
  })
  it('wider tolerance swallows similar colors', () => {
    const img = fill(10, 1, (x) => [200 + x * 5, 200, 200, 255])
    expect(floodMask(img, 0, 0, 0.02).filter((v) => v).length).toBeLessThan(10)
    expect(floodMask(img, 0, 0, 0.2).filter((v) => v).length).toBe(10)
  })
  it('erasing leaves the subject opaque and bounds find it', () => {
    const img = scene()
    applyMask(img, floodMask(img, 0, 0, 0.1), 'erase')
    expect(px(img, 0, 0)[3]).toBe(0)
    expect(px(img, 10, 10)[3]).toBe(255)
    const alpha = new Uint8Array(400).map((_, i) => img.data[i * 4 + 3])
    expect(maskBounds(alpha, 20, 20)).toEqual({ x: 5, y: 5, width: 10, height: 10 })
  })
  it('feathering softens only the edge', () => {
    const m = new Uint8Array(100)
    for (let i = 0; i < 50; i++) m[i] = 255
    const f = featherMask(m, 10, 10, 1)
    expect(f[0]).toBe(255)
    expect(f[99]).toBe(0)
    expect(f[45]).toBeGreaterThan(0)
    expect(f[45]).toBeLessThan(255)
  })
  it('upscales and refines a model matte', () => {
    const small = new Uint8Array([0, 255, 0, 255])
    const big = resizeMask(small, 2, 2, 8, 8)
    expect(big.length).toBe(64)
    expect(refineMatte(new Uint8Array([10, 128, 250]))).toEqual(new Uint8Array([0, 128, 255]))
  })
})

describe('selections', () => {
  it('fills a polygon (lasso)', () => {
    const m = polygonMask([[0, 0], [10, 0], [10, 10], [0, 10]], 10, 10)
    expect(m.every((v) => v === 255)).toBe(true)
    const tri = polygonMask([[0, 0], [10, 0], [0, 10]], 10, 10)
    expect(tri[0]).toBe(255)
    expect(tri[99]).toBe(0)
  })
  it('ellipse excludes the corners', () => {
    const m = selectionMask({ kind: 'ellipse', x: 0, y: 0, width: 10, height: 10 }, raster(10, 10))
    expect(m[0]).toBe(0)
    expect(m[5 * 10 + 5]).toBe(255)
  })
  it('smart lasso snaps a loose outline to the object edge', () => {
    // Dark disk on light background; lasso drawn loosely around it.
    const img = fill(60, 60, (x, y) => (Math.hypot(x - 30, y - 30) < 15 ? [30, 30, 40, 255] : [230, 230, 220, 255]))
    const loose: [number, number][] = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2
      return [30 + 21 * Math.cos(a), 30 + 21 * Math.sin(a)]
    })
    const m = smartLassoMask(img, loose, 9)
    expect(m[30 * 60 + 30]).toBe(255)
    expect(m[30 * 60 + 49]).toBe(0) // inside the loose outline but background: dropped
    expect(m[30 * 60 + 43]).toBe(255) // edge of the disk: kept
  })
})

describe('transforms', () => {
  const img = fill(3, 2, (x, y) => [x, y, 0, 255])
  it('rotates both ways', () => {
    const cw = rotate90(img, true)
    expect([cw.width, cw.height]).toEqual([2, 3])
    expect(px(cw, 1, 0).slice(0, 2)).toEqual([0, 0]) // old top-left → top-right
    const back = rotate90(cw, false)
    expect([...back.data]).toEqual([...img.data])
  })
  it('flips', () => {
    expect(px(flip(img, 'horizontal'), 0, 0)[0]).toBe(2)
    expect(px(flip(img, 'vertical'), 0, 0)[1]).toBe(1)
  })
  it('crops', () => {
    const c = crop(img, { x: 1, y: 1, width: 2, height: 1 })
    expect([c.width, c.height]).toEqual([2, 1])
    expect(px(c, 0, 0).slice(0, 2)).toEqual([1, 1])
  })
})

describe('adjust size', () => {
  it('converts units at a resolution', () => {
    expect(toPixels(2, 'in', 300, 0)).toBe(600)
    expect(toPixels(50, 'percent', 72, 1000)).toBe(500)
    expect(Math.round(toPixels(2.54, 'cm', 100, 0))).toBe(100)
    expect(fromPixels(600, 'in', 300, 0)).toBe(2)
  })
  it('fits into presets without enlarging', () => {
    expect(fitInto(4000, 3000, 1920, 1080)).toEqual([1440, 1080])
    expect(fitInto(800, 600, 1920, 1080)).toEqual([800, 600])
    expect(proportional(2000, 4000, 3000)).toBe(1500)
  })
})

describe('definition', () => {
  // Left half 100, right half 150: a soft mid-scale edge.
  const edge = () => {
    const w = 200
    const h = 100
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const v = i % w < w / 2 ? 100 : 150
      data.set([v, v, v, 255], i * 4)
    }
    return { width: w, height: h, data }
  }
  const at = (img: { width: number; data: Uint8ClampedArray }, x: number, y = 50) => img.data[(y * img.width + x) * 4]

  it('raises local contrast across an edge and leaves flat areas alone', () => {
    const img = edge()
    applyAdjust(img, { ...DEFAULT_ADJUST, definition: 1 })
    expect(at(img, 97)).toBeLessThan(100)
    expect(at(img, 102)).toBeGreaterThan(150)
    expect(at(img, 10)).toBe(100)
    expect(at(img, 190)).toBe(150)
  })

  it('negative definition softens the edge', () => {
    const img = edge()
    applyAdjust(img, { ...DEFAULT_ADJUST, definition: -1 })
    expect(at(img, 97)).toBeGreaterThan(100)
    expect(at(img, 102)).toBeLessThan(150)
  })
})

describe('image redaction', () => {
  it('paints the area opaque black in a copy, leaving the rest alone', () => {
    const img = fill(6, 4, (x, y) => [200, x * 10, y * 10, 128])
    // y-up markup space: rows 1..2 from the bottom are image rows 1..2 from the top of a 4-high image.
    const out = burnRedactions(img, [[1, 1, 3, 3]])
    expect(px(out, 1, 1)).toEqual([0, 0, 0, 255])
    expect(px(out, 2, 2)).toEqual([0, 0, 0, 255])
    expect(px(out, 0, 1)).toEqual([200, 0, 10, 128])
    expect(px(out, 3, 1)).toEqual([200, 30, 10, 128])
    expect(px(out, 1, 0)).toEqual([200, 10, 0, 128])
    expect(px(out, 1, 3)).toEqual([200, 10, 30, 128])
    expect(px(img, 1, 1)).toEqual([200, 10, 10, 128])
  })

  it('covers partly covered edge pixels and clips to the image', () => {
    expect(redactionBox([0.5, 0.5, 2.2, 1.1], 10, 10)).toEqual({ x: 0, y: 8, width: 3, height: 2 })
    expect(redactionBox([-5, -5, 20, 20], 4, 4)).toEqual({ x: 0, y: 0, width: 4, height: 4 })
    expect(redactionBox([3, 1, 1, 3], 4, 4)).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    expect(redactionBox([10, 10, 12, 12], 4, 4)).toBeNull()
  })
})
