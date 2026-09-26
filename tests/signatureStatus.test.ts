import { describe, expect, it } from 'vitest'
import { describe as sentence, laterChanges, summarize, verdict, type CheckedSignature } from '../src/core/signatureStatus'
import type { SignatureCheck } from '../src/platform'

const check = (over: Partial<SignatureCheck> = {}): SignatureCheck => ({
  integrity: 'intact',
  trust: 'trusted',
  detail: '',
  signer: 'Ada Lovelace',
  email: '',
  issuer: 'Some CA',
  signingTime: null,
  timestamp: null,
  timestampAuthority: '',
  revocationChecked: true,
  certificate: 'AA==',
  ...over
})

function signed(end: number, fileEnd: number, c: SignatureCheck | null, over: Partial<CheckedSignature['sig']> = {}): CheckedSignature {
  return {
    sig: {
      field: `Sig${end}`,
      page: 0,
      visible: false,
      subFilter: 'adbe.pkcs7.detached',
      kind: 'detached',
      byteRange: [0, 10, 20, end - 20],
      name: '',
      reason: '',
      location: '',
      contact: '',
      claimedTime: null,
      wellFormed: true,
      coversWholeFile: end === fileEnd,
      laterSigned: false,
      ...over
    },
    check: c,
    error: c ? null : 'Signatures are checked in the Glance app for Windows.'
  }
}

describe('signature status', () => {
  it('reports a valid, trusted signature', () => {
    const s = signed(100, 100, check())
    expect(verdict(s)).toBe('valid')
    expect(summarize([s])).toEqual({ severity: 'success', title: 'Signed by Ada Lovelace', message: 'The signature is valid.' })
  })

  it('warns when the signer can’t be confirmed', () => {
    const s = signed(100, 100, check({ trust: 'untrusted', detail: 'Not trusted.' }))
    expect(verdict(s)).toBe('untrusted')
    expect(sentence(s)).toBe('Not trusted.')
    expect(summarize([s])?.severity).toBe('warning')
  })

  it('fails when the signed bytes changed or the range is forged', () => {
    const modified = signed(100, 100, check({ integrity: 'modified' }))
    expect(summarize([modified])).toMatchObject({ severity: 'error', message: expect.stringContaining('changed after it was signed') })
    const forged = signed(100, 100, check(), { wellFormed: false })
    expect(verdict(forged)).toBe('invalid')
  })

  it('warns about changes after the last signature, not about later signatures', () => {
    const first = signed(100, 200, check(), { laterSigned: true })
    const second = signed(200, 200, check({ signer: 'Grace Hopper' }))
    expect(laterChanges(first)).toBe('More signatures were added after this one.')
    expect(summarize([first, second])).toMatchObject({ severity: 'success', title: 'Signed by Ada Lovelace and Grace Hopper' })
    const edited = signed(100, 150, check())
    expect(laterChanges(edited)).toBe('The document was changed after this signature was added.')
    expect(summarize([edited])?.severity).toBe('warning')
  })

  it('names timestamps apart from signers and explains unchecked signatures', () => {
    const stamp = signed(200, 200, check({ signer: 'TSA' }), { kind: 'timestamp', subFilter: 'ETSI.RFC3161' })
    const person = signed(100, 200, check(), { laterSigned: true })
    expect(summarize([person, stamp])?.title).toBe('Signed by Ada Lovelace')
    expect(summarize([stamp])?.title).toBe('Timestamped document')
    const unchecked = signed(100, 100, null, { name: 'From the PDF' })
    expect(summarize([unchecked])).toMatchObject({ severity: 'informational', title: 'Signed by From the PDF' })
  })
})
