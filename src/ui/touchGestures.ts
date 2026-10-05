import { useEffect } from 'preact/hooks'

/**
 * Touchscreen gestures for the scrolling document views (phones, tablets and touch
 * PCs): pinch to zoom about the fingers, double-tap to zoom in and back, and a
 * horizontal swipe to turn pages. One finger still scrolls natively.
 *
 * During a pinch the content is scaled with a CSS transform, which is cheap; the
 * real zoom (and the PDF re-render) happens once, when the fingers lift.
 */

export interface Point {
  x: number
  y: number
}

/** Where the pinch started, in client coordinates. */
export interface PinchStart {
  dist: number
  mid: Point
  scale: number
  scrollLeft: number
  scrollTop: number
  /** Top-left of the scroller and of the content being scaled. */
  view: Point
  content: Point
}

export const DOUBLE_TAP_MS = 300
const TAP_SLOP = 10
const DOUBLE_TAP_SLOP = 30
const SWIPE_MIN = 60
const SWIPE_MS = 500

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The translation that keeps the content point first under the fingers under them now, at `k` times the size. */
export function pinchTranslate(start: PinchStart, mid: Point, k: number): Point {
  return {
    x: mid.x - start.content.x - (start.mid.x - start.content.x) * k,
    y: mid.y - start.content.y - (start.mid.y - start.content.y) * k
  }
}

/** The scroll position after zooming by `ratio` that leaves the pinched point under `mid`. */
export function scrollAfterZoom(start: Pick<PinchStart, 'mid' | 'scrollLeft' | 'scrollTop' | 'view'>, mid: Point, ratio: number): Point {
  return {
    x: (start.scrollLeft + start.mid.x - start.view.x) * ratio - (mid.x - start.view.x),
    y: (start.scrollTop + start.mid.y - start.view.y) * ratio - (mid.y - start.view.y)
  }
}

/** 1 for a swipe to the left (next page), −1 to the right, 0 for anything else. */
export function swipeDirection(dx: number, dy: number, ms: number): 1 | -1 | 0 {
  if (ms > SWIPE_MS || Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 2) return 0
  return dx < 0 ? 1 : -1
}

export const isTap = (dx: number, dy: number, ms: number): boolean => Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP && ms < DOUBLE_TAP_MS

/** True when a tap at `b` follows the tap at `a` closely enough to make a double-tap. */
export const isDoubleTap = (a: Point & { t: number }, b: Point & { t: number }): boolean => b.t - a.t < DOUBLE_TAP_MS && distance(a, b) < DOUBLE_TAP_SLOP

export interface TouchZoomOptions {
  /** The element to scale while pinching (the scroller's content). */
  content: () => HTMLElement | null
  /** The scale now in effect. */
  scale: () => number
  /** Applies a new scale. */
  zoom: (scale: number) => void
  min: number
  max: number
  /** The scale a double-tap goes to, or null to go back to fitting the window. */
  doubleTap?: (scale: number) => number | null
  /** Back to fitting the window. */
  fit?: () => void
  /** A horizontal swipe while the content fits the width; 1 is towards the next page. */
  swipe?: (dir: 1 | -1) => void
  /** Double-tap and swipe only with the Select or Hand tool, so they never fight drawing. */
  tapsAllowed?: () => boolean
  /**
   * A selector that finds the page under a point again after the zoom, so the
   * same spot of that page stays under the fingers even though the gaps and
   * padding between pages don't scale. Without one the content scales evenly.
   */
  anchor?: (under: Element) => string | null
}

/** A spot on a page, as fractions of the page's size. */
interface Anchor {
  selector: string
  fx: number
  fy: number
}

const point = (t: Touch): Point => ({ x: t.clientX, y: t.clientY })

