/**
 * Word 97-2003 .doc files, read far enough to show their text: paragraphs, headings,
 * bold/italic/underline, size and colour, alignment, tables and page breaks.
 * Pictures and the exact page layout are left to Word. Format: [MS-DOC] inside a
 * compound file ([MS-CFB], read with @kenjiuno/msgreader's reader, already used for .msg).
 */
import { Reader } from '@kenjiuno/msgreader/lib/Reader'

export interface DocRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Points. */
  size?: number
  color?: string
  /** Web or mail link from a HYPERLINK field. */
  link?: string
}

export interface DocParagraph {
  type: 'p'
  runs: DocRun[]
  /** 1 to 9 for Heading 1-9. */
  heading?: number
  align?: 'left' | 'center' | 'right' | 'justify'
  /** List bullet or number ("•", "2.", "iv)") and the list level, from 0. */
  marker?: string
  level?: number
}

export interface DocTable {
  type: 'table'
  rows: DocParagraph[][][]
}

export interface DocPageBreak {
  type: 'break'
}

export type DocBlock = DocParagraph | DocTable | DocPageBreak

/** A readable reason the file can't be shown; the view prints the message. */
export class DocError extends Error {}

export function readDoc(bytes: Uint8Array): DocBlock[] {
  const cfb = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  try {
    cfb.parse()
  } catch {
    throw new DocError('not-word')
  }
  const root = cfb.rootFolder()
  const word = root.readFile('WordDocument')
  if (!word || word.length < 0x200) throw new DocError('not-word')
  const w = new DataView(word.buffer, word.byteOffset, word.byteLength)
  if (w.getUint16(0, true) !== 0xa5ec) throw new DocError('not-word')
  const nFib = w.getUint16(2, true)
  const flags = w.getUint16(0x0a, true)
  if (flags & 0x0100) throw new DocError('encrypted')
  // Word 6 and 95 files: no piece table we read; their text sits between fcMin and fcMac.
  if (nFib < 101) return plainText(new TextDecoder('windows-1252').decode(word.subarray(w.getUint32(0x18, true), w.getUint32(0x1c, true))))

  const table = root.readFile(flags & 0x0200 ? '1Table' : '0Table')
  if (!table) throw new DocError('not-word')
  const t = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const ccpText = w.getInt32(0x4c, true)
  const fcLcb = (i: number): [number, number] => [w.getUint32(0x9a + i * 8, true), w.getUint32(0x9e + i * 8, true)]

  const pieces = readPieces(t, ...fcLcb(33))
  const chpx = readFkps(word, t, ...fcLcb(12), 'chp')
  const papx = readFkps(word, t, ...fcLcb(13), 'pap')

  // Walk the main text character by character, knowing each one's place in the file.
  const out = new Builder(readLists(t, fcLcb(73), fcLcb(74)))
  let cp = 0
  for (const p of pieces) {
    for (; cp < p.cpEnd && cp < ccpText; cp++) {
      const fc = p.compressed ? p.fc + (cp - p.cpStart) : p.fc + (cp - p.cpStart) * 2
      if (fc + (p.compressed ? 0 : 1) >= word.length) break
      const code = p.compressed ? word[fc] : word[fc] | (word[fc + 1] << 8)
      const ch = p.compressed ? CP1252[code] ?? String.fromCharCode(code) : String.fromCharCode(code)
      out.char(ch, chpAt(chpx, fc), () => papAt(papx, fc))
    }
    if (cp >= ccpText) break
  }
  return out.finish()
}

function plainText(text: string): DocBlock[] {
  return text.split(/\r\n?|\n/).map((line) => ({ type: 'p', runs: line ? [{ text: line.replace(/[\x00-\x08\x0b\x0e-\x1f]/g, '') }] : [] }))
}

// ---------------------------------------------------------------------------
// Piece table (the Clx): which stretch of characters lives where, and how it is encoded.

