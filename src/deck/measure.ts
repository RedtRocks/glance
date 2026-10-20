/**
 * Measures designed slides' text in the browser, in the bundled fonts, the way html.ts
 * draws it, so text longer than the sample shrinks just enough (fitDesignText).
 */
import { DESIGN_SCALE, fontStack, type MeasureText } from '../core/deck/design'

let probe: HTMLSpanElement | null = null

export const measureDesignText: MeasureText = (t, line, size) => {
  if (typeof document === 'undefined') return line.length * size * t.charW
  if (!probe) {
    probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    document.body.append(probe)
  }
  // The same font settings as designTextStyle in html.ts.
  probe.style.cssText = [
    'position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre;pointer-events:none',
    `font-family:${fontStack(t.font)};font-size:${size}px;font-weight:${t.weight};font-style:${t.italic ? 'italic' : 'normal'}`,
    `font-optical-sizing:none;font-variation-settings:'opsz' ${Math.round((size / DESIGN_SCALE) * 10) / 10}`,
    `letter-spacing:${Math.round((t.letterSpacing / t.size) * 1000) / 1000}em`
  ].join(';')
  probe.textContent = line
  return probe.getBoundingClientRect().width
}
