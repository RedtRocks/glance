type Wheel = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'timeStamp'>

let lastTouchpad = -Infinity

/**
 * True for wheel events from a precision touchpad (two-finger scroll or pinch)
 * rather than a mouse wheel. Touchpads send small or fractional pixel deltas,
 * often on both axes at once; a mouse wheel sends whole notches (100 or 120 px)
 * on one axis. Once a gesture reads as touchpad, the rest of it does too, so fast
 * swipes with big deltas aren't mistaken for wheel notches.
 */
export function isTouchpad(e: Wheel): boolean {
  if (e.deltaMode !== 0) return false
  const { deltaX: dx, deltaY: dy } = e
  const mag = Math.max(Math.abs(dx), Math.abs(dy))
  const touchpadLike = !Number.isInteger(dx) || !Number.isInteger(dy) || (mag > 0 && mag < 50) || (dx !== 0 && dy !== 0)
  if (touchpadLike || e.timeStamp - lastTouchpad < 250) {
    lastTouchpad = e.timeStamp
    return true
  }
  return false
}

/**
 * How much a touchpad pinch (a Ctrl+wheel event) scales the view distance: below 1
 * zooms in. Matches Chromium's pinch deltas, where a 2x pinch sums to about -69.
 */
export function pinchScale(deltaY: number): number {
  return Math.min(2, Math.max(0.5, Math.exp(deltaY * 0.01)))
}