interface Piece {
  cpStart: number
  cpEnd: number
  fc: number
  compressed: boolean
}

function readPieces(t: DataView, fc: number, lcb: number): Piece[] {
  let i = fc
  const end = fc + lcb
  // Skip property modifiers (Prc), then the piece table itself (Pcdt).
  while (i < end && t.getUint8(i) === 1) i += 3 + t.getInt16(i + 1, true)
  if (i >= end || t.getUint8(i) !== 2) throw new DocError('not-word')
  const size = t.getUint32(i + 1, true)
  i += 5
  const n = (size - 4) / 12
  const pieces: Piece[] = []
  for (let k = 0; k < n; k++) {
    const raw = t.getUint32(i + (n + 1) * 4 + k * 8 + 2, true)
    const compressed = (raw & 0x40000000) !== 0
    pieces.push({
      cpStart: t.getUint32(i + k * 4, true),
      cpEnd: t.getUint32(i + (k + 1) * 4, true),
      fc: compressed ? (raw & ~0x40000000) / 2 : raw,
      compressed
    })
  }
  return pieces
}

// ---------------------------------------------------------------------------
// Formatting: character (CHPX) and paragraph (PAPX) runs, stored in 512-byte pages.

interface Chp {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  hidden?: boolean
  size?: number
  color?: string
  /** Picture or embedded object at this character. */
  special?: boolean
}

interface Pap {
  heading?: number
  align?: DocParagraph['align']
  inTable?: boolean
  ilfo?: number
  ilvl?: number
  rowEnd?: boolean
  pageBreakBefore?: boolean
}

interface Run<T> {
  start: number
  end: number
  props: T
}

function readFkps(word: Uint8Array, t: DataView, fc: number, lcb: number, kind: 'chp'): Run<Chp>[]
function readFkps(word: Uint8Array, t: DataView, fc: number, lcb: number, kind: 'pap'): Run<Pap>[]
function readFkps(word: Uint8Array, t: DataView, fc: number, lcb: number, kind: 'chp' | 'pap'): Run<Chp | Pap>[] {
  const runs: Run<Chp | Pap>[] = []
  const n = (lcb - 4) / 8
  for (let k = 0; k < n; k++) {
    const page = (t.getUint32(fc + (n + 1) * 4 + k * 4, true) & 0x3fffff) * 512
    if (page + 512 > word.length) continue
    const v = new DataView(word.buffer, word.byteOffset + page, 512)
    const count = v.getUint8(511)
    for (let r = 0; r < count; r++) {
      const start = v.getUint32(r * 4, true)
      const end = v.getUint32((r + 1) * 4, true)
      if (kind === 'chp') {
        const at = v.getUint8((count + 1) * 4 + r) * 2
        runs.push({ start, end, props: at ? chpFrom(sprms(v, at + 1, v.getUint8(at))) : {} })
      } else {
        const at = v.getUint8((count + 1) * 4 + r * 13) * 2
        if (!at) {
          runs.push({ start, end, props: {} })
          continue
        }
        let cb = v.getUint8(at)
        let from = at + 1
        let size = cb * 2 - 1
        if (cb === 0) {
          cb = v.getUint8(at + 1)
          from = at + 2
          size = cb * 2
        }
        if (from + size > 512 || size < 2) {
          runs.push({ start, end, props: {} })
          continue
        }
        const istd = v.getUint16(from, true)
        runs.push({ start, end, props: papFrom(istd, sprms(v, from + 2, size - 2)) })
      }
    }
  }
  return runs.sort((a, b) => a.start - b.start)
}

