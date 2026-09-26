import type { ComponentChildren } from 'preact'
import { Icon } from './Icon'
import { t } from '../i18n'

/** WinUI InfoBar: docked, severity-colored, with optional actions. */
export function InfoBar({ severity = 'informational', title, children, actions, onClose }: {
  severity?: 'informational' | 'warning'
  title: string
  children?: ComponentChildren
  actions?: ComponentChildren
  onClose?: () => void
}) {
  return (
    <div class={`infobar ${severity}`} role={severity === 'warning' ? 'alert' : 'status'}>
      <span class="infobar-icon" aria-hidden="true">
        <Icon name={severity === 'warning' ? 'warningFilled' : 'infoFilled'} size={16} />
      </span>
      <div class="infobar-text">
        <strong class="infobar-title">{title}</strong>
        {children && <span class="infobar-message">{children}</span>}
      </div>
      {actions && <div class="infobar-actions">{actions}</div>}
      {onClose && (
        <button class="icon-button infobar-close" aria-label={t('Close')} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}
