import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE,
  bounds,
  hitTest,
  outlinePath,
  pageMaps,
  recognizeSketch,
  remapPages,
  resize,
  translate,
  type Markup,
  type Pt
} from '../src/core/markup'

const base = { id: 'm1', page: 0, style: DEFAULT_STYLE, created: 0 }

describe('markup geometry', () => {
  it('translates and resizes shapes', () => {
    const r: Markup = { ...base, type: 'rect', rect: [10, 10, 30, 20] }
    expect(bounds(translate(r, 5, -5))).toEqual([15, 5, 35, 15])
    expect(bounds(resize(r, [10, 10, 30, 20], [10, 10, 50, 40]))).toEqual([10, 10, 50, 40])
    const ink: Markup = { ...base, type: 'ink', strokes: [[[0, 0], [10, 10]]] }
    expect(bounds(resize(ink, [0, 0, 10, 10], [0, 0, 20, 5]))).toEqual([0, 0, 20, 5])
  })

  it('only grabs unfilled shapes near their outline', () => {
    const r: Markup = { ...base, type: 'rect', rect: [0, 0, 100, 100] }
    expect(hitTest(r, [1, 50], 3)).toBe(true)
    expect(hitTest(r, [50, 50], 3)).toBe(false)
    expect(hitTest({ ...r, style: { ...r.style, fill: [1, 1, 1] } }, [50, 50], 3)).toBe(true)
    const line: Markup = { ...base, type: 'arrow', from: [0, 0], to: [100, 0] }
    expect(hitTest(line, [50, 2], 2)).toBe(true)
    expect(hitTest(line, [50, 20], 2)).toBe(false)
  })

  it('produces closed outlines for every shape kind', () => {
    for (const type of ['rect', 'roundRect', 'oval', 'star', 'bubble'] as const) {
      const d = outlinePath({ ...base, type, rect: [0, 0, 40, 30] })
      expect(d.startsWith('M')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
    }
  })
})

describe('page remapping keeps markup on its page', () => {
  const items = [0, 1, 2, 3].map((page) => ({ page, id: String(page) }))
  it('follows reorders', () => {
    // New order: old pages 3, 0, 1, 2
    expect(remapPages(items, pageMaps.reorder([3, 0, 1, 2])).map((i) => [i.id, i.page])).toEqual([
      ['0', 1],
      ['1', 2],
      ['2', 3],
      ['3', 0]
    ])
  })
  it('drops markup on deleted pages and shifts the rest', () => {
    expect(remapPages(items, pageMaps.delete([1, 2])).map((i) => [i.id, i.page])).toEqual([
      ['0', 0],
      ['3', 1]
    ])
  })
  it('shifts after inserted pages', () => {
    expect(remapPages(items, pageMaps.insert(2, 3)).map((i) => i.page)).toEqual([0, 1, 5, 6])
  })
})

describe('sketch recognition', () => {
  const noisy = (pts: Pt[]): Pt[] => pts.map(([x, y], i) => [x + Math.sin(i * 1.7) * 1.2, y + Math.cos(i * 2.3) * 1.2])
  it('recognizes a wobbly line', () => {
    const pts = noisy(Array.from({ length: 30 }, (_, i) => [i * 5, i * 2] as Pt))
    expect(recognizeSketch(pts)?.type).toBe('line')
  })
  it('recognizes a rough circle as an oval', () => {
    const pts = noisy(Array.from({ length: 60 }, (_, i) => [100 + 50 * Math.cos((i / 58) * Math.PI * 2), 100 + 35 * Math.sin((i / 58) * Math.PI * 2)] as Pt))
    expect(recognizeSketch(pts)?.type).toBe('oval')
  })
  it('recognizes a hand-drawn rectangle', () => {
    const side = (a: Pt, b: Pt): Pt[] => Array.from({ length: 15 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 15, a[1] + ((b[1] - a[1]) * i) / 15] as Pt)
    const pts = noisy([...side([0, 0], [120, 0]), ...side([120, 0], [120, 80]), ...side([120, 80], [0, 80]), ...side([0, 80], [0, 2])])
    expect(recognizeSketch(pts)?.type).toBe('rect')
  })
  it('leaves a scribble alone', () => {
    const pts = Array.from({ length: 40 }, (_, i) => [i * 3, (i % 4) * 25] as Pt)
    expect(recognizeSketch(pts)).toBeNull()
  })
})
