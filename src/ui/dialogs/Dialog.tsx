import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { dialog } from '../../state/ui'

/** Fluent ContentDialog shell used by every modal in Glance. */
export function Modal({ title, children, footer, onClose, wide }: { title: string; children: ComponentChildren; footer?: ComponentChildren; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, button.primary, button')
    first?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      prev?.focus?.()
    }
  }, [])
  return (
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 class="modal-title">{title}</h2>
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

/** Renders the pending `showDialog` / `promptText` request. */
export function DialogHost() {
  const req = dialog.value
  const [text, setText] = useState('')
  useEffect(() => setText(req?.input?.initial ?? ''), [req])
  if (!req) return null
  const done = (value: unknown): void => {
    dialog.value = null
    req.resolve(value === '__input__' ? text : value)
  }
  const primary = req.buttons.find((b) => b.primary)
  return (
    <Modal
      title={req.title}
      onClose={() => done(null)}
      footer={req.buttons.map((b) => (
        <button key={b.label} class={`btn ${b.primary ? 'primary' : ''}`} onClick={() => done(b.value)}>
          {b.label}
        </button>
      ))}
    >
      {req.body && <div>{req.body}</div>}
      {req.input && (
        <label class="field">
          <span>{req.input.label}</span>
          <input
            type={req.input.password ? 'password' : 'text'}
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && primary && done(primary.value)}
          />
        </label>
      )}
    </Modal>
  )
}
