/**
 * Printing: pages are rasterized at print resolution into a print-only container and
 * handed to WebView2's print dialog (which offers every installed printer and
 * "Microsoft Print to PDF").
 */
import type { Doc } from './documents'
import { imageUrl } from '../platform'
import { withBusy } from './ui'

const PRINT_SCALE = 150 / 72 // 150 DPI keeps memory reasonable for long documents

async function pdfPages(doc: Extract<Doc, { kind: 'pdf' }>, root: HTMLElement): Promise<void> {
  const proxy = doc.proxy.value
  if (!proxy) return
  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i)
    const viewport = page.getViewport({ scale: PRINT_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport, annotationMode: 2 /* ENABLE_FORMS */ }).promise
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
  await withBusy('Preparing to print…', async () => {
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
