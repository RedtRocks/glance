import { activeDoc, docs } from '../../state/documents'
import { isDark, updateSettings } from '../../state/settings'
import { isVisible, runCommand } from '../../state/commands'
import { TabStrip } from '../TabStrip'
import { Icon } from '../Icon'
import { t } from '../../i18n'

const iconUrl = new URL('icon.svg', document.baseURI).href

/** The website's wordmark: the app icon and a lowercase "glance". */
export function Brand() {
  return (
    <a class="w-brand" href="../" aria-label={t('Glance website')}>
      <img src={iconUrl} alt="" width={28} height={28} />
      {/* i18n-ignore: product name, written the way the website writes it */}
      <span>glance</span>
    </a>
  )
}

/** Light or dark; the website's own toggle uses the same setting (see state/settings.ts). */
export function ThemeButton() {
  const dark = isDark()
  return (
    <button class="phone-icon" aria-label={dark ? t('Switch to Light Mode') : t('Switch to Dark Mode')} onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}>
      <Icon name={dark ? 'sun' : 'moon'} size={24} />
    </button>
  )
}

/** Desktop browsers: the website's rounded nav bar, carrying the open files as pill tabs. */
export function WebNav() {
  const doc = activeDoc.value
  return (
    <nav class="web-nav">
      <Brand />
      {docs.value.length > 0 && <TabStrip />}
      <span class="web-nav-spacer" />
      <ThemeButton />
      {doc && isVisible('file.share') ? (
        <button class="w-btn ink" onClick={() => void runCommand('file.share')}>
          <Icon name="upload" />
          {t('Share')}
        </button>
      ) : (
        <a class="w-btn" href="../">{t('Get the Windows App')}</a>
      )}
    </nav>
  )
}
