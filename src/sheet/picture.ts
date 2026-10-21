/**
 * Pictures of sheets: PNG of a sheet's used area, a PDF of every visible sheet fitted to
 * the page width, and a PNG of each chart for the saved .xlsx (Excel shows the picture;
 * Glance keeps the live chart in its own hidden sheet).
 */
import { SheetLayout } from '../core/sheet/layout'
import { CfEngine } from '../core/sheet/cf'
import { usedBounds, type Chart, type Sheet, type Workbook } from '../core/sheet/model'
import { todaySerial } from '../core/sheet/recalc'
import { drawPane } from './render'
import { chartData, drawChart, type Ctx } from './charts'

function canvas(w: number, h: number): { el: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx } {
  const el = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  return { el, ctx: el.getContext('2d') as Ctx }
}

async function toPng(el: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  const blob = 'convertToBlob' in el ? await el.convertToBlob({ type: 'image/png' }) : await new Promise<Blob>((ok, no) => el.toBlob((b) => (b ? ok(b) : no(new Error('no picture'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Decodes a sheet's pictures for drawing. */
export async function decodePictures(sheet: Sheet, media: Map<string, Uint8Array>): Promise<Map<string, CanvasImageSource>> {
  const out = new Map<string, CanvasImageSource>()
  for (const im of sheet.images) {
    const bytes = media.get(im.media)
    if (!bytes || out.has(im.media)) continue
    try {
      out.set(im.media, await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>])))
    } catch {
      // A picture the browser can't decode is left out.
    }
  }
  return out
}

/** The area a picture of the sheet covers, in sheet pixels: its cells, pictures and charts. */
export function sheetExtent(sheet: Sheet, l = new SheetLayout(sheet)): { w: number; h: number } {
  const b = usedBounds(sheet)
  let w = l.x(Math.max(0, b.cols + 1))
  let h = l.y(Math.max(0, b.rows + 1))
  for (const a of [...sheet.images.map((i) => i.anchor), ...sheet.charts.map((c) => c.anchor)]) {
    w = Math.max(w, l.x(a.to.c) + (a.to.dx ?? 0))
    h = Math.max(h, l.y(a.to.r) + (a.to.dy ?? 0))
  }
  return { w: Math.max(w, 64), h: Math.max(h, 20) }
}

/** Draws the sheet's used area at `scale` onto a new canvas. */
export async function drawSheet(wb: Workbook, sheet: Sheet, media: Map<string, Uint8Array>, scale = 2): Promise<OffscreenCanvas | HTMLCanvasElement> {
  const layout = new SheetLayout(sheet)
  const { w, h } = sheetExtent(sheet, layout)
  const W = Math.min(16000, Math.ceil(w * scale))
  const H = Math.min(16000, Math.ceil(h * scale))
  const { el, ctx } = canvas(W, H)
  const pictures = await decodePictures(sheet, media)
  drawPane(ctx, { wb, sheet, layout, cf: new CfEngine(wb, sheet, { today: todaySerial() }), zoom: scale, pictures }, { x: 0, y: 0, w: W, h: H, sx: 0, sy: 0 })
  return el
}

export async function sheetPng(wb: Workbook, sheet: Sheet, media: Map<string, Uint8Array>, scale = 2): Promise<Uint8Array> {
  return toPng(await drawSheet(wb, sheet, media, scale))
}

export async function chartPng(wb: Workbook, sheet: Sheet, ch: Chart): Promise<Uint8Array | null> {
  try {
    const l = new SheetLayout(sheet)
    const x = l.x(ch.anchor.from.c) + (ch.anchor.from.dx ?? 0)
    const y = l.y(ch.anchor.from.r) + (ch.anchor.from.dy ?? 0)
    const w = Math.max(80, l.x(ch.anchor.to.c) + (ch.anchor.to.dx ?? 0) - x)
    const h = Math.max(60, l.y(ch.anchor.to.r) + (ch.anchor.to.dy ?? 0) - y)
    const { el, ctx } = canvas(w * 2, h * 2)
    ctx.scale(2, 2)
    drawChart(ctx, ch, chartData(wb, sheet, ch), 0, 0, w, h)
    return await toPng(el)
  } catch {
    return null
  }
}

/** Every visible sheet, fitted to the width of an A4 page (landscape when wide), split down the pages. */
export async function workbookPdf(wb: Workbook, media: Map<string, Uint8Array>): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const pdf = await PDFDocument.create()
  const margin = 28
  for (const sheet of wb.sheets.filter((s) => !s.hidden)) {
    const pic = await drawSheet(wb, sheet, media, 2)
    const landscape = pic.width > pic.height
    const [pw, ph] = landscape ? [842, 595] : [595, 842]
    const fit = (pw - margin * 2) / pic.width
    const sliceH = Math.floor((ph - margin * 2) / fit)
    for (let top = 0; top < pic.height; top += sliceH) {
      const hh = Math.min(sliceH, pic.height - top)
      const { el, ctx } = canvas(pic.width, hh)
      ctx.drawImage(pic as CanvasImageSource, 0, top, pic.width, hh, 0, 0, pic.width, hh)
      const img = await pdf.embedPng(await toPng(el))
      const page = pdf.addPage([pw, ph])
      page.drawImage(img, { x: margin, y: ph - margin - hh * fit, width: pic.width * fit, height: hh * fit })
    }
  }
  return pdf.save()
}
