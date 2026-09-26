import type { ComponentChildren } from 'preact'
import { Icon } from './Icon'

type Severity = 'informational' | 'success' | 'warning' | 'error'
const ICON = { informational: 'infoFilled', success: 'successFilled', warning: 'warningFilled', error: 'errorFilled' } as const

/** WinUI InfoBar: docked, severity-colored, with optional actions. */
export function InfoBar({ severity = 'informational', title, children, actions, onClose }: {
  severity?: Severity
  title: string
  children?: ComponentChildren
  actions?: ComponentChildren
  onClose?: () => void
}) {
  const urgent = severity === 'warning' || severity === 'error'
  return (
    <div class={`infobar ${severity}`} role={urgent ? 'alert' : 'status'}>
      <span class="infobar-icon" aria-hidden="true">
        <Icon name={ICON[severity]} size={16} />
      </span>
      <div class="infobar-text">
        <strong class="infobar-title">{title}</strong>
        {children && <span class="infobar-message">{children}</span>}
      </div>
      {actions && <div class="infobar-actions">{actions}</div>}
      {onClose && (
        <button class="icon-button infobar-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}
