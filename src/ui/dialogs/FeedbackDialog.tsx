import { useState } from 'preact/hooks'
import { feedbackUrl, systemName, type FeedbackKind } from '../../core/feedback'
import * as platform from '../../platform'
import { feedbackOpen, toast } from '../../state/ui'
import { msg, t } from '../../i18n'
import { Modal } from './Dialog'

const KINDS: [FeedbackKind, string][] = [
  ['idea', msg('An idea or request')],
  ['problem', msg('Something isn’t working')],
  ['other', msg('Something else')]
]

/** The app version and system, so a problem report says where it happened. */
async function aboutThisCopy(): Promise<string> {
  let app = 'Glance web' // i18n-ignore
  if (platform.isTauri) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      app = `Glance ${await getVersion()}${(await platform.isStorePackage()) ? ' (Microsoft Store)' : ''}` // i18n-ignore
    } catch {
      app = 'Glance' // i18n-ignore
    }
  }
  const system = systemName(navigator.userAgent)
  return system ? `${app} on ${system}` : app // i18n-ignore
}

/** Help → Send Feedback: write to the Glance developer as a GitHub issue. */
export function FeedbackDialog() {
  const [kind, setKind] = useState<FeedbackKind>('idea')
  const [message, setMessage] = useState('')
  const [includeAbout, setIncludeAbout] = useState(true)
  const close = (): void => void (feedbackOpen.value = false)

  const send = async (): Promise<void> => {
    const url = feedbackUrl({ kind, message, about: includeAbout ? await aboutThisCopy() : null })
    close()
    await platform.openUrl(url)
    toast(t('Finish sending your feedback on GitHub'))
  }

  return (
    <Modal
      title={t('Send feedback')}
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button class="btn primary" disabled={!message.trim()} onClick={() => void send()}>
            {t('Continue on GitHub')}
          </button>
        </>
      }
    >
      <div class="feedback">
        <p class="muted">{t('Tell the developer what you like, what’s missing or what went wrong. Every message is read.')}</p>
        <label class="field">
          <span>{t('What’s it about?')}</span>
          <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as FeedbackKind)}>
            {KINDS.map(([k, label]) => (
              <option key={k} value={k}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>{t('Your feedback')}</span>
          <textarea
            rows={6}
            value={message}
            placeholder={kind === 'problem' ? t('What did you do, what did you expect, and what happened instead?') : t('Write as much or as little as you like.')}
            onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && message.trim() && void send()}
          />
        </label>
        <label class="check-row">
          <input type="checkbox" checked={includeAbout} onChange={(e) => setIncludeAbout((e.target as HTMLInputElement).checked)} />
          <span>{t('Include the Glance version and your system')}</span>
        </label>
        <p class="muted small">{t('Your feedback opens as a public GitHub issue, which needs a free GitHub account. Glance never sends your files.')}</p>
      </div>
    </Modal>
  )
}
