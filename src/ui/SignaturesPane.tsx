import type { PdfDoc } from '../state/documents'
import { describe, isTimestamp, laterChanges, signerName, verdict, type CheckedSignature, type Verdict } from '../core/signatureStatus'
import { signaturesOpen, toast } from '../state/ui'
import * as platform from '../platform'
import { Icon } from './Icon'
import { useSignatures } from './useSignatures'

const BADGE: Record<Verdict, { icon: 'successFilled' | 'warningFilled' | 'errorFilled' | 'infoFilled'; label: string }> = {
  valid: { icon: 'successFilled', label: 'Valid' },
  untrusted: { icon: 'warningFilled', label: 'Signer not verified' },
  invalid: { icon: 'errorFilled', label: 'Invalid' },
  unknown: { icon: 'infoFilled', label: 'Not checked' }
}

const when = (ms: number | null | undefined): string => (ms == null ? '' : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))

function SignatureCard({ doc, c, index }: { doc: PdfDoc; c: CheckedSignature; index: number }) {
  const v = verdict(c)
  const check = c.check
  const trusted = check?.timestamp != null
  const signedAt = check?.timestamp ?? check?.signingTime ?? c.sig.claimedTime
  const rows: [string, string][] = [
    [isTimestamp(c) ? 'Time' : 'Signed', signedAt == null ? '' : `${when(signedAt)}${trusted ? '' : ' (signer’s clock)'}`],
    ['Timestamp by', isTimestamp(c) ? '' : (check?.timestampAuthority ?? '')],
    ['Reason', c.sig.reason],
    ['Location', c.sig.location],
    ['Contact', c.sig.contact || check?.email || ''],
    ['Issued by', check?.issuer ?? ''],
    ['Revocation', check && check.trust !== 'unknown' && !check.revocationChecked ? 'Couldn’t be checked (offline?)' : ''],
    ['Field', c.sig.field]
  ]
  const later = laterChanges(c)
  const certificate = check?.certificate
  const showCertificate = async (): Promise<void> => {
    try {
      if (certificate) await platform.showCertificate(certificate)
    } catch (e) {
      toast(String(e), 'error')
    }
  }
  return (
    <section class={`signature-card ${v}`} aria-label={`Signature ${index + 1}`}>
      <header>
        <span class="signature-badge" aria-hidden="true">
          <Icon name={BADGE[v].icon} size={16} />
        </span>
        <div>
          <strong>{isTimestamp(c) ? 'Document timestamp' : signerName(c)}</strong>
          <span class="signature-verdict">{BADGE[v].label}</span>
        </div>
      </header>
      <p>{describe(c)}</p>
      {later && <p class="signature-later">{later}</p>}
      <dl>
        {rows
          .filter(([, value]) => value)
          .map(([k, value]) => (
            <div key={k} class="inspector-row">
              <dt>{k}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
      </dl>
      {(certificate || (c.sig.visible && c.sig.page !== null)) && (
        <div class="inline-actions">
          {certificate && platform.signatureCheckAvailable && (
            <button class="btn" onClick={() => void showCertificate()}>
              <Icon name="certificate" size={16} /> Certificate
            </button>
          )}
          {c.sig.visible && c.sig.page !== null && (
            <button class="btn" onClick={() => doc.goTo(c.sig.page!)}>
              Show on Page {c.sig.page + 1}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** Every certificate signature in the PDF, oldest first, with what Windows found. */
export function SignaturesPane({ doc }: { doc: PdfDoc }) {
  const list = useSignatures(doc)
  const close = (): void => void (signaturesOpen.value = false)
  return (
    <aside class="side-pane signatures-pane" aria-label="Signatures">
      <header class="side-pane-header">
        <h2>Signatures</h2>
        <button class="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div class="side-pane-body">
        {list === null && <p class="side-pane-hint">Checking signatures…</p>}
        {list?.length === 0 && <p class="side-pane-hint">This document has no certificate signatures. Handwritten signatures placed as markup aren’t listed here.</p>}
        {list?.map((c, i) => <SignatureCard key={c.sig.field} doc={doc} c={c} index={i} />)}
      </div>
    </aside>
  )
}
