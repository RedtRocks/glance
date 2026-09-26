import { describe, expect, it } from 'vitest'
import { applyAffine, flipAffine, rotate90, rotate90Affine, rotateAny, straightenGeometry } from '../src/core/image/transform'
import { raster, type Raster } from '../src/core/image/raster'
import { DEFAULT_STYLE, transformForImage, type Markup, type Redaction } from '../src/core/markup'

function fill(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster {
  const r = raster(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) r.data.set(f(x, y), (y * w + x) * 4)
  return r
}
const alpha = (r: Raster, x: number, y: number): number => r.data[(y * r.width + x) * 4 + 3]
const base = { id: 'm1', page: 0, style: DEFAULT_STYLE, created: 0 }

describe('straighten geometry', () => {
  it('keeps the size at 0° and matches a quarter turn at 90°', () => {
    expect(straightenGeometry(120, 80, 0, true)).toMatchObject({ width: 120, height: 80 })
    expect(straightenGeometry(120, 80, 0, false)).toMatchObject({ width: 120, height: 80 })
    expect(straightenGeometry(120, 80, 90, false)).toMatchObject({ width: 80, height: 120 })
  })

  it('crops to the largest same-shape rectangle', () => {
    // A square turned 45° holds a centered square of side s/√2.
    expect(straightenGeometry(100, 100, 45, true)).toMatchObject({ width: 70, height: 70 })
    const g = straightenGeometry(400, 300, 5, true)
    expect(g.width / g.height).toBeCloseTo(4 / 3, 1)
    expect(g.width).toBeLessThan(400)
  })

  it('never leaves an empty corner when cropping', () => {
    for (const [w, h] of [[400, 300], [300, 400], [1000, 50], [7, 5]])
      for (const deg of [-45, -12.3, -0.4, 0.1, 3, 17.5, 45]) {
        const g = straightenGeometry(w, h, deg, true)
        const t = (deg * Math.PI) / 180
        const [, , , , e, f] = g.map
        // Each result corner, mapped back into the source, lands inside it.
        for (const [x, y] of [[0, 0], [g.width, 0], [0, g.height], [g.width, g.height]]) {
          const sx = Math.cos(t) * (x - e) + Math.sin(t) * (y - f)
          const sy = -Math.sin(t) * (x - e) + Math.cos(t) * (y - f)
          expect(sx).toBeGreaterThanOrEqual(-1e-6)
          expect(sy).toBeGreaterThanOrEqual(-1e-6)
          expect(sx).toBeLessThanOrEqual(w + 1e-6)
          expect(sy).toBeLessThanOrEqual(h + 1e-6)
        }
      }
  })

  it('maps the source center to the result center', () => {
    const g = straightenGeometry(300, 200, 20, false)
    const [x, y] = applyAffine(g.map, 150, 100)
    expect(x).toBeCloseTo(g.width / 2)
    expect(y).toBeCloseTo(g.height / 2)
  })
})

describe('rotate by any angle', () => {
  it('turns clockwise for positive angles', () => {
    // Red top row; after a clockwise quarter turn it's the right-hand column.
    const img = fill(6, 4, (_x, y) => (y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]))
    const out = rotateAny(img, 90, false)
    expect([out.width, out.height]).toEqual([4, 6])
    const q = rotate90(img, true)
    for (let i = 0; i < out.data.length; i++) expect(Math.abs(out.data[i] - q.data[i])).toBeLessThanOrEqual(1)
  })

  it('fills every pixel when cropping, leaves corners clear when not', () => {
    const img = fill(60, 40, (x, y) => [x * 4, y * 6, 128, 255])
    const cropped = rotateAny(img, 13, true)
    for (let y = 0; y < cropped.height; y++)
      for (let x = 0; x < cropped.width; x++) expect(alpha(cropped, x, y)).toBe(255)
    const whole = rotateAny(img, 13, false)
    expect(whole.width).toBeGreaterThan(60)
    expect(alpha(whole, 0, 0)).toBe(0)
    expect(alpha(whole, whole.width >> 1, whole.height >> 1)).toBe(255)
  })

  it('is lossless at 0°', () => {
    const img = fill(9, 7, (x, y) => [x * 20, y * 30, 7, 200])
    expect([...rotateAny(img, 0, true).data]).toEqual([...img.data])
  })

  it('does not darken edges of transparent images', () => {
    const img = fill(20, 20, (x) => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const out = rotateAny(img, 10, false)
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3] > 0) expect(out.data[i]).toBeGreaterThanOrEqual(254)
  })
})

