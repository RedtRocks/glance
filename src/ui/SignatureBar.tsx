import { useState } from 'preact/hooks'
import { t } from '../i18n'
import type { PdfDoc } from '../state/documents'
import { summarize } from '../core/signatureStatus'
import { signaturesOpen } from '../state/ui'
import { InfoBar } from './InfoBar'
import { useSignatures } from './useSignatures'

/** Says whether a signed PDF's signatures hold up, like Acrobat's signature bar. */
export function SignatureBar({ doc }: { doc: PdfDoc }) {
  const list = useSignatures(doc)
  const [closed, setClosed] = useState(false)
  const summary = list && summarize(list)
  if (!summary || closed) return null
  // Unsaved edits: saving writes a new revision after the signatures.
  const dirty = doc.dirty.value
  return (
    <InfoBar
      severity={dirty ? 'warning' : summary.severity}
      title={summary.title}
      actions={
        <button class="btn" onClick={() => void (signaturesOpen.value = true)}>
          {t('Signature Details')}
        </button>
      }
      onClose={() => setClosed(true)}
    >
      {dirty ? t('You’ve made changes. Once saved, the signatures will no longer cover the whole document.') : summary.message}
    </InfoBar>
  )
}
