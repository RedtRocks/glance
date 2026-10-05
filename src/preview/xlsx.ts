/**
 * A small reader for Excel workbooks (.xlsx): sheet names, cell values as Excel
 * last calculated them, number formats, fonts, fills, column widths and merged
 * cells. Charts, images and conditional formatting aren't read.
 *
 * The XML goes through DOMParser, which never runs anything in it.
 */
import JSZip from 'jszip'

export interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  size?: number
  color?: string
  fill?: string
  align?: string
  wrap?: boolean
  numFmt?: string
}

export interface XlsxCell {
  text: string
  number: boolean
  style: CellStyle
}

export interface XlsxSheet {
  name: string
  rows: number
  cols: number
  /** "row:col", 0-based. */
  cells: Map<string, XlsxCell>
  /** Width in characters per 0-based column, when set. */
  widths: Map<number, number>
  /** Height in points per 0-based row, when set. */
  heights: Map<number, number>
  merges: { r: number; c: number; rows: number; cols: number }[]
}

/** Stop before a hostile file can exhaust memory. */
const MAX_CELLS = 400_000
const MAX_XML = 64 * 1024 * 1024

const BUILTIN_FORMATS: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@'
}

/** The theme's standard colours, by index (Office default theme), for fills and fonts that name one. */
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']

async function xml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path)
  if (!file) return null
  const text = await file.async('string')
  if (text.length > MAX_XML) throw new Error('This workbook is too large to preview.')
  return new DOMParser().parseFromString(text, 'application/xml')
}

/** Elements by local name, whatever namespace prefix the file uses. */
function all(root: Element | Document, name: string): Element[] {
  return [...root.getElementsByTagNameNS('*', name)]
}
function first(root: Element | Document, name: string): Element | undefined {
  return root.getElementsByTagNameNS('*', name)[0]
}
function children(el: Element, name: string): Element[] {
  return [...el.children].filter((c) => c.localName === name)
}

function color(el: Element | undefined): string | undefined {
  if (!el) return undefined
  const rgb = el.getAttribute('rgb')
  if (rgb) return `#${rgb.length === 8 ? rgb.slice(2) : rgb}`
  const theme = el.getAttribute('theme')
  if (theme !== null && THEME[Number(theme)]) return `#${THEME[Number(theme)]}`
  return undefined
}

/** "B12" → [11, 1]. */
export function parseRef(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.replace(/\$/g, '').toUpperCase())
  if (!m) return [0, 0]
  let col = 0
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64
  return [Number(m[2]) - 1, col - 1]
}

