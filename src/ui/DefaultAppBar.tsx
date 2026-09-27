import { defaultAppOffer, dismissDefaultAppOffer, makeDefault } from '../state/defaultApp'
import { InfoBar } from './InfoBar'
import { toast } from '../state/ui'
import { t } from '../i18n'

/** Asked once: "Make Glance your default viewer?" Opens Windows Settings to confirm. */
export function DefaultAppBar() {
  if (!defaultAppOffer.value) return null
  return (
    <InfoBar
      title={t('Make Glance your default viewer?')}
      actions={
        <>
          <button class="btn" onClick={dismissDefaultAppOffer}>
            {t('Not now')}
          </button>
          <button class="btn primary" onClick={() => void makeDefault().catch((e: Error) => toast(e.message))}>
            {t('Make default')}
          </button>
        </>
      }
      onClose={dismissDefaultAppOffer}
    >
      {t('Windows asks you to confirm in Settings: choose Set default at the top of Glance’s page.')}
    </InfoBar>
  )
}
