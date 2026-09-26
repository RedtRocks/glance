/**
 * File → Import from Scanner: scans with the device's driver into a temp folder,
 * then opens the pages as new, unsaved documents (Save asks where to keep them),
 * either one image each or combined into a single PDF.
 */
import * as platform from '../platform'
import { findByPath } from './documents'
import { imageForPdf, openFiles } from './actions'
import { pageOps } from './pdfModules'
import { toast } from './ui'
import { t } from '../i18n'

export type ScanSource = 'auto' | 'flatbed' | 'feeder'

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')
}

async function openUntitled(path: string, name: string): Promise<void> {
  await openFiles([path])
  const doc = findByPath(path)
  if (!doc) return
  doc.name.value = name
  doc.path.value = null // Save → Save As
  doc.dirty.value = true
}

export async function importFromScanner(id: string, source: ScanSource, dpi: number, asPdf: boolean): Promise<void> {
  const { files, dpi: actual } = await platform.scan(id, source, dpi)
  if (!files.length) return toast(t('The scanner didn’t return any pages.'))
  if (asPdf) {
    const images = []
    for (const f of files) images.push({ ...(await imageForPdf(await platform.probe(f))), dpi: actual || dpi || undefined })
    const pdf = await (await pageOps()).pdfFromImages(images)
    const tmp = await platform.writeTemp(`Scan ${stamp()}.pdf`, pdf)
    await openUntitled(tmp, t('Scan') + '.pdf')
    return
  }
  for (const f of files) {
    const ext = /\.[^.\\/]+$/.exec(f)?.[0] ?? ''
    await openUntitled(f, (files.length > 1 ? t('Scan {number}', { number: files.indexOf(f) + 1 }) : t('Scan')) + ext)
  }
}
