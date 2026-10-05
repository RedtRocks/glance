import { openWithDialog } from '../../state/actions'
import { activeId, docs } from '../../state/documents'
import { narrowWindow } from '../../state/ui'
import { toast } from '../../state/ui'
import { canInstall, install } from '../../platform/webApp'
import { fileDragOver } from '../dragState'
import { Icon } from '../Icon'
import { Brand, ThemeButton } from './WebNav'
import { t } from '../../i18n'

/** Shown as chips under "Opens"; names of formats aren't translated. */
// i18n-ignore: file format names
const FORMATS = ['PDF', 'Word', 'PowerPoint', 'Excel', 'JPEG', 'PNG', 'HEIC', 'WebP', 'AVIF', 'GIF', 'TIFF', 'PSD', 'Camera RAW', 'DNG', 'JPEG XL', 'JPEG 2000', 'EXR', 'HDR', 'TGA', 'SVG', 'CBZ', 'GLB', 'OBJ', 'STL', 'FBX', 'USDZ']

const photoUrl = new URL('web/start-photo.webp', document.baseURI).href

async function onInstall(): Promise<void> {
  // Safari has no install prompt: it's in the Share menu.
  if (!(await install())) toast(t('Tap Share, then Add to Home Screen.'))
}

/** Back to the files that are still open, from the start screen. */
function OpenFilesButton() {
  const list = docs.value
  if (!list.length) return null
  return (
    <button class="w-btn" onClick={() => (activeId.value = list[list.length - 1].id)}>
      {t('{count, plural, one {Back to # open file} other {Back to # open files}}', { count: list.length })}
    </button>
  )
}

function PhoneStart() {
  return (
    <div class="ww-phone">
      <div class="ww-head">
        <Brand />
        <div class="ww-head-actions">
          <ThemeButton />
          {canInstall() && (
            <button class="w-btn" onClick={() => void onInstall()}>
              <Icon name="download" />
              {t('Install')}
            </button>
          )}
        </div>
      </div>
      <div class="ww-hero" aria-hidden="true">
        <div class="ww-card yellow" />
        <div class="ww-card pink" />
        <div class="ww-card violet">
          <img src={photoUrl} alt="" width={600} height={400} />
        </div>
        <span class="ww-tag yellow">
          <b>+75</b>
          {t('File Types')}
        </span>
        <span class="ww-tag orange">
          <b>100%</b>
          {t('On Device')}
        </span>
      </div>
      <h1>{t('Open Any File, Right Here')}</h1>
      <p class="ww-lead">{t('PDFs, photos, Office files, camera RAW and 3D models. View, mark up, sign and redact, with nothing uploaded.')}</p>
      <div class="ww-cta">
        <OpenFilesButton />
        <button class="w-btn ink big" onClick={() => void openWithDialog()}>
          <Icon name="folderOpen" size={24} />
          {t('Choose a File')}
        </button>
        <p class="ww-fine">
          <Icon name="lock" size={16} />
          {t('Works offline once installed')}
        </p>
      </div>
    </div>
  )
}

function DesktopStart() {
  return (
    <div class="ww-desk">
      <section class={`ww-intro ${fileDragOver.value ? 'drag-over' : ''}`}>
        <h1>{t('Open Any File, Right Here')}</h1>
        <p class="ww-lead">{t('PDFs, photos, Office files, camera RAW and 3D models. View, mark up, sign, redact and rearrange pages in your browser. Files never leave this computer.')}</p>
        <div class="ww-buttons">
          <button class="w-btn ink big" onClick={() => void openWithDialog()}>
            <Icon name="folderOpen" />
            {t('Choose Files')}
          </button>
          {canInstall() && (
            <button class="w-btn big" onClick={() => void onInstall()}>
              <Icon name="download" />
              {t('Install for Offline Use')}
            </button>
          )}
          <OpenFilesButton />
        </div>
        <div class="ww-drop">
          <Icon name="download" />
          {t('Or drop files anywhere on this page')}
        </div>
      </section>
      <section class="ww-side">
        <div class="ww-tiles">
          <div class="ww-tile orange">
            <b>+75</b>
            <span>{t('File Types, From PDF to Camera RAW')}</span>
          </div>
          <div class="ww-tile pink">
            <b>100%</b>
            <span>{t('Processed On Your Device')}</span>
          </div>
          <div class="ww-tile violet">
            <b>{t('0 KB')}</b>
            <span>{t('Uploaded, Ever')}</span>
          </div>
          <div class="ww-tile yellow">
            <b>{t('Offline')}</b>
            <span>{t('Works After One Visit')}</span>
          </div>
        </div>
        <div class="ww-formats">
          <h2>{t('Opens')}</h2>
          <ul>
            {FORMATS.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

/** The browser version's start screen, in the website's Wollo style. */
export function WebWelcome() {
  return <div class="web-welcome">{narrowWindow.value ? <PhoneStart /> : <DesktopStart />}</div>
}
