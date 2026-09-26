import { stepZoom, ZOOM_STEPS } from '../state/commands'
import { isTouchpad } from '../core/touchpad'

/** The zoom after a Ctrl+wheel: smooth for a touchpad pinch, one step per mouse-wheel notch. */
export function wheelZoom(current: number, e: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'timeStamp'>): number {
  if (!isTouchpad(e)) return stepZoom(current, e.deltaY < 0 ? 1 : -1)
  const next = current * Math.exp(-e.deltaY * 0.01)
  return Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0], next))
}
