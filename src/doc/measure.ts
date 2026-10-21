/**
 * Measures document text in the browser, in the bundled fonts, set as html.ts draws it,
 * so lines break where they will be drawn. Widths are cached per font and text, since a
 * long document measures the same words many times.
 */
import { fontStack } from '../core/deck/design'
import { estimate, type Measure } from '../core/doc/layout'

let probe: HTMLSpanElement | null = null
const cache = new Map<string, number>()

export const measureDocText: Measure = (f, text) => {
  if (typeof document === 'undefined') return estimate(f, text)
  const key = `${f.font}|${f.size}|${f.weight}|${f.italic}|${f.letterSpacing}|${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (!probe) {
    probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    document.body.append(probe)
  }
  probe.style.cssText = [
    'position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre;pointer-events:none',
    `font-family:${fontStack(f.font)};font-size:${f.size}px;font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'}`,
    `font-optical-sizing:none;font-variation-settings:'opsz' ${Math.round(f.size * 10) / 10}`,
    f.letterSpacing ? `letter-spacing:${f.letterSpacing}px` : ''
  ].join(';')
  probe.textContent = text
  const w = probe.getBoundingClientRect().width
  if (cache.size > 50000) cache.clear()
  cache.set(key, w)
  return w
}

/** Forgets measured widths, once fonts have loaded and widths change. */
export const clearMeasures = () => cache.clear()
