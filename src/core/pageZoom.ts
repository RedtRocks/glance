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

/**
 * Keys that make WebView2 reload Glance's own page (F5, Ctrl+R, and their Shift/Ctrl
 * variants). A reload throws away open documents, so the desktop app cancels them;
 * Ctrl+R still reaches Glance's own commands.
 */
export function isPageReloadKey(e: Key): boolean {
  if (e.altKey) return false
  if (e.key === 'F5' || e.code === 'F5' || e.key === 'BrowserRefresh') return true
  return (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR')
}
