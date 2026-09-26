import { busy, toasts } from '../state/ui'

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {busy.value && (
        <div class="toast busy">
          <span class="spinner" aria-hidden="true" />
          {busy.value}
        </div>
      )}
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
