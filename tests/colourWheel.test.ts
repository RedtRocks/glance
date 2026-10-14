import { describe, expect, it } from 'vitest'
import { dotAt, dotColour, dotFor, grainImage, harmonise, harmoniesFor, pointOf, safeAlpha, windowGradient } from '../src/core/colourWheel'
import { backdropFor, contrast, mix, themeVars } from '../src/core/theme'

describe('colour wheel', () => {
  it('reads hue clockwise from the top and saturation from the centre out', () => {
    expect(dotAt(100, 100, 200)).toEqual({ hue: 0, sat: 0 })
    expect(dotAt(100, 0, 200)).toEqual({ hue: 0, sat: 1 })
    expect(dotAt(200, 100, 200)).toEqual({ hue: 90, sat: 1 })
    expect(dotAt(100, 200, 200).hue).toBe(180)
  })

  it('snaps points past the rim onto it', () => {
    expect(dotAt(500, 100, 200)).toEqual({ hue: 90, sat: 1 })
  })

  it('draws a dot where it reads it back', () => {
    const p = pointOf({ hue: 225, sat: 0.6 }, 200)
    const back = dotAt(p.x, p.y, 200)
    expect(back.hue).toBe(225)
    expect(back.sat).toBeCloseTo(0.6, 5)
  })

  it('turns a dot into a colour and back', () => {
    expect(dotColour({ hue: 0, sat: 1 })).toBe('#ff1a1a')
    expect(dotColour({ hue: 0, sat: 0 })).toBe('#8c8c8c')
    const dot = dotFor(dotColour({ hue: 200, sat: 0.7 }))
    expect(dot.hue).toBeGreaterThanOrEqual(199)
    expect(dot.hue).toBeLessThanOrEqual(201)
    expect(dot.sat).toBeCloseTo(0.7, 1)
  })

  it('places the other dots by harmony, or leaves them free', () => {
    const first = { hue: 30, sat: 0.8 }
    expect(harmonise([first, { hue: 0, sat: 0 }], 'complementary')[1]).toEqual({ hue: 210, sat: 0.8 })
    expect(harmonise([first, first, first], 'triadic').map((d) => d.hue)).toEqual([30, 150, 270])
    const loose = [first, { hue: 99, sat: 0.1 }]
    expect(harmonise(loose, 'free')).toBe(loose)
  })

  it('offers harmonies that fit the number of dots', () => {
    expect(harmoniesFor(1)).toEqual(['free'])
    expect(harmoniesFor(2)).toContain('complementary')
    expect(harmoniesFor(3)).toContain('triadic')
  })
})

describe('window gradient', () => {
  it('paints nothing at zero strength or with no colours', () => {
    expect(windowGradient(['#6312f6'], 0)).toBe('')
    expect(windowGradient([], 1)).toBe('')
  })

  it('uses one layer per colour count', () => {
    expect(windowGradient(['#6312f6'], 1)).toMatch(/^linear-gradient\(rgba\(99, 18, 246, 0\.85\)/)
    expect(windowGradient(['#6312f6', '#f258a8'], 0.5)).toContain('135deg')
    expect(windowGradient(['#6312f6', '#f258a8', '#f47933'], 0.5).split('gradient(')).toHaveLength(4)
  })

  it('adds grain only when asked', () => {
    expect(grainImage(0)).toBe('')
    expect(grainImage(0.5)).toMatch(/^url\("data:image\/svg\+xml,/)
  })
})

describe('readable with any colour', () => {
  const looks = ['wollo', 'fluent'] as const
  const wheel = Array.from({ length: 12 }, (_, i) => [0.3, 0.7, 1].map((sat) => dotColour({ hue: i * 30, sat }))).flat()
  const colours = [...wheel, '#000000', '#ffffff', '#ffff00', '#0a0a0a', '#6312f6', '#f8d32c']

  for (const look of looks) {
    for (const dark of [false, true]) {
      const base = backdropFor(look, dark)
      it(`keeps muted text readable on window colours (${look}, ${dark ? 'dark' : 'light'})`, () => {
        for (const c of colours) {
          const a = safeAlpha(c, 0.85, base)
          expect(contrast(mix(base.bg, c, a), base.muted)).toBeGreaterThanOrEqual(4.5)
        }
      })
      it(`keeps tinted surfaces and the accent readable (${look}, ${dark ? 'dark' : 'light'})`, () => {
        for (const c of colours) {
          const v = themeVars({ accent: c, strength: 1, look, dark })
          for (const name of ['--bg-solid', '--chrome', '--canvas']) {
            const surface = v[name] ?? base.bg
            expect(contrast(surface, base.muted)).toBeGreaterThanOrEqual(4.5)
            expect(contrast(v['--accent'], surface)).toBeGreaterThanOrEqual(2.9)
          }
        }
      })
    }
  }
})
