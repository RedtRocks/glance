import type { PdfDoc } from '../state/documents'
import { applyRedactions, discardRedactions } from '../state/actions'
import { InfoBar } from './InfoBar'

/** Pending redactions are loud: the content is still in the file until applied. Not closable. */
export function RedactionBar({ doc }: { doc: PdfDoc }) {
  const n = doc.redactions.value.length
  if (!n) return null
  return (
    <InfoBar
      severity="warning"
      title="Redactions not applied"
      actions={
        <>
          <button class="btn" onClick={() => discardRedactions(doc)}>Discard</button>
          <button class="btn primary" onClick={() => void applyRedactions(doc)}>Apply redactions</button>
        </>
      }
    >
      {n} marked {n === 1 ? 'area' : 'areas'}. The content underneath stays in the file until you apply.
    </InfoBar>
  )
}
