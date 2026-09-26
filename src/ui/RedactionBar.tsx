import type { PdfDoc } from '../state/documents'
import { applyRedactions, discardRedactions } from '../state/actions'
import { InfoBar } from './InfoBar'
import { t } from '../i18n'

/** Pending redactions are loud: the content is still in the file until applied. Not closable. */
export function RedactionBar({ doc }: { doc: PdfDoc }) {
  const n = doc.redactions.value.length
  if (!n) return null
  return (
    <InfoBar
      severity="warning"
      title={t('Redactions not applied')}
      actions={
        <>
          <button class="btn" onClick={() => discardRedactions(doc)}>{t('Discard')}</button>
          <button class="btn primary" onClick={() => void applyRedactions(doc)}>{t('Apply redactions')}</button>
        </>
      }
    >
      {t('{count, plural, one {# marked area.} other {# marked areas.}} The content underneath stays in the file until you apply.', { count: n })}
    </InfoBar>
  )
}
