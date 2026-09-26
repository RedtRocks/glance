/**
 * What a PDF's certificate signatures add up to, in words for the signature banner
 * and panel. Kept free of pdf-lib so it can run for every opened PDF.
 */
import type { SignatureCheck } from '../platform'
import { t } from '../i18n'
import type { PdfSignature } from './pdfSignatures'

const BYTE_RANGE = new TextEncoder().encode('/ByteRange')

/** Cheap check before parsing: every signature value has a /ByteRange. */
export function mayHaveSignatures(bytes: Uint8Array): boolean {
  const first = BYTE_RANGE[0]
  for (let i = bytes.indexOf(first); i >= 0 && i <= bytes.length - BYTE_RANGE.length; i = bytes.indexOf(first, i + 1)) {
    let j = 1
    while (j < BYTE_RANGE.length && bytes[i + j] === BYTE_RANGE[j]) j++
    if (j === BYTE_RANGE.length) return true
  }
  return false
}

/**
 * valid: unchanged and the signer's certificate is trusted. untrusted: unchanged, but
 * who signed can't be confirmed. invalid: the signed content changed or the signature is
 * damaged. unknown: not checked (another platform, an unsupported format, or an error).
 */
export type Verdict = 'valid' | 'untrusted' | 'invalid' | 'unknown'

export interface CheckedSignature {
  sig: Omit<PdfSignature, 'contents'>
  check: SignatureCheck | null
  /** Why it wasn't checked, when `check` is null. */
  error: string | null
}

export function verdict({ sig, check }: CheckedSignature): Verdict {
  if (!sig.wellFormed) return 'invalid'
  if (!check) return 'unknown'
  if (check.integrity !== 'intact') return 'invalid'
  return check.trust === 'trusted' ? 'valid' : 'untrusted'
}

export function signerName(c: CheckedSignature): string {
  return c.check?.signer || c.sig.name || t('Unknown signer')
}

/** What the signature is: a person's signature or a document timestamp. */
export function isTimestamp(c: CheckedSignature): boolean {
  return c.sig.kind === 'timestamp'
}

function untrustedReason(c: CheckedSignature): string {
  switch (c.check?.trust) {
    case 'revoked':
      return t('The signer’s certificate has been revoked or is blocked in Windows.')
    case 'expired':
      return t('The signer’s certificate wasn’t valid at the time of signing.')
    default:
      return t('The signer’s certificate wasn’t issued by an authority Windows trusts, so their identity can’t be confirmed.')
  }
}

/** One sentence per signature, for the panel. */
export function describe(c: CheckedSignature): string {
  const v = verdict(c)
  if (!c.sig.wellFormed) return t('The signature doesn’t cover the document the way a signature must, so it can’t be relied on.')
  if (v === 'unknown') return c.error ?? t('This signature wasn’t checked.')
  if (v === 'invalid') {
    return c.check?.integrity === 'modified' ? t('The document was changed after it was signed.') : t('The signature is damaged or doesn’t match the signer’s certificate.')
  }
  if (v === 'untrusted') return untrustedReason(c)
  return isTimestamp(c) ? t('The timestamp is valid and the document hasn’t changed since.') : t('The signature is valid and the signer’s identity was confirmed by Windows.')
}

/** What happened after this signature was added. */
export function laterChanges(c: CheckedSignature): string {
  if (c.sig.coversWholeFile || !c.sig.wellFormed) return ''
  return c.sig.laterSigned ? t('More signatures were added after this one.') : t('The document was changed after this signature was added.')
}

export interface Summary {
  severity: 'success' | 'warning' | 'error' | 'informational'
  title: string
  message: string
}

/** The banner above a signed document. */
export function summarize(list: CheckedSignature[]): Summary | null {
  const people = list.filter((c) => !isTimestamp(c))
  if (!list.length) return null
  const shown = people.length ? people : list
  const names = [...new Set(shown.map(signerName))]
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? t('{first} and {second}', { first: names[0], second: names[1] })
        : t('{first} and {count, plural, one {# other} other {# others}}', { first: names[0], count: names.length - 1 })
  const title = people.length ? t('Signed by {who}', { who }) : t('Timestamped document')
  const verdicts = list.map(verdict)
  const last = list.reduce((a, b) => (b.sig.byteRange[2] + b.sig.byteRange[3] > a.sig.byteRange[2] + a.sig.byteRange[3] ? b : a))
  const changedSince = last.sig.wellFormed && !last.sig.coversWholeFile
  if (verdicts.includes('invalid')) {
    const modified = list.some((c) => c.check?.integrity === 'modified')
    return { severity: 'error', title, message: modified ? t('At least one signature is invalid: the document was changed after it was signed.') : t('At least one signature is invalid.') }
  }
  if (verdicts.every((v) => v === 'unknown')) {
    const why = list.find((c) => c.error)?.error
    return { severity: 'informational', title, message: why ?? t('The signatures weren’t checked.') }
  }
  if (changedSince) return { severity: 'warning', title, message: t('The document was changed after the last signature was added.') }
  if (verdicts.includes('untrusted')) {
    return {
      severity: 'warning',
      title,
      message: list.length === 1 ? t('The document hasn’t changed since it was signed, but the signer’s identity can’t be confirmed.') : t('The document hasn’t changed since it was signed, but not every signer’s identity can be confirmed.')
    }
  }
  if (verdicts.includes('unknown')) return { severity: 'warning', title, message: t('Some signatures couldn’t be checked.') }
  return { severity: 'success', title, message: list.length === 1 ? t('The signature is valid.') : t('All signatures are valid.') }
}
