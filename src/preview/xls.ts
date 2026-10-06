/**
 * Excel 97-2003 workbooks (.xls, BIFF8): sheet names, cell values as Excel last
 * calculated them, number formats, fonts, column widths, row heights and merged
 * cells, in the same shape preview/xlsx.ts gives. Format: [MS-XLS] inside a compound
 * file ([MS-CFB], read with @kenjiuno/msgreader's reader, already used for .msg).
 */
import { Reader } from '@kenjiuno/msgreader/lib/Reader'
import { BUILTIN_FORMATS, formatValue, type CellStyle, type XlsxSheet } from './xlsx'

const MAX_CELLS = 400_000

interface BiffRecord {
  type: number
  /** Body, with any CONTINUE records joined on. */
  data: DataView
  /** Where each CONTINUE started in `data`: strings re-state their width there. */
  breaks: number[]
}

export function readXls(bytes: Uint8Array): XlsxSheet[] {
  const cfb = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  try {
    cfb.parse()
  } catch {
    throw new Error('This isn’t an Excel workbook.')
  }
  const root = cfb.rootFolder()
  const stream = root.readFile('Workbook') ?? root.readFile('WORKBOOK')
  if (!stream) {
    if (root.readFile('Book')) throw new Error('Workbooks from Excel 95 and earlier can’t be previewed.')
    throw new Error('This isn’t an Excel workbook.')
  }

  // Workbook globals: strings, formats, fonts, cell styles and where each sheet starts.
  const shared: string[] = []
  const formats = new Map<number, string>()
  const fonts: CellStyle[] = []
  const xfs: CellStyle[] = []
  const sheetStarts: { name: string; at: number }[] = []
  let date1904 = false
  for (const r of records(stream, 0)) {
    const d = r.data
    switch (r.type) {
      case 0x002f:
        throw new Error('The workbook is password-protected.')
      case 0x0022:
        date1904 = d.getUint16(0, true) === 1
        break
      case 0x00fc:
        readSst(r, shared)
        break
      case 0x041e:
        formats.set(d.getUint16(0, true), unicodeString(d, 2, true).text)
        break
      case 0x0031: {
        const grbit = d.getUint16(2, true)
        const icv = d.getUint16(4, true)
        fonts.push({ size: d.getUint16(0, true) / 20, italic: (grbit & 2) !== 0, bold: d.getUint16(6, true) >= 700, underline: d.getUint8(10) !== 0, color: PALETTE[icv] })
        // Font 4 doesn't exist; indexes skip it.
        if (fonts.length === 4) fonts.push({})
        break
      }
      case 0x00e0: {
        const font = fonts[d.getUint16(0, true)] ?? {}
        const ifmt = d.getUint16(2, true)
        const align = d.getUint8(6)
        xfs.push({ ...font, numFmt: formats.get(ifmt) ?? BUILTIN_FORMATS[ifmt], align: ['', 'left', 'center', 'right'][align & 7] || undefined, wrap: (align & 8) !== 0 })
        break
      }
      case 0x0085:
        // Worksheets that aren't hidden; chart and macro sheets have nothing to show here.
        if (d.getUint8(4) === 0 && d.getUint8(5) === 0) sheetStarts.push({ name: unicodeString(d, 6, false).text, at: d.getUint32(0, true) })
        break
    }
    if (r.type === 0x000a) break
  }

  let budget = MAX_CELLS
  const sheets = sheetStarts.map(({ name, at }) => {
    const sheet: XlsxSheet = { name, rows: 0, cols: 0, cells: new Map(), widths: new Map(), heights: new Map(), merges: [] }
    const put = (row: number, col: number, ixfe: number, text: string, number: boolean): void => {
      if (--budget < 0) throw new Error('This workbook is too large to preview.')
      if (text === '') return
      sheet.cells.set(`${row}:${col}`, { text, number, style: xfs[ixfe] ?? {} })
      sheet.rows = Math.max(sheet.rows, row + 1)
      sheet.cols = Math.max(sheet.cols, col + 1)
    }
    const num = (row: number, col: number, ixfe: number, n: number): void => put(row, col, ixfe, formatValue(n, xfs[ixfe]?.numFmt, date1904), true)
    /** A formula whose text result follows in a STRING record. */
    let pending: [number, number, number] | null = null
    for (const r of records(stream, at)) {
      const d = r.data
      if (r.type === 0x000a) break
      if (d.byteLength < 6 && r.type !== 0x0207 && r.type !== 0x00e5) continue
      const row = d.getUint16(0, true)
      const col = d.getUint16(2, true)
      const ixfe = d.getUint16(4, true)
      switch (r.type) {
        case 0x0203:
          num(row, col, ixfe, d.getFloat64(6, true))
          break
        case 0x027e:
          num(row, col, ixfe, rk(d.getUint32(6, true)))
          break
        case 0x00bd:
          for (let i = 4, c = col; i + 6 <= d.byteLength - 2; i += 6, c++) num(row, c, d.getUint16(i, true), rk(d.getUint32(i + 2, true)))
          break
        case 0x00fd:
          put(row, col, ixfe, shared[d.getUint32(6, true)] ?? '', false)
          break
        case 0x0204:
          put(row, col, ixfe, unicodeString(d, 6, true).text, false)
          break
        case 0x0205:
          put(row, col, ixfe, d.getUint8(7) ? ERRORS[d.getUint8(6)] ?? '#N/A' : d.getUint8(6) ? 'TRUE' : 'FALSE', false)
          break
        case 0x0006:
          if (d.getUint16(12, true) !== 0xffff) num(row, col, ixfe, d.getFloat64(6, true))
          else if (d.getUint8(6) === 0) pending = [row, col, ixfe]
          else if (d.getUint8(6) === 1) put(row, col, ixfe, d.getUint8(8) ? 'TRUE' : 'FALSE', false)
          else if (d.getUint8(6) === 2) put(row, col, ixfe, ERRORS[d.getUint8(8)] ?? '#N/A', false)
          break
        case 0x0207:
          if (pending) put(...pending, unicodeString(d, 0, true).text, false)
          pending = null
          break
        case 0x00e5:
          for (let i = 0, n = d.getUint16(0, true); i < n && 2 + i * 8 + 8 <= d.byteLength; i++) {
            const o = 2 + i * 8
            const r1 = d.getUint16(o, true)
            const c1 = d.getUint16(o + 4, true)
            sheet.merges.push({ r: r1, c: c1, rows: d.getUint16(o + 2, true) - r1 + 1, cols: d.getUint16(o + 6, true) - c1 + 1 })
          }
          break
        case 0x007d: {
          // COLINFO: first and last column, width in 1/256 of a character.
          const hidden = (d.getUint16(8, true) & 1) !== 0
          for (let c = row; c <= Math.min(col, 200); c++) sheet.widths.set(c, hidden ? 0 : ixfe / 256)
          break
        }
        case 0x0208: {
          const height = d.getUint16(6, true)
          if (!(height & 0x8000) && d.byteLength >= 16 && d.getUint16(12, true) & 0x40) sheet.heights.set(row, (height & 0x7fff) / 20)
          break
        }
      }
    }
    return sheet
  })
  if (!sheets.length) throw new Error('This workbook has no visible sheets.')
  return sheets
}

