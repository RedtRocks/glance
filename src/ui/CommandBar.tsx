import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { activeId } from '../state/documents'
import { MenuBar } from './MenuBar'
import { Toolbar } from './Toolbar'

/** How far the menu bar and toolbar run past the bar's inner edge, in px (0 when they fit). */
function overrun(bar: HTMLElement): number {
  const style = getComputedStyle(bar)
  const edge = bar.getBoundingClientRect().right - parseFloat(style.paddingRight)
  let right = 0
  for (const item of bar.querySelectorAll<HTMLElement>('.menubar-entry, .tb-item')) {
    if (item.offsetParent) right = Math.max(right, item.getBoundingClientRect().right)
  }
  return Math.max(0, Math.ceil(right - edge))
}

/**
 * The menu bar and toolbar on one line, or on two when a narrow window (or side tabs, or a
 * long custom toolbar) leaves too little room, so More and the last buttons never fall off
 * the end.
 */
export function CommandBar() {
  const ref = useRef<HTMLDivElement>(null)
  const [wrapped, setWrapped] = useState(false)
  // The bar width that fits everything on one line, learned when it last overran.
  const need = useRef(0)

  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar) return
    const check = (): void => {
      if (bar.classList.contains('wrapped')) {
        if (bar.clientWidth >= need.current) setWrapped(false)
        return
      }
      const over = overrun(bar)
      if (over > 0) {
        need.current = bar.clientWidth + over
        setWrapped(true)
      }
    }
    // Resizing the window, and buttons coming and going (a customised toolbar, a page count).
    const resized = new ResizeObserver(check)
    resized.observe(bar)
    const changed = new MutationObserver(check)
    changed.observe(bar, { childList: true, subtree: true })
    check()
    return () => {
      resized.disconnect()
      changed.disconnect()
    }
  }, [])

  // Another file has other buttons: try one line again and let the check decide.
  useLayoutEffect(() => {
    need.current = 0
    setWrapped(false)
  }, [activeId.value])
  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar || wrapped) return
    const over = overrun(bar)
    if (over > 0) {
      need.current = bar.clientWidth + over
      setWrapped(true)
    }
  }, [wrapped])

  return (
    <div ref={ref} class={`commandbar ${wrapped ? 'wrapped' : ''}`}>
      <MenuBar />
      <Toolbar />
    </div>
  )
}