export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheet[]> {
  const zip = await JSZip.loadAsync(bytes)
  const workbook = await xml(zip, 'xl/workbook.xml')
  if (!workbook) throw new Error('This isn’t an Excel workbook.')
  const date1904 = first(workbook, 'workbookPr')?.getAttribute('date1904') === '1'

  // Sheet name → part, through the workbook's relationships.
  const rels = await xml(zip, 'xl/_rels/workbook.xml.rels')
  const targets = new Map<string, string>()
  for (const r of rels ? all(rels, 'Relationship') : []) {
    const target = r.getAttribute('Target') ?? ''
    targets.set(r.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }

  const shared: string[] = []
  const sst = await xml(zip, 'xl/sharedStrings.xml')
  for (const si of sst ? all(sst, 'si') : []) shared.push(all(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join(''))

  const styles = await readStyles(zip)
  const sheets: XlsxSheet[] = []
  let budget = MAX_CELLS
  for (const s of all(workbook, 'sheet')) {
    if (s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden') continue
    const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? ''
    const doc = await xml(zip, targets.get(id) ?? '')
    if (!doc) continue
    const sheet: XlsxSheet = { name: s.getAttribute('name') ?? '', rows: 0, cols: 0, cells: new Map(), widths: new Map(), heights: new Map(), merges: [] }
    for (const col of all(doc, 'col')) {
      const w = Number(col.getAttribute('width'))
      if (!w) continue
      const hidden = col.getAttribute('hidden') === '1'
      for (let c = Number(col.getAttribute('min')) - 1; c < Math.min(Number(col.getAttribute('max')), 200); c++) sheet.widths.set(c, hidden ? 0 : w)
    }
    for (const row of all(doc, 'row')) {
      const r = Number(row.getAttribute('r') ?? 0) - 1
      const ht = Number(row.getAttribute('ht'))
      if (ht && row.getAttribute('customHeight') === '1') sheet.heights.set(r, ht)
      for (const c of children(row, 'c')) {
        if (--budget < 0) throw new Error('This workbook is too large to preview.')
        const [y, x] = parseRef(c.getAttribute('r') ?? '')
        const style = styles[Number(c.getAttribute('s') ?? 0)] ?? {}
        const type = c.getAttribute('t')
        const v = first(c, 'v')?.textContent ?? ''
        let text = ''
        let number = false
        if (type === 's') text = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') text = all(c, 't').map((t) => t.textContent ?? '').join('')
        else if (type === 'b') text = v === '1' ? 'TRUE' : v === '' ? '' : 'FALSE'
        else if (type === 'str' || type === 'e') text = v
        else if (v !== '') {
          number = true
          text = formatValue(Number(v), style.numFmt, date1904)
        }
        if (text === '' && !style.fill) continue
        sheet.cells.set(`${y}:${x}`, { text, number, style })
        sheet.rows = Math.max(sheet.rows, y + 1)
        sheet.cols = Math.max(sheet.cols, x + 1)
      }
    }
    for (const m of all(doc, 'mergeCell')) {
      const [a, b] = (m.getAttribute('ref') ?? '').split(':')
      if (!b) continue
      const [r1, c1] = parseRef(a)
      const [r2, c2] = parseRef(b)
      sheet.merges.push({ r: r1, c: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 })
    }
    sheets.push(sheet)
  }
  if (!sheets.length) throw new Error('This workbook has no visible sheets.')
  return sheets
}

async function readStyles(zip: JSZip): Promise<CellStyle[]> {
  const doc = await xml(zip, 'xl/styles.xml')
  if (!doc) return []
  const formats = new Map<number, string>()
  for (const f of all(doc, 'numFmt')) formats.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '')
  const fontsEl = first(doc, 'fonts')
  const fonts = fontsEl
    ? children(fontsEl, 'font').map((f) => ({
        bold: !!children(f, 'b').length && children(f, 'b')[0].getAttribute('val') !== '0',
        italic: !!children(f, 'i').length,
        underline: !!children(f, 'u').length,
        size: Number(children(f, 'sz')[0]?.getAttribute('val')) || undefined,
        color: color(children(f, 'color')[0])
      }))
    : []
  const fillsEl = first(doc, 'fills')
  const fills = fillsEl
    ? children(fillsEl, 'fill').map((f) => {
        const p = first(f, 'patternFill')
        return p?.getAttribute('patternType') === 'solid' ? color(first(p, 'fgColor')) : undefined
      })
    : []
  const xfs = first(doc, 'cellXfs')
  return (xfs ? children(xfs, 'xf') : []).map((xf) => {
    const font = fonts[Number(xf.getAttribute('fontId') ?? 0)] ?? {}
    const id = Number(xf.getAttribute('numFmtId') ?? 0)
    const align = first(xf, 'alignment')
    return {
      ...font,
      fill: fills[Number(xf.getAttribute('fillId') ?? 0)],
      numFmt: formats.get(id) ?? BUILTIN_FORMATS[id],
      align: align?.getAttribute('horizontal') ?? undefined,
      wrap: align?.getAttribute('wrapText') === '1'
    }
  })
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Formats a number the way the cell's number format would, for the common formats. */
export function formatValue(n: number, fmt: string | undefined, date1904 = false): string {
  if (!fmt || fmt === 'General' || fmt === '@') return String(Math.round(n * 1e10) / 1e10)
  // Only the positive section; negatives get a minus sign.
  const section = fmt.split(';')[0].replace(/\[(Red|Black|Blue|Green|Color\d+)\]/gi, '')
  const bare = section.replace(/"[^"]*"|\\./g, '')
  if (/[ymdhs]/i.test(bare) && !/[0#?]/.test(bare)) return formatDate(n, section, date1904)
  const decimals = /\.(0+)/.exec(bare)?.[1].length ?? 0
  const percent = bare.includes('%')
  const scientific = /E\+/i.test(bare)
  const value = percent ? n * 100 : n
  let s = scientific
    ? Math.abs(value).toExponential(decimals).toUpperCase().replace(/E\+?(-?)(\d)$/, 'E+$1$2')
    : Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: bare.includes(',') })
  const currency = /\[\$([^\]-]*)[^\]]*\]|([$€£¥])/.exec(section)
  if (currency?.[1] ?? currency?.[2]) s = (currency[1] ?? currency[2]) + s
  if (percent) s += '%'
  const literal = /"([^"]*)"\s*$/.exec(section)
  if (literal) s += literal[1]
  return value < 0 && !fmt.includes(';') ? `-${s}` : value < 0 ? `(${s})` : s
}

function formatDate(serial: number, fmt: string, date1904: boolean): string {
  // Excel's day 0 is 1899-12-30 (it counts a 29 February 1900 that never was).
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const d = new Date(epoch + Math.round(serial * 86400000))
  const pad = (v: number, n = 2) => String(v).padStart(n, '0')
  const twelve = /AM\/PM/i.test(fmt)
  const hours = d.getUTCHours()
  let out = ''
  const tokens = fmt.replace(/"([^"]*)"/g, '\u0000$1\u0001').match(/\u0000[^\u0001]*\u0001|AM\/PM|y+|m+|d+|h+|s+|\[h+\]|./gi) ?? []
  tokens.forEach((tok, i) => {
    const lower = tok.toLowerCase()
    // "m" after an hour or before seconds means minutes.
    const minute = lower.startsWith('m') && (/h/i.test(tokens.slice(Math.max(0, i - 2), i).join('')) || /^:?s/i.test(tokens.slice(i + 1, i + 3).join('').replace(/^:/, '')))
    if (tok.startsWith('\u0000')) out += tok.slice(1, -1)
    else if (lower === 'am/pm') out += hours < 12 ? 'AM' : 'PM'
    else if (lower.startsWith('y')) out += lower.length > 2 ? d.getUTCFullYear() : pad(d.getUTCFullYear() % 100)
    else if (minute) out += lower.length > 1 ? pad(d.getUTCMinutes()) : d.getUTCMinutes()
    else if (lower.startsWith('m')) out += lower.length >= 4 ? MONTHS[d.getUTCMonth()] : lower.length === 3 ? MONTHS[d.getUTCMonth()].slice(0, 3) : lower.length === 2 ? pad(d.getUTCMonth() + 1) : d.getUTCMonth() + 1
    else if (lower.startsWith('d')) out += lower.length >= 4 ? d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : lower.length === 3 ? d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : lower.length === 2 ? pad(d.getUTCDate()) : d.getUTCDate()
    else if (lower.startsWith('[h')) out += Math.floor(serial * 24)
    else if (lower.startsWith('h')) {
      const h = twelve ? hours % 12 || 12 : hours
      out += lower.length > 1 ? pad(h) : h
    } else if (lower.startsWith('s')) out += pad(d.getUTCSeconds())
    else if (tok !== '\\') out += tok
  })
  return out
}
