import { opening, dialog } from '../../state/ui'
import { Icon } from '../Icon'
import { t } from '../../i18n'

/**
 * What the browser version shows while it reads a file in: the start screen's card
 * stack, fanning, and a reminder that the file never leaves the device.
 */
export function FileLoader({ name, count }: { name: string; count?: { index: number; total: number } }) {
  return (
    <div class="file-loader" role="status">
      <div class="fl-stack" aria-hidden="true">
        <span class="fl-card yellow" />
        <span class="fl-card pink" />
        <span class="fl-card violet">
          <i />
          <i />
          <i />
        </span>
      </div>
      <p class="fl-title">{t('Opening…')}</p>
      <p class="fl-name">{name}</p>
      {count && count.total > 1 && <p class="fl-count">{t('File {index} of {total}', count)}</p>}
      <div class="fl-bar" aria-hidden="true">
        <span />
      </div>
      <p class="fl-note">
        <Icon name="lock" size={16} />
        {t('Stays on your device. Nothing is uploaded.')}
      </p>
    </div>
  )
}

/** Over everything while files are opened; a password prompt goes on top of it. */
export function OpeningOverlay() {
  const o = opening.value
  if (!o || dialog.value) return null
  return (
    <div class="opening-overlay">
      <FileLoader name={o.name} count={o} />
    </div>
  )
}
