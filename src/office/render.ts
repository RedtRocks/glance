/**
 * Read-only previews of Word, PowerPoint and Excel files, drawn as HTML into a
 * container. Loaded only when such a file is opened (see ui/views/OfficeView.tsx).
 *
 *   Word        docx-preview (Apache-2.0)
 *   PowerPoint  @aiden0z/pptx-renderer (Apache-2.0)
 *   Excel       office/xlsx.ts; CSV and TSV are parsed here
 */
import type { OfficeFlavor } from '../core/office'

export interface OfficeRendering {
  /** Pages (Word), slides or sheets. */
  pageCount: number
  /** Sheet names, for a workbook's tabs. */
  sheetNames: string[]
  goTo(index: number): void
  setZoom(scale: number): void
  dispose(): void
}

export interface RenderOptions {
  /** The element that scrolls; slides use it to track which one is in view. */
  scroller: HTMLElement
  onCurrent(index: number): void
}

export async function renderOffice(flavor: OfficeFlavor, ext: string, bytes: Uint8Array, container: HTMLElement, opts: RenderOptions): Promise<OfficeRendering> {
  container.replaceChildren()
  const rendering =
    flavor === 'word' ? await renderWord(bytes, container, opts) : flavor === 'slides' ? await renderSlides(bytes, container, opts) : await renderSheets(ext, bytes, container)
  defuseLinks(container)
  return rendering
}

/**
 * Links in a document are the file author's, not ours: only web and mail links
 * survive, and they open outside the app (the view hands clicks to the platform).
 */
export function defuseLinks(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) continue
    if (!/^(https?:|mailto:)/i.test(href)) a.removeAttribute('href')
  }
}

// ---------------------------------------------------------------------------
// Word

async function renderWord(bytes: Uint8Array, container: HTMLElement, opts: RenderOptions): Promise<OfficeRendering> {
  const { renderAsync } = await import('docx-preview')
  const styles = document.createElement('div')
  const body = document.createElement('div')
  body.className = 'office-word'
  container.append(styles, body)
  await renderAsync(bytes, body, styles, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    experimental: true,
    useBase64URL: true,
    renderChanges: false,
    renderComments: false,
    // Embedded HTML fragments: never shown.
    renderAltChunks: false
  })
  const pages = () => [...body.querySelectorAll<HTMLElement>('section.docx')]
  const observer = trackCurrent(pages(), opts)
  return {
    pageCount: Math.max(1, pages().length),
    sheetNames: [],
    goTo: (i) => pages()[i]?.scrollIntoView({ block: 'start' }),
    setZoom: (scale) => (body.style.zoom = String(scale)),
    dispose: () => observer.disconnect()
  }
}

/** Reports the page or slide that fills most of the view. */
function trackCurrent(items: HTMLElement[], opts: RenderOptions): IntersectionObserver {
  const ratios = new Map<Element, number>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) ratios.set(e.target, e.intersectionRatio)
      let best = -1
      let bestRatio = 0
      items.forEach((el, i) => {
        const r = ratios.get(el) ?? 0
        if (r > bestRatio) [best, bestRatio] = [i, r]
      })
      if (best >= 0) opts.onCurrent(best)
    },
    { root: opts.scroller, threshold: [0, 0.25, 0.5, 0.75, 1] }
  )
  for (const el of items) observer.observe(el)
  return observer
}

// ---------------------------------------------------------------------------
// PowerPoint

async function renderSlides(bytes: Uint8Array, container: HTMLElement, opts: RenderOptions): Promise<OfficeRendering> {
  const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer')
  const host = document.createElement('div')
  host.className = 'office-slides'
  container.append(host)
  const viewer = await PptxViewer.open(bytes, host, {
    zipLimits: RECOMMENDED_ZIP_LIMITS,
    fitMode: 'contain',
    scrollContainer: opts.scroller,
    lazySlides: true,
    lazyMedia: true,
    listOptions: { windowed: true },
    onSlideChange: (i) => opts.onCurrent(i)
  })
  return {
    pageCount: Math.max(1, viewer.slideCount),
    sheetNames: [],
    goTo: (i) => void viewer.goToSlide(i),
    setZoom: (scale) => void viewer.setZoom(Math.round(scale * 100)),
    dispose: () => host.replaceChildren()
  }
}

// ---------------------------------------------------------------------------
// Excel, CSV and TSV

interface Sheet {
  name: string
  table: HTMLTableElement
}

