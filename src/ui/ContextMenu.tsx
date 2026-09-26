import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { contextMenu, type ContextMenuItem } from '../state/ui'
import { Icon } from './Icon'

/** Fluent-style right-click menu, kept on screen and dismissed by click-away or Esc. */
export function ContextMenu() {
  const menu = contextMenu.value
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [sub, setSub] = useState<number | null>(null)

  useLayoutEffect(() => {
    setSub(null)
    if (!menu || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, innerWidth - r.width - 4), y: Math.min(menu.y, innerHeight - r.height - 4) })
    ref.current.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return
      contextMenu.value = null
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (!menu) return null
  const pick = (item: ContextMenuItem) => {
    contextMenu.value = null
    void item.run?.()
  }
  return (
    <div
      ref={ref}
      class="menu context-menu"
      role="menu"
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const buttons = [...ref.current!.querySelectorAll<HTMLElement>(':scope > .menu-entry > button:not(:disabled)')]
        const i = buttons.indexOf(document.activeElement as HTMLElement)
        buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
      }}
    >
      {menu.items.map((item, i) =>
        item === '-' ? (
          <div key={i} class="menu-sep" role="separator" />
        ) : (
          <div key={i} class="menu-entry" onPointerEnter={() => setSub(item.items ? i : null)}>
            <button
              class="menu-item"
              role="menuitem"
              disabled={item.disabled || (item.items && !item.items.length)}
              aria-haspopup={item.items ? 'menu' : undefined}
              aria-expanded={item.items ? sub === i : undefined}
              onClick={() => (item.items ? setSub(i) : pick(item))}
              onKeyDown={(e) => item.items && e.key === 'ArrowRight' && setSub(i)}
            >
              <span class="menu-check" />
              <span class="menu-label">{item.label}</span>
              <span class="menu-keys">{item.items ? <Icon name="right" size={12} /> : ''}</span>
            </button>
            {item.items && sub === i && (
              <div class="menu submenu" role="menu">
                {item.items.map((s, k) => (
                  <button key={k} class="menu-item" role="menuitem" disabled={s.disabled} onClick={() => pick(s)}>
                    <span class="menu-check" />
                    <span class="menu-label">{s.label}</span>
                    <span class="menu-keys" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
