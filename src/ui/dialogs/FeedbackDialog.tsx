import { useState } from 'preact/hooks'
import { feedbackUrl } from '../../core/feedback'
import * as platform from '../../platform'
import { feedbackOpen, toast } from '../../state/ui'
import { t } from '../../i18n'
import { Modal } from './Dialog'

/** Help → Send Feedback: write to the Glance developer by email. */
export function FeedbackDialog() {
  const [message, setMessage] = useState('')
  const close = (): void => void (feedbackOpen.value = false)

  const send = async (): Promise<void> => {
    const url = feedbackUrl(message)
    close()
    await platform.openUrl(url)
    toast(t('Press Send in your mail app to finish'))
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
            {t('Open in mail app')}
          </button>
        </>
      }
    >
      <div class="feedback">
        <p class="muted">{t('Tell the developer what you like, what’s missing or what went wrong.')}</p>
        <label class="field">
          <span>{t('Your feedback')}</span>
          <textarea
            rows={6}
            value={message}
            placeholder={t('Write as much or as little as you like.')}
            onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && message.trim() && void send()}
          />
        </label>
        <p class="muted small">{t('This opens a message in your mail app. Only what you write here is included; Glance sends nothing else.')}</p>
      </div>
    </Modal>
  )
}
