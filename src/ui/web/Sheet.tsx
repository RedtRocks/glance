import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'

/** A phone bottom sheet: slides up over the document, a tap outside or Escape puts it away. */
export function Sheet({ title, sub, aside, onClose, children, class: cls = '' }: {
  title: string
  sub?: string
  aside?: ComponentChildren
  onClose: () => void
  children: ComponentChildren
  class?: string
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section class={`sheet ${cls}`} role="dialog" aria-modal="true" aria-label={title}>
        <button class="sheet-handle" aria-label={title} onClick={onClose} />
        <header class="sheet-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          {aside}
        </header>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  )
}
