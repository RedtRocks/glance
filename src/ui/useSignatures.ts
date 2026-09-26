import { useEffect, useState } from 'preact/hooks'
import type { PdfDoc } from '../state/documents'
import type { CheckedSignature } from '../core/signatureStatus'
import { checkSignatures } from '../state/certSignatures'

/** The document's checked signatures; null while checking. Re-checks when its content changes. */
export function useSignatures(doc: PdfDoc): CheckedSignature[] | null {
  const [list, setList] = useState<CheckedSignature[] | null>(null)
  const revision = doc.revision.value
  useEffect(() => {
    let alive = true
    void checkSignatures(doc.bytes).then((l) => alive && setList(l))
    return () => {
      alive = false
    }
  }, [doc, revision])
  return list
}
