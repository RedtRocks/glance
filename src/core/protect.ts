/**
 * Password protection (Preview's Export → Encrypt): AES-256, a password to open,
 * and optional restrictions on printing, copying and editing for anyone
 * without the owner password.
 */
import { PDFDocument } from '@cantoo/pdf-lib'
import { t } from '../i18n'

export interface ProtectOptions {
  /** Needed to open the file. */
  password: string
  /** Needed to change restrictions; defaults to the open password. */
  ownerPassword?: string
  allowPrinting: boolean
  allowCopying: boolean
  allowEditing: boolean
}

export async function protectPdf(bytes: Uint8Array, o: ProtectOptions): Promise<Uint8Array> {
  if (!o.password) throw new Error(t('A password is required.'))
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  doc.encrypt({
    userPassword: o.password,
    ownerPassword: o.ownerPassword || o.password,
    permissions: {
      printing: o.allowPrinting ? 'highResolution' : false,
      copying: o.allowCopying,
      contentAccessibility: true, // screen readers always
      modifying: o.allowEditing,
      annotating: o.allowEditing,
      fillingForms: true,
      documentAssembly: o.allowEditing
    }
  })
  return doc.save({ useObjectStreams: false })
}
