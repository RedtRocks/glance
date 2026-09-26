/** File → Sign with Certificate: a certificate signature from the user's Windows certificate store. */
import * as platform from '../platform'
import { activeDoc, PdfDoc } from './documents'
import { save, serialize } from './actions'
import { pdfSign, pdfSignatures } from './pdfModules'
import { alertDialog, promptText, signaturesOpen, toast, withBusy } from './ui'
import * as versions from './versions'

export async function signWithCertificate(doc = activeDoc.value): Promise<void> {
  if (!(doc instanceof PdfDoc)) return
  if (!platform.signatureCheckAvailable) return toast('Signing with a certificate needs the Glance app for Windows.', 'error')
  if (doc.encrypted) return alertDialog('Can’t sign a password-protected PDF', 'Remove the password protection first, then sign the document.')
  // The signature covers the file as saved, so everything must be saved first.
  if (!doc.path.peek() || doc.dirty.peek()) {
    await save(doc)
    if (!doc.path.peek() || doc.dirty.peek()) return
  }
  const path = doc.path.peek()!
  const reason = await promptText('Sign with a Certificate', 'Reason for signing (optional)', { ok: 'Choose Certificate…' })
  if (reason === null) return
  const cert = await platform.pickSigningCertificate().catch((e) => {
    toast(String(e), 'error')
    return null
  })
  if (!cert) return
  if ((await versions.checkDisk(doc, path, false)) !== 'ok') return
  try {
    const signed = await withBusy('Signing…', async () => {
      const bytes = await serialize(doc)
      const { prepareSignature, embedSignature } = await pdfSign()
      const { signedBytes } = await pdfSignatures()
      const prepared = await prepareSignature(bytes, { name: cert.name, reason: reason.trim() || undefined })
      const cms = await platform.signWithCertificate(cert.thumbprint, signedBytes(prepared.pdf, prepared.byteRange))
      const out = embedSignature(prepared, cms)
      await versions.beforeOverwrite(doc, path)
      await platform.writeFile(path, out)
      return out
    })
    // Markup is now part of the signed file; later edits would be changes after signing.
    await doc.exclusive(async () => {
      doc.markup.value = []
      await doc.load(signed)
    })
    doc.dirty.value = false
    await versions.rememberStamp(doc)
    await versions.afterWrite(path, 'Signed', signed)
    signaturesOpen.value = true
    toast(`Signed as ${cert.name}`)
  } catch (e) {
    toast(`Couldn’t sign: ${String(e)}`, 'error')
  }
}
