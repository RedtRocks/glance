/**
 * Turns a text selection in the PDF text layer into highlight/underline/strikeout
 * markup or redactions, per page, in PDF coordinates.
 */
import { newId, type Markup } from '../../core/markup'
import type { PdfDoc } from '../../state/documents'
import { getViewport } from '../../pdf/viewports'
import { highlightColor, style } from '../../state/markupState'

export type TextMarkupKind = 'highlight' | 'underline' | 'strike' | 'redact'

interface PageQuads {
  page: number
  quads: number[][]
}

/** Client rects of the current selection, grouped by page and converted to PDF quads. */
export function selectionQuads(doc: PdfDoc, root: HTMLElement): { pages: PageQuads[]; text: string } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const pageEls = [...root.querySelectorAll<HTMLElement>('.pdf-page[data-page]')].map((el) => ({
    el,
    page: Number(el.dataset.page),
    box: el.getBoundingClientRect()
  }))
  const seen = new Set<string>()
  const byPage = new Map<number, number[][]>()
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue
    const k = `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`
    if (seen.has(k)) continue
    seen.add(k)
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hit = pageEls.find(({ box }) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom)
    if (!hit) continue
    const vp = getViewport(doc.id, hit.page)
    if (!vp) continue
    const pdf = (x: number, y: number) => vp.convertToPdfPoint(x - hit.box.left, y - hit.box.top) as [number, number]
    const tl = pdf(r.left, r.top)
    const tr = pdf(r.right, r.top)
    const bl = pdf(r.left, r.bottom)
    const br = pdf(r.right, r.bottom)
    byPage.set(hit.page, [...(byPage.get(hit.page) ?? []), [...tl, ...tr, ...bl, ...br]])
  }
  if (!byPage.size) return null
  return { pages: [...byPage].map(([page, quads]) => ({ page, quads })), text: sel.toString() }
}

/** Applies a text-markup kind to the current selection. Returns true if something was added. */
export function markSelection(doc: PdfDoc, root: HTMLElement, kind: TextMarkupKind): boolean {
  const found = selectionQuads(doc, root)
  if (!found) return false
  window.getSelection()?.removeAllRanges()
  if (kind === 'redact') {
    const reds = found.pages.flatMap(({ page, quads }) =>
      quads.map((q) => ({
        id: newId('redact'),
        page,
        rect: [Math.min(q[0], q[4]), Math.min(q[5], q[7]), Math.max(q[2], q[6]), Math.max(q[1], q[3])] as [number, number, number, number]
      }))
    )
    doc.edit('Mark for Redaction', { redactions: [...doc.redactions.peek(), ...reds] })
    return true
  }
  const color = kind === 'highlight' ? highlightColor.peek() : (style.peek().stroke ?? [0.867, 0.184, 0.161])
  const added: Markup[] = found.pages.map(({ page, quads }) => ({
    id: newId(),
    page,
    created: Date.now(),
    style: { stroke: color, fill: null, width: 1, opacity: kind === 'highlight' ? 1 : 1 },
    type: kind,
    quads,
    text: found.text
  }))
  const label = { highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough' }[kind]
  doc.edit(label, { markup: [...doc.markup.peek(), ...added] })
  return true
}
