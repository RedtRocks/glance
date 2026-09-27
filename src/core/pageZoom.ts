/**
 * WebView2 only delivers touchpad pinches to the page (as Ctrl+wheel) when its own
 * zoom controls are on, which also turns on its Ctrl+wheel and Ctrl+=/−/0 page zoom.
 * Glance zooms documents itself, so those browser zooms are cancelled everywhere.
 */
type Key = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>

/** Keys that make WebView2 zoom the whole page: Ctrl with =, +, -, 0 or their numpad keys. */
export function isPageZoomKey(e: Key): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false
  return ['=', '+', '-', '_', '0'].includes(e.key) || ['NumpadAdd', 'NumpadSubtract', 'Numpad0', 'Equal', 'Minus', 'Digit0'].includes(e.code)
}