describe('markup follows image transforms', () => {
  const size = { width: 100, height: 50 }
  const turned = { width: 50, height: 100 }

  it('moves points exactly with a quarter turn', () => {
    // Markup is y-up: pixel (10, 10) is markup (10, 40). Clockwise it lands on pixel (40, 10), markup (40, 90).
    const line: Markup = { ...base, type: 'line', from: [10, 40], to: [20, 40] }
    const out = transformForImage([line], [], rotate90Affine(100, 50, true), size, turned).markup[0]
    expect(out.type === 'line' && out.from.map((v) => Math.round(v))).toEqual([40, 90])
    expect(out.type === 'line' && out.to.map((v) => Math.round(v))).toEqual([40, 80])
  })

  it('turns boxes, but keeps text and signatures upright', () => {
    const rect: Markup = { ...base, type: 'rect', rect: [10, 10, 30, 20] }
    const text: Markup = { ...base, id: 't', type: 'text', rect: [10, 10, 60, 20], text: 'Hi', fontSize: 12, color: [0, 0, 0] }
    const [r, t] = transformForImage([rect, text], [], rotate90Affine(100, 50, false), size, turned).markup
    const w = (m: Markup) => (m.type === 'rect' || m.type === 'text' ? m.rect[2] - m.rect[0] : NaN)
    const hgt = (m: Markup) => (m.type === 'rect' || m.type === 'text' ? m.rect[3] - m.rect[1] : NaN)
    expect([w(r), hgt(r)].map(Math.round)).toEqual([10, 20])
    expect([w(t), hgt(t)].map(Math.round)).toEqual([50, 10])
  })

  it('mirrors arrows on flip', () => {
    const arrow: Markup = { ...base, type: 'arrow', from: [10, 25], to: [30, 25] }
    const out = transformForImage([arrow], [], flipAffine(100, 50, 'horizontal'), size, size).markup[0]
    expect(out.type === 'arrow' && [out.from[0], out.to[0]]).toEqual([90, 70])
  })

  it('grows redactions to cover what they hid after straightening', () => {
    const red: Redaction = { id: 'r', page: 0, rect: [40, 20, 60, 30] }
    const g = straightenGeometry(100, 50, 20, false)
    const out = transformForImage([], [red], g.map, size, g).redactions[0]
    // The redaction's corners, turned, must all sit inside the new rect.
    for (const [x, yUp] of [[40, 20], [60, 20], [40, 30], [60, 30]]) {
      const [px, py] = applyAffine(g.map, x, 50 - yUp)
      const my = g.height - py
      expect(px).toBeGreaterThanOrEqual(out.rect[0])
      expect(px).toBeLessThanOrEqual(out.rect[2])
      expect(my).toBeGreaterThanOrEqual(out.rect[1])
      expect(my).toBeLessThanOrEqual(out.rect[3])
    }
  })

  it('drops markup left outside after a crop and scales with a resize', () => {
    const inside: Markup = { ...base, type: 'rect', rect: [10, 10, 20, 20] }
    const outside: Markup = { ...base, id: 'o', type: 'rect', rect: [80, 30, 90, 40] }
    // Crop to pixels x 0..40, y 20..50 (markup y 0..30).
    const cropped = transformForImage([inside, outside], [], [1, 0, 0, 1, 0, -20], size, { width: 40, height: 30 }).markup
    expect(cropped.map((m) => m.id)).toEqual(['m1'])
    const text: Markup = { ...base, type: 'text', rect: [10, 10, 60, 20], text: 'Hi', fontSize: 12, color: [0, 0, 0] }
    const big = transformForImage([text], [], [2, 0, 0, 2, 0, 0], size, { width: 200, height: 100 }).markup[0]
    expect(big.type === 'text' && [big.fontSize, big.style.width]).toEqual([24, DEFAULT_STYLE.width * 2])
  })
})