function* records(s: Uint8Array, from: number): Generator<BiffRecord> {
  const v = new DataView(s.buffer, s.byteOffset, s.byteLength)
  let i = from
  while (i + 4 <= s.length) {
    const type = v.getUint16(i, true)
    let len = v.getUint16(i + 2, true)
    const start = i + 4
    i = start + len
    if (i > s.length) return
    const breaks: number[] = []
    // CONTINUE records carry on the body of the one before.
    if (i + 4 <= s.length && v.getUint16(i, true) === 0x003c) {
      const parts = [s.subarray(start, start + len)]
      while (i + 4 <= s.length && v.getUint16(i, true) === 0x003c) {
        const n = v.getUint16(i + 2, true)
        breaks.push(len)
        parts.push(s.subarray(i + 4, i + 4 + n))
        len += n
        i += 4 + n
      }
      const joined = new Uint8Array(len)
      let o = 0
      for (const p of parts) {
        joined.set(p, o)
        o += p.length
      }
      yield { type, data: new DataView(joined.buffer), breaks }
      continue
    }
    yield { type, data: new DataView(s.buffer, s.byteOffset + start, len), breaks }
  }
}

/** A string with a 1- or 2-byte length, a flags byte, then 8-bit or UTF-16 characters. */
function unicodeString(d: DataView, at: number, wide: boolean, breaks: number[] = []): { text: string; end: number } {
  if (at + (wide ? 3 : 2) > d.byteLength) return { text: '', end: d.byteLength }
  const cch = wide ? d.getUint16(at, true) : d.getUint8(at)
  let i = at + (wide ? 2 : 1)
  const flags = d.getUint8(i++)
  let high = (flags & 1) !== 0
  const runs = flags & 8 ? d.getUint16(i, true) : 0
  if (flags & 8) i += 2
  const ext = flags & 4 ? d.getUint32(i, true) : 0
  if (flags & 4) i += 4
  let text = ''
  for (let n = 0; n < cch && i < d.byteLength; n++) {
    // At a CONTINUE boundary the string goes on with a fresh width flag.
    if (breaks.includes(i)) high = (d.getUint8(i++) & 1) !== 0
    if (high) {
      text += String.fromCharCode(d.getUint16(i, true))
      i += 2
    } else {
      const b = d.getUint8(i++)
      text += CP1252[b] ?? String.fromCharCode(b)
    }
  }
  return { text, end: i + runs * 4 + ext }
}

function readSst(r: BiffRecord, out: string[]): void {
  const count = r.data.getUint32(4, true)
  let at = 8
  for (let k = 0; k < count && at < r.data.byteLength; k++) {
    const s = unicodeString(r.data, at, true, r.breaks)
    out.push(s.text)
    at = s.end
  }
}

/** RK numbers: a 30-bit integer or the top of a double, maybe times 100. */
function rk(v: number): number {
  let n: number
  if (v & 2) n = v >> 2
  else {
    const buf = new DataView(new ArrayBuffer(8))
    buf.setUint32(4, v & 0xfffffffc, true)
    n = buf.getFloat64(0, true)
  }
  return v & 1 ? n / 100 : n
}

const ERRORS: { [code: number]: string } = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' }

/** Excel's default colour palette, by index (8-63); 0x7FFF is automatic. */
const PALETTE: { [icv: number]: string | undefined } = Object.fromEntries(
  [
    '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080',
    'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF',
    '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC',
    '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'
  ].map((c, i) => [i + 8, c === '000000' ? undefined : `#${c}`])
)

/** Windows-1252's 0x80-0x9F, for 8-bit strings. */
const CP1252: { [code: number]: string } = Object.fromEntries(
  [...'€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'].map((c, i) => [0x80 + i, c])
)
