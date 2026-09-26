import { describe, expect, it } from 'vitest'
import { layoutCollage } from '../src/core/image/collage'

const photos = [
  { width: 4000, height: 3000 },
  { width: 3000, height: 4000 },
  { width: 1920, height: 1080 },
  { width: 1000, height: 1000 },
  { width: 800, height: 600 }
]

describe('collage layout', () => {
  it('justified rows keep aspect ratios and fill the width', () => {
    const { placements, height } = layoutCollage(photos, { layout: 'rows', width: 2000, gap: 20 })
    expect(placements).toHaveLength(5)
    for (const [k, p] of placements.entries()) {
      expect(Math.abs(p.w / p.h - photos[k].width / photos[k].height)).toBeLessThan(0.02)
      expect(p.x + p.w).toBeLessThanOrEqual(2000 - 20 + 2)
    }
    // Full rows reach the right edge (within rounding).
    const firstRowY = placements[0].y
    const firstRow = placements.filter((p) => p.y === firstRowY)
    const last = firstRow[firstRow.length - 1]
    expect(Math.abs(last.x + last.w - (2000 - 20))).toBeLessThanOrEqual(3)
    expect(height).toBeGreaterThan(0)
  })

  it('grid crops every photo to the same cell without distorting it', () => {
    const { placements } = layoutCollage(photos, { layout: 'grid', width: 1200, gap: 10, columns: 3 })
    const { w, h } = placements[0]
    for (const [k, p] of placements.entries()) {
      expect([p.w, p.h]).toEqual([w, h])
      expect(p.sw / p.sh).toBeCloseTo(w / h, 1)
      expect(p.sw).toBeLessThanOrEqual(photos[k].width + 1e-6)
      expect(p.sh).toBeLessThanOrEqual(photos[k].height + 1e-6)
    }
    expect(placements[3].y).toBeGreaterThan(placements[0].y) // wraps after 3 columns
  })

  it('handles no photos', () => {
    expect(layoutCollage([], { layout: 'rows', width: 100, gap: 0 }).placements).toEqual([])
  })
})
