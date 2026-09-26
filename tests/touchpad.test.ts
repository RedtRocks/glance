import { describe, expect, it } from 'vitest'
import { isTouchpad } from '../src/core/touchpad'

const wheel = (deltaX: number, deltaY: number, timeStamp: number, deltaMode = 0) => ({ deltaX, deltaY, timeStamp, deltaMode })

describe('touchpad detection', () => {
  it('tells mouse-wheel notches from touchpad scrolls and pinches', () => {
    expect(isTouchpad(wheel(0, 100, 0))).toBe(false)
    expect(isTouchpad(wheel(0, -120, 1000))).toBe(false)
    expect(isTouchpad(wheel(100, 0, 2000))).toBe(false) // Shift+wheel
    expect(isTouchpad(wheel(0, 3, 3000, 1))).toBe(false) // line mode
    expect(isTouchpad(wheel(0, 4, 4000))).toBe(true)
    expect(isTouchpad(wheel(0, -1.25, 5000))).toBe(true) // pinch
    expect(isTouchpad(wheel(60, 80, 6000))).toBe(true) // diagonal swipe
  })

  it('keeps a fast swipe classified as touchpad', () => {
    expect(isTouchpad(wheel(0, 8, 10000))).toBe(true)
    expect(isTouchpad(wheel(0, 120, 10016))).toBe(true)
    expect(isTouchpad(wheel(0, 120, 20000))).toBe(false)
  })
})
