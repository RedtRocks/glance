import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Icon } from '../Icon'
import type { IconName } from '../icons'

/**
 * Toolbar button with a Fluent flyout underneath. Without an icon it is just the chevron,
 * the dropdown half of a split button placed right after the main button.
 */
export function Popover({ icon, label, pressed, children, swatch }: { icon?: IconName; label: string; pressed?: boolean; children: (close: () => void) => ComponentChildren; swatch?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div class="popover" ref={ref}>
      <button class={`tb-button with-chevron ${icon ? '' : 'split-chevron'} ${pressed || open ? 'pressed' : ''}`} title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} />}
        {swatch && <span class="swatch-bar" style={{ background: swatch }} />}
        <span class="chevron" aria-hidden="true">
          <Icon name="chevronSmall" size={12} />
        </span>
      </button>
      {open && <div class="flyout">{children(() => setOpen(false))}</div>}
    </div>
  )
}
