import { openWithDialog } from '../../state/actions'
import { fileDragOver } from '../dragState'
import { Icon } from '../Icon'
import { t } from '../../i18n'

/** Resolved against the page, so the app also works from a subfolder on a website. */
const iconUrl = new URL('icon.svg', document.baseURI).href

/** Phones and tablets: no drag and drop, and the tips about it only confuse. */
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export function Welcome() {
  return (
    <div class={`welcome ${fileDragOver.value ? 'drag-over' : ''}`}>
      <img src={iconUrl} alt="" width={96} height={96} />
      {/* i18n-ignore: product name */}
      <h1>Glance</h1>
      <p>{touch ? t('Open a PDF, image, camera RAW or 3D model from this device.') : t('Open a PDF, image, camera RAW or 3D model, or drop files anywhere in this window.')}</p>
      <button class="btn primary" onClick={() => void openWithDialog()}>
        <Icon name="open" size={16} /> {t('Open…')}
      </button>
      {!touch && <p class="hint">{t('Tip: drag pages between documents to merge them, or out of the window to create a new PDF.')}</p>}
      {touch && <p class="hint">{t('Files you open stay on this device. Nothing is uploaded.')}</p>}
    </div>
  )
}