/** Pinch, double-tap and swipe on a scrolling view; see the top of this file. */
export function useTouchZoom(ref: { current: HTMLElement | null }, opts: TouchZoomOptions, deps: unknown[]): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let pinch: PinchStart | null = null
    let lastMid: Point = { x: 0, y: 0 }
    let k = 1
    let one: (Point & { t: number; scrollLeft: number; scrollTop: number }) | null = null
    let lastTap: (Point & { t: number }) | null = null

    const anchorAt = (p: Point): Anchor | null => {
      const under = document.elementFromPoint(p.x, p.y)
      const selector = under && el.contains(under) ? opts.anchor?.(under) : null
      const page = selector ? el.querySelector(selector) : null
      if (!selector || !page) return null
      const r = page.getBoundingClientRect()
      return { selector, fx: (p.x - r.left) / (r.width || 1), fy: (p.y - r.top) / (r.height || 1) }
    }

    const settle = (start: Pick<PinchStart, 'mid' | 'scrollLeft' | 'scrollTop' | 'view'>, mid: Point, ratio: number, anchor: Anchor | null): void => {
      // Wait for the new layout (and the PDF view's own scroll anchoring) before moving.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const page = anchor && el.querySelector(anchor.selector)
          if (anchor && page) {
            const r = page.getBoundingClientRect()
            el.scrollLeft += r.left + anchor.fx * r.width - mid.x
            el.scrollTop += r.top + anchor.fy * r.height - mid.y
            return
          }
          const s = scrollAfterZoom(start, mid, ratio)
          el.scrollLeft = s.x
          el.scrollTop = s.y
        })
      )
    }

    const begin = (a: Touch, b: Touch): void => {
      const content = opts.content()
      if (!content) return
      const v = el.getBoundingClientRect()
      const c = content.getBoundingClientRect()
      pinch = {
        dist: Math.max(1, distance(point(a), point(b))),
        mid: midpoint(point(a), point(b)),
        scale: opts.scale(),
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        view: { x: v.left, y: v.top },
        content: { x: c.left, y: c.top }
      }
      lastMid = pinch.mid
      k = 1
      content.style.transformOrigin = '0 0'
      content.style.willChange = 'transform'
      el.classList.add('pinching')
    }

    const end = (): void => {
      const start = pinch
      pinch = null
      el.classList.remove('pinching')
      // Measured while the pinch transform still shows the spot under the fingers.
      const anchor = start ? anchorAt(lastMid) : null
      const content = opts.content()
      if (content) {
        content.style.transform = ''
        content.style.willChange = ''
      }
      if (!start) return
      const next = clamp(start.scale * k, opts.min, opts.max)
      if (Math.abs(next - start.scale) < 0.005) return
      opts.zoom(next)
      settle(start, lastMid, next / start.scale, anchor)
    }

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        one = null
        begin(e.touches[0], e.touches[1])
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        one = { ...point(t), t: e.timeStamp, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
      } else {
        one = null
      }
    }

    const onMove = (e: TouchEvent): void => {
      if (!pinch || e.touches.length < 2) return
      // Not passive: this stops the browser scrolling or zooming the page itself.
      if (e.cancelable) e.preventDefault()
      const a = point(e.touches[0])
      const b = point(e.touches[1])
      const min = opts.min / pinch.scale
      const max = opts.max / pinch.scale
      k = clamp(distance(a, b) / pinch.dist, min, max)
      lastMid = midpoint(a, b)
      const d = pinchTranslate(pinch, lastMid, k)
      const content = opts.content()
      if (content) content.style.transform = `translate(${d.x}px, ${d.y}px) scale(${k})`
    }

    const onEnd = (e: TouchEvent): void => {
      if (pinch) {
        if (e.touches.length < 2) end()
        return
      }
      const start = one
      one = null
      if (!start || e.touches.length || !e.changedTouches.length) return
      if (opts.tapsAllowed && !opts.tapsAllowed()) return
      const p = point(e.changedTouches[0])
      const dx = p.x - start.x
      const dy = p.y - start.y
      const ms = e.timeStamp - start.t
      if (isTap(dx, dy, ms)) {
        const tap = { ...p, t: e.timeStamp }
        if (lastTap && opts.doubleTap && isDoubleTap(lastTap, tap)) {
          lastTap = null
          if (e.cancelable) e.preventDefault()
          const scale = opts.scale()
          const next = opts.doubleTap(scale)
          if (next === null) return opts.fit?.()
          const v = el.getBoundingClientRect()
          const anchor = anchorAt(p)
          const to = clamp(next, opts.min, opts.max)
          opts.zoom(to)
          settle({ mid: p, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, view: { x: v.left, y: v.top } }, p, to / scale, anchor)
        } else {
          lastTap = tap
        }
        return
      }
      lastTap = null
      // Only a page that fits the width turns: otherwise the swipe was a scroll.
      const fits = el.scrollWidth <= el.clientWidth + 1 && el.scrollLeft === start.scrollLeft
      const dir = swipeDirection(dx, dy, ms)
      if (dir && fits && opts.swipe) opts.swipe(dir)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: false })
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', end)
    }
  }, deps)
}

/**
 * Stops pinches zooming the whole app in browsers that ignore `touch-action`
 * (Safari's own gesture events); the document views zoom themselves instead.
 */
export function blockPageZoom(): void {
  const stop = (e: Event): void => e.preventDefault()
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false })
}
