import { describe, expect, it } from 'vitest'
import { isDoubleTap, isTap, pinchTranslate, scrollAfterZoom, swipeDirection, type PinchStart } from '../src/ui/touchGestures'

const start: PinchStart = {
  dist: 100,
  mid: { x: 200, y: 300 },
  scale: 1,
  scrollLeft: 50,
  scrollTop: 400,
  view: { x: 0, y: 100 },
  content: { x: -50, y: -300 }
}

describe('pinch zoom', () => {
  it('keeps the pinched point under the fingers while scaling', () => {
    const k = 2
    const d = pinchTranslate(start, start.mid, k)
    // The content point first under the fingers lands back under them.
    const p = { x: start.mid.x - start.content.x, y: start.mid.y - start.content.y }
    expect(start.content.x + d.x + p.x * k).toBeCloseTo(start.mid.x)
    expect(start.content.y + d.y + p.y * k).toBeCloseTo(start.mid.y)
    // and follows them when they move together.
    const moved = pinchTranslate(start, { x: 260, y: 280 }, k)
    expect(start.content.x + moved.x + p.x * k).toBeCloseTo(260)
  })

  it('does nothing at the starting size', () => {
    expect(pinchTranslate(start, start.mid, 1)).toEqual({ x: 0, y: 0 })
    expect(scrollAfterZoom(start, start.mid, 1)).toEqual({ x: start.scrollLeft, y: start.scrollTop })
  })

  it('scrolls so the same spot stays under the fingers after the zoom', () => {
    const s = scrollAfterZoom(start, start.mid, 2)
    // Point 250px into the content horizontally (50 scrolled + 200 in view) is at 500 at 2x.
    expect(s.x).toBe(500 - 200)
    expect(s.y).toBe((400 + 200) * 2 - 200)
  })
})

describe('taps and swipes', () => {
  it('tells a tap from a drag or a long press', () => {
    expect(isTap(3, -4, 120)).toBe(true)
    expect(isTap(30, 0, 120)).toBe(false)
    expect(isTap(0, 0, 800)).toBe(false)
  })

  it('pairs two quick, close taps into a double-tap', () => {
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 18, y: 14, t: 220 })).toBe(true)
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 18, y: 14, t: 450 })).toBe(false)
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 110, y: 10, t: 200 })).toBe(false)
  })

  it('turns a quick horizontal swipe into the next or previous page', () => {
    expect(swipeDirection(-120, 10, 200)).toBe(1)
    expect(swipeDirection(120, -20, 200)).toBe(-1)
    expect(swipeDirection(-40, 0, 200)).toBe(0) // too short
    expect(swipeDirection(-120, 90, 200)).toBe(0) // mostly vertical: a scroll
    expect(swipeDirection(-120, 0, 900)).toBe(0) // too slow: a drag
  })
})
