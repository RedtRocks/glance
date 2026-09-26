/** Recognize Text: OCR for scanned PDFs (adds a text layer) and images (copies text). */
import type { OcrPageWords } from '../core/ocrLayer'
import * as engine from '../image/engine'
import * as platform from '../platform'
import { openPdf } from '../pdf/engine'
import { activeDoc, ImageDoc, PdfDoc } from './documents'
import { serialize } from './actions'
import { showDialog, toast, withBusy } from './ui'

/** Pages with (almost) no extractable text: scans and photos of documents. */
async function scannedPages(doc: PdfDoc): Promise<number[]> {
  const proxy = doc.proxy.peek()
  if (!proxy) return []
  const out: number[] = []
  for (let i = 1; i <= proxy.numPages; i++) {
    const content = await (await proxy.getPage(i)).getTextContent()
    const chars = content.items.reduce((n, it) => n + ('str' in it ? it.str.trim().length : 0), 0)
    if (chars < 10) out.push(i - 1)
  }
  return out
}

export async function recognizePdfText(doc: PdfDoc | null = activeDoc.value?.kind === 'pdf' ? activeDoc.value : null): Promise<void> {
  if (!doc) return
  if (!platform.ocrAvailable) return toast('Text recognition uses the Windows OCR engine, available in the Windows app.', 'error')
  const scanned = await scannedPages(doc)
  const all = [...Array(doc.pageCount.value).keys()]
  const choice = await showDialog<'scanned' | 'all' | null>({
    title: 'Recognize text',
    body: scanned.length
      ? `${scanned.length} of ${all.length} pages have no selectable text. Glance can recognize their text with Windows OCR so you can search, select and copy it. The pages look exactly the same.`
      : 'Every page already has selectable text. Recognize all pages anyway? (Useful when the existing text is garbled.)',
    buttons: [
      { label: 'Cancel', value: null },
      ...(scanned.length && scanned.length < all.length ? [{ label: 'All pages', value: 'all' as const }] : []),
      { label: scanned.length ? `Recognize ${scanned.length === all.length ? 'all pages' : `${scanned.length} pages`}` : 'Recognize all pages', value: scanned.length ? ('scanned' as const) : ('all' as const), primary: true }
    ]
  })
  if (!choice) return
  const pages = choice === 'all' ? all : scanned
  const max = Math.min(await platform.ocrMaxDimension(), 4000) || 2600
  let words = 0
  let language = ''
  await withBusy('Recognizing text…', async () => {
    // Render with markup and form values so what's visible is what gets read.
    const proxy = await openPdf(await serialize(doc))
    const found: OcrPageWords[] = []
    try {
      for (const index of pages) {
        const page = await proxy.getPage(index + 1)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(300 / 72, max / Math.max(base.width, base.height))
        const vp = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        await page.render({ canvas, viewport: vp, background: 'white' }).promise
        const px = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        canvas.width = canvas.height = 0
        const res = await platform.ocrImage(px.data, px.width, px.height)
        language = res.language
        const pdf = (x: number, y: number) => vp.convertToPdfPoint(x, y) as [number, number]
        const list = res.lines.flatMap((l) =>
          l.words.map((w) => ({ text: w.text, origin: pdf(w.x, w.y + w.h), end: pdf(w.x + w.w, w.y + w.h), top: pdf(w.x, w.y) }))
        )
        words += list.length
        found.push({ index, words: list })
      }
    } finally {
      await proxy.loadingTask.destroy()
    }
    if (!words) return
    const { addTextLayer } = await import('../core/ocrLayer')
    await doc.apply('Recognize Text', async (bytes) => addTextLayer(bytes, found, { loadFont: platform.fontBytes, family: 'Arial' }))
  })
  toast(words ? `Recognized ${words} words${language ? ` (${language})` : ''}. The text can now be searched and selected.` : 'No text was found on those pages.')
}

/** Images: recognize the text and put it on the clipboard (like Live Text). */
export async function copyImageText(doc: ImageDoc | null = activeDoc.value instanceof ImageDoc ? activeDoc.value : null): Promise<void> {
  if (!doc) return
  if (!platform.ocrAvailable) return toast('Text recognition uses the Windows OCR engine, available in the Windows app.', 'error')
  try {
    const text = await withBusy('Recognizing text…', async () => {
      let r = doc.editable ? await engine.flatten(doc) : await engine.loadRaster(doc)
      const max = Math.min(await platform.ocrMaxDimension(), 4000) || 2600
      const s = Math.min(1, max / Math.max(r.width, r.height))
      if (s < 1) r = await engine.resize(r, Math.round(r.width * s), Math.round(r.height * s))
      const res = await platform.ocrImage(r.data as Uint8ClampedArray, r.width, r.height)
      return res.lines.map((l) => l.text).join('\n')
    })
    if (!text.trim()) return toast('No text found in this image.')
    await platform.copyText(text)
    toast(`Copied ${text.split(/\s+/).filter(Boolean).length} words`)
  } catch (e) {
    toast(String((e as Error).message ?? e), 'error')
  }
}