/** Property changes: [sprm, operand bytes] pairs. */
function sprms(v: DataView, from: number, size: number): [number, DataView][] {
  const list: [number, DataView][] = []
  const end = Math.min(from + size, v.byteLength)
  let i = from
  while (i + 2 <= end) {
    const sprm = v.getUint16(i, true)
    i += 2
    let len = [1, 1, 2, 4, 2, 2, 0, 3][sprm >> 13]
    if (len === 0) {
      if (i >= end) break
      if (sprm === 0xd608 || sprm === 0xc615) {
        // Table definitions carry a 2-byte length.
        if (i + 2 > end) break
        len = v.getUint16(i, true) - 1
        i += 2
      } else len = v.getUint8(i++)
    }
    if (i + len > end) break
    list.push([sprm, new DataView(v.buffer, v.byteOffset + i, len)])
    i += len
  }
  return list
}

// Toggles: 1 on, 0 off, 0x80/0x81 "as the style / opposite of the style", read as off/on.
const on = (d: DataView): boolean => d.getUint8(0) === 1 || d.getUint8(0) === 0x81

function chpFrom(list: [number, DataView][]): Chp {
  const c: Chp = {}
  for (const [sprm, d] of list) {
    switch (sprm) {
      case 0x0835: c.bold = on(d); break
      case 0x0836: c.italic = on(d); break
      case 0x0837: c.strike = on(d); break
      case 0x083c: c.hidden = on(d); break
      case 0x2a3e: c.underline = d.getUint8(0) !== 0; break
      case 0x4a43: c.size = d.getUint16(0, true) / 2; break
      case 0x2a42: c.color = ICO[d.getUint8(0)]; break
      case 0x6870: if (d.getUint8(3) === 0) c.color = hex(d.getUint8(0), d.getUint8(1), d.getUint8(2)); break
      case 0x0806: // sprmCFData
      case 0x080a: // sprmCFOle2
      case 0x0855: // sprmCFSpec
        c.special = c.special || on(d)
        break
    }
  }
  return c
}

const ALIGN: DocParagraph['align'][] = ['left', 'center', 'right', 'justify']

function papFrom(istd: number, list: [number, DataView][]): Pap {
  // The first styles have fixed slots: 1-9 are Heading 1-9.
  const p: Pap = istd >= 1 && istd <= 9 ? { heading: istd } : {}
  for (const [sprm, d] of list) {
    switch (sprm) {
      case 0x2403:
      case 0x2461: p.align = ALIGN[d.getUint8(0)]; break
      case 0x2640: { const lvl = d.getUint8(0); if (lvl < 9) p.heading = lvl + 1; break }
      case 0x2416: p.inTable = d.getUint8(0) !== 0; break
      case 0x6649: p.inTable = d.getInt32(0, true) > 0 || p.inTable; break
      case 0x2417: p.rowEnd = d.getUint8(0) !== 0; break
      case 0x460b: p.ilfo = d.getInt16(0, true); break
      case 0x260a: p.ilvl = d.getUint8(0); break
      case 0x2407: p.pageBreakBefore = d.getUint8(0) !== 0; break
    }
  }
  return p
}

function find<T>(runs: Run<T>[], fc: number): T | undefined {
  let lo = 0
  let hi = runs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = runs[mid]
    if (fc < r.start) hi = mid - 1
    else if (fc >= r.end) lo = mid + 1
    else return r.props
  }
  return undefined
}

const chpAt = (runs: Run<Chp>[], fc: number): Chp => find(runs, fc) ?? {}
const papAt = (runs: Run<Pap>[], fc: number): Pap => find(runs, fc) ?? {}

// ---------------------------------------------------------------------------
// Turning characters into blocks.

class Builder {
  constructor(private lists: Lists) {}
  /** Numbering so far, per list and level. */
  counters = new Map<number, number[]>()
  blocks: DocBlock[] = []
  runs: DocRun[] = []
  row: DocParagraph[][] = []
  cell: DocParagraph[] = []
  table: DocTable | null = null
  /** Open fields: their instructions, and whether the shown result has started. */
  fields: { code: string; shown: boolean; link?: string }[] = []