async function renderSheets(ext: string, bytes: Uint8Array, container: HTMLElement): Promise<OfficeRendering> {
  const sheets = ext === 'csv' || ext === 'tsv' ? [delimitedSheet(new TextDecoder().decode(bytes), ext === 'tsv' ? '\t' : ',')] : await workbookSheets(bytes)
  const host = document.createElement('div')
  host.className = 'office-sheets'
  container.append(host)
  let shown = 0
  const show = (i: number): void => {
    shown = Math.min(Math.max(i, 0), sheets.length - 1)
    host.replaceChildren(sheets[shown].table)
  }
  show(0)
  return {
    pageCount: sheets.length,
    sheetNames: sheets.map((s) => s.name),
    goTo: show,
    setZoom: (scale) => (host.style.zoom = String(scale)),
    dispose: () => host.replaceChildren()
  }
}

/** Parses CSV/TSV with quoted fields ("a, b" and doubled "" quotes). */
export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function delimitedSheet(text: string, sep: string): Sheet {
  const rows = parseDelimited(text.replace(/^﻿/, ''), sep)
  const width = Math.max(0, ...rows.map((r) => r.length))
  const table = gridTable(rows.length, width)
  rows.forEach((r, y) =>
    r.forEach((v, x) => {
      const td = table.rows[y + 1].cells[x + 1]
      td.textContent = v
      if (v !== '' && !isNaN(Number(v))) td.classList.add('num')
    })
  )
  return { name: '', table }
}

/** A table with A, B, C… across the top and row numbers down the side, like a spreadsheet. */
function gridTable(rows: number, cols: number): HTMLTableElement {
  const table = document.createElement('table')
  table.className = 'sheet-grid'
  const head = table.insertRow()
  head.appendChild(document.createElement('th'))
  for (let x = 0; x < cols; x++) {
    const th = document.createElement('th')
    th.textContent = columnName(x)
    head.appendChild(th)
  }
  for (let y = 0; y < rows; y++) {
    const tr = table.insertRow()
    const th = document.createElement('th')
    th.textContent = String(y + 1)
    tr.appendChild(th)
    for (let x = 0; x < cols; x++) tr.insertCell()
  }
  return table
}

export function columnName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

async function workbookSheets(bytes: Uint8Array): Promise<Sheet[]> {
  const { readXlsx } = await import('./xlsx')
  return (await readXlsx(bytes)).map((sheet) => {
    // A little room past the data, as a spreadsheet would show.
    const table = gridTable(Math.max(sheet.rows, 1), Math.max(sheet.cols, 1))
    // Widths are in characters, about 7px each at Excel's default font.
    for (const [c, w] of sheet.widths) {
      const th = table.rows[0].cells[c + 1]
      if (th) th.style.width = th.style.minWidth = `${Math.round(w * 7 + 5)}px`
    }
    for (const [r, h] of sheet.heights) if (table.rows[r + 1]) table.rows[r + 1].style.height = `${Math.round(h * 1.33)}px`
    for (const [key, cell] of sheet.cells) {
      const [r, c] = key.split(':').map(Number)
      const td = table.rows[r + 1]?.cells[c + 1]
      if (!td) continue
      td.textContent = cell.text
      const st = cell.style
      if (st.bold) td.style.fontWeight = '700'
      if (st.italic) td.style.fontStyle = 'italic'
      if (st.underline) td.style.textDecoration = 'underline'
      if (st.size) td.style.fontSize = `${Math.round(st.size * 1.33)}px`
      if (st.color) td.style.color = st.color
      if (st.fill) td.style.background = st.fill
      if (st.align && ['left', 'center', 'right'].includes(st.align)) td.style.textAlign = st.align
      else if (cell.number) td.classList.add('num')
      if (st.wrap) td.style.whiteSpace = 'pre-wrap'
    }
    // Merged ranges: the top-left cell spans, the cells it covers go (right to left, so indexes hold).
    const covered: [number, number][] = []
    for (const m of sheet.merges) {
      const td = table.rows[m.r + 1]?.cells[m.c + 1]
      if (!td) continue
      td.rowSpan = m.rows
      td.colSpan = m.cols
      for (let r = m.r; r < m.r + m.rows; r++) for (let c = m.c; c < m.c + m.cols; c++) if (r !== m.r || c !== m.c) covered.push([r, c])
    }
    covered.sort((a, b) => b[1] - a[1])
    for (const [r, c] of covered) table.rows[r + 1]?.cells[c + 1]?.remove()
    return { name: sheet.name, table }
  })
}
