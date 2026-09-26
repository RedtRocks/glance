/** Checking a PDF's certificate signatures (see core/pdfSignatures.ts and src-tauri/src/certsig.rs). */
import * as platform from '../platform'
import { mayHaveSignatures, type CheckedSignature } from '../core/signatureStatus'
import { pdfSignatures } from './pdfModules'

// Keyed by the loaded bytes: a document is re-checked only when its content changes.
const cache = new WeakMap<Uint8Array, Promise<CheckedSignature[]>>()

export function checkSignatures(bytes: Uint8Array): Promise<CheckedSignature[]> {
  let p = cache.get(bytes)
  if (!p) {
    p = run(bytes).catch(() => [])
    cache.set(bytes, p)
  }
  return p
}

async function run(bytes: Uint8Array): Promise<CheckedSignature[]> {
  if (!mayHaveSignatures(bytes)) return []
  const { findSignatures, dataToVerify } = await pdfSignatures()
  const found = await findSignatures(bytes)
  return Promise.all(
    found.map(async ({ contents, ...sig }): Promise<CheckedSignature> => {
      if (!sig.wellFormed) return { sig, check: null, error: null }
      if (sig.kind === 'unsupported') return { sig, check: null, error: `Glance can’t check this kind of signature (${sig.subFilter || 'unknown format'}).` }
      if (!platform.signatureCheckAvailable) return { sig, check: null, error: 'Signatures are checked with the Windows certificate store, in the Glance app for Windows.' }
      try {
        const data = await dataToVerify(bytes, { ...sig, contents })
        return { sig, check: await platform.verifyPdfSignature(sig.kind, contents, data, sig.claimedTime), error: null }
      } catch (e) {
        return { sig, check: null, error: `The signature couldn’t be checked: ${String(e)}` }
      }
    })
  )
}