  char(ch: string, chp: Chp, pap: () => Pap): void {
    switch (ch) {
      case '\x13':
        this.fields.push({ code: '', shown: false })
        return
      case '\x14': {
        const f = this.fields[this.fields.length - 1]
        if (f) {
          f.shown = true
          f.link = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(f.code)?.[1]
        }
        return
      }
      case '\x15':
        this.fields.pop()
        return
    }
    // Inside a field's instructions (HYPERLINK "…", PAGE…): not shown.
    const open = this.fields[this.fields.length - 1]
    if (open && !open.shown) {
      open.code += ch
      return
    }
    if (this.fields.some((f) => !f.shown)) return
    switch (ch) {
      case '\r':
        return this.paragraph(pap())
      case '\x07':
        return this.cellEnd(pap())
      case '\x0c':
        this.paragraph(pap(), false)
        if (!this.table) this.blocks.push({ type: 'break' })
        return
      case '\x0b':
        return this.text('\n', chp)
      case '\x1e':
        return this.text('‑', chp)
      case '\x1f':
        return
      case '\t':
        return this.text('\t', chp)
    }
    if (ch < ' ' || chp.special || chp.hidden) return
    this.text(ch, chp)
  }

  text(ch: string, chp: Chp): void {
    const last = this.runs[this.runs.length - 1]
    const link = [...this.fields].reverse().find((f) => f.link)?.link
    if (last && same(last, chp) && last.link === link) last.text += ch
    else {
      const run: DocRun = { text: ch }
      if (link) run.link = link
      if (chp.bold) run.bold = true
      if (chp.italic) run.italic = true
      if (chp.underline) run.underline = true
      if (chp.strike) run.strike = true
      if (chp.size) run.size = chp.size
      if (chp.color) run.color = chp.color
      this.runs.push(run)
    }
  }

  paragraph(pap: Pap, always = true): void {
    if (!always && !this.runs.length) return
    const para: DocParagraph = { type: 'p', runs: this.runs }
    if (pap.heading) para.heading = pap.heading
    if (pap.align && pap.align !== 'left') para.align = pap.align
    if (pap.ilfo && pap.ilfo > 0 && always) this.number(para, pap.ilfo, Math.min(pap.ilvl ?? 0, 8))
    this.runs = []
    if (pap.inTable) this.cell.push(para)
    else {
      this.closeTable()
      if (pap.pageBreakBefore && this.blocks.length && this.blocks[this.blocks.length - 1].type !== 'break') this.blocks.push({ type: 'break' })
      this.blocks.push(para)
    }
  }

  number(para: DocParagraph, ilfo: number, level: number): void {
    const found = this.lists.get(ilfo)
    const list = found?.levels
    const lvl = list?.[level]
    if (!found || !list || !lvl) {
      para.marker = '•'
      para.level = level
      return
    }
    // Overrides of one list keep counting together.
    const counts = this.counters.get(found.id) ?? list.map((l) => (l?.start ?? 1) - 1)
    counts[level]++
    for (let k = level + 1; k < counts.length; k++) counts[k] = (list[k]?.start ?? 1) - 1
    this.counters.set(found.id, counts)
    para.level = level
    para.marker =
      lvl.nfc === 23
        ? bullet(lvl.text)
        : [...lvl.text].map((c) => (c.charCodeAt(0) < 9 ? formatNumber(counts[c.charCodeAt(0)] || list[c.charCodeAt(0)]?.start || 1, list[c.charCodeAt(0)]?.nfc ?? 0) : c)).join('')
  }

  cellEnd(pap: Pap): void {
    if (pap.rowEnd) {
      // The row's own end mark carries no text.
      this.runs = []
      if (!this.table) {
        this.table = { type: 'table', rows: [] }
        this.blocks.push(this.table)
      }
      this.table.rows.push(this.row)
      this.row = []
      this.cell = []
      return
    }
    if (this.runs.length || !this.cell.length) this.paragraph({ ...pap, inTable: true })
    this.row.push(this.cell)
    this.cell = []
  }

