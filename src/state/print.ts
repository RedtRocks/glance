/**
 * Printing: pages are rasterized at print resolution into a print-only container and
 * handed to WebView2's print dialog (which offers every installed printer and
 * "Microsoft Print to PDF").
 */
import type { Doc } from './documents'
import { imageUrl } from '../platform'
import { withBusy } from './ui'
import { openPdf } from '../pdf/engine'
import { serialize } from './actions'
import { t } from '../i18n'

const PRINT_SCALE = 150 / 72 // 150 DPI keeps memory reasonable for long documents

async function pdfPages(doc: Extract<Doc, { kind: 'pdf' }>, root: HTMLElement): Promise<void> {
  // Print what would be saved: markup and filled-in form fields included.
  const needsSerialize = doc.markup.peek().length > 0 || doc.formsEdited
  const proxy = needsSerialize ? await openPdf(await serialize(doc)) : doc.proxy.value
  if (!proxy) return
  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i)
    const viewport = page.getViewport({ scale: PRINT_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport, annotationMode: 1 /* ENABLE: draw annotations and form values */ }).promise
    const img = document.createElement('img')
    img.src = canvas.toDataURL('image/jpeg', 0.92)
    img.className = 'print-page'
    root.appendChild(img)
    page.cleanup()
  }
}

export async function printDoc(doc: Doc | null): Promise<void> {
  if (!doc || doc.kind === 'notice') return
  const root = document.getElementById('print-root') ?? Object.assign(document.createElement('div'), { id: 'print-root' })
  document.body.appendChild(root)
  root.replaceChildren()
  await withBusy(t('Preparing to print…'), async () => {
    if (doc.kind === 'pdf') {
      await pdfPages(doc, root)
    } else {
      for (let p = 0; p < doc.pageCount.value; p++) {
        const img = document.createElement('img')
        img.className = 'print-page'
        img.src = imageUrl(doc.probe, p)
        await img.decode().catch(() => undefined)
        root.appendChild(img)
      }
    }
  })
  window.print()
  root.replaceChildren()
}