  closeTable(): void {
    if (this.row.length && this.table) this.table.rows.push(this.row)
    this.table = null
    this.row = []
    this.cell = []
  }

  finish(): DocBlock[] {
    if (this.runs.length) this.paragraph({})
    this.closeTable()
    return this.blocks
  }
}

function same(r: DocRun, c: Chp): boolean {
  return !!r.bold === !!c.bold && !!r.italic === !!c.italic && !!r.underline === !!c.underline && !!r.strike === !!c.strike && r.size === c.size && r.color === c.color
}

// ---------------------------------------------------------------------------
// Lists: what each list paragraph's bullet or number looks like.

interface Level {
  nfc: number
  start: number
  /** Number text, with characters 0-8 standing for each level's number. */
  text: string
}

/** By list paragraph's ilfo (from 1): the list's id and levels. */
type Lists = Map<number, { id: number; levels: (Level | undefined)[] }>

function readLists(t: DataView, [fcLst, lcbLst]: [number, number], [fcLfo, lcbLfo]: [number, number]): Lists {
  const lists: Lists = new Map()
  if (!lcbLst || !lcbLfo) return lists
  try {
    const count = t.getInt16(fcLst, true)
    const byId = new Map<number, (Level | undefined)[]>()
    let at = fcLst + 2 + count * 28
    for (let k = 0; k < count; k++) {
      const lstf = fcLst + 2 + k * 28
      const simple = (t.getUint8(lstf + 26) & 1) !== 0
      const levels: (Level | undefined)[] = []
      for (let l = 0; l < (simple ? 1 : 9); l++) {
        const start = t.getInt32(at, true)
        const nfc = t.getUint8(at + 4)
        const chpx = t.getUint8(at + 24)
        const papx = t.getUint8(at + 25)
        at += 28 + papx + chpx
        const len = t.getUint16(at, true)
        let text = ''
        for (let c = 0; c < len; c++) text += String.fromCharCode(t.getUint16(at + 2 + c * 2, true))
        at += 2 + len * 2
        levels.push({ nfc, start, text })
      }
      byId.set(t.getInt32(lstf, true), levels)
    }
    const lfos = t.getUint32(fcLfo, true)
    for (let k = 0; k < lfos; k++) {
      const id = t.getInt32(fcLfo + 4 + k * 16, true)
      const levels = byId.get(id)
      if (levels) lists.set(k + 1, { id, levels })
    }
  } catch {
    // A list table we can't read: list paragraphs fall back to plain bullets.
  }
  return lists
}

/** Bullets are often Symbol or Wingdings characters; show their usual look. */
function bullet(text: string): string {
  const c = text.charCodeAt(0)
  if (!text || c === 0xf0b7 || c === 0xf06c || c === 0xf09f) return '•'
  if (c === 0xf0a7 || c === 0xf06e) return '▪'
  if (c === 0x6f || c === 0xf06f) return '◦'
  if (c >= 0xf000 && c <= 0xf0ff) return '•'
  return text
}

function formatNumber(n: number, nfc: number): string {
  switch (nfc) {
    case 1: return roman(n)
    case 2: return roman(n).toLowerCase()
    case 3: return letters(n)
    case 4: return letters(n).toLowerCase()
    case 22: return String(n).padStart(2, '0')
    default: return String(n)
  }
}

function roman(n: number): string {
  let out = ''
  for (const [v, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const)
    for (; n >= v; n -= v) out += s
  return out
}

function letters(n: number): string {
  // Word repeats the letter past Z: AA, BB…
  return String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1)
}

const hex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')

/** Word's 16 old colour indexes (0 = automatic). */
const ICO: (string | undefined)[] = [
  undefined, '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff',
  '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0'
]

/** Windows-1252's 0x80-0x9F, used by 8-bit pieces. */
const CP1252: Record<number, string> = Object.fromEntries(
  [...'€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'].map((c, i) => [0x80 + i, c])
)
