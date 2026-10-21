/**
 * CSV and TSV: reading (with quotes, the file's own separator and typed numbers) into a
 * one-sheet workbook, and writing one sheet back out as the values it shows.
 */
import { cellName } from './address'
import { formatValue, parseEntry } from './format'
import { dataBounds, emptySheet, type Sheet, type Workbook } from './model'

const MAX_CELLS = 2_000_000

/** The separator a file most likely uses: tab, semicolon or comma. */
export function guessSeparator(text: string): string {
  const head = text.slice(0, 4096).split(/\r?\n/).slice(0, 5).join('\n').replace(/"[^"]*"/g, '')
  const count = (ch: string) => head.split(ch).length - 1
  const tab = count('\t')
  const semi = count(';')
  const comma = count(',')
  return tab > comma && tab >= semi ? '\t' : semi > comma ? ';' : ','
}

export function parseCsv(text: string, sep = guessSeparator(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  let cells = 0
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += ch
    } else if (ch === '"' && cur === '') q = true
    else if (ch === sep) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      cells += row.length
      if (cells > MAX_CELLS) throw new Error('This file is too large to open as a spreadsheet.')
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

export function csvWorkbook(text: string, name: string, opts: { dayFirst?: boolean } = {}): Workbook {
  const sheet = emptySheet(name)
  const rows = parseCsv(text)
  rows.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (raw === '') return
      // Leading zeros (phone numbers, codes) stay text, as people expect.
      const p = /^0\d/.test(raw.trim()) ? { value: raw } : parseEntry(raw, { dayFirst: opts.dayFirst ?? true })
      if (p.value === null) return
      sheet.cells[cellName(r, c)] = p.numFmt ? { v: p.value, s: { numFmt: p.numFmt } } : { v: p.value }
    })
  )
  return { sheets: [sheet] }
}

function quote(s: string, sep: string): string {
  return /["\r\n]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One sheet as CSV: what each cell shows, formulas as their results. */
export function sheetToCsv(s: Sheet, sep = ','): string {
  const b = dataBounds(s)
  const lines: string[] = []
  for (let r = 0; r <= b.rows; r++) {
    const row: string[] = []
    for (let c = 0; c <= b.cols; c++) {
      const cell = s.cells[cellName(r, c)]
      const v = cell?.v
      // Plain numbers stay full precision; dates and money keep their look.
      const text = typeof v === 'number' && !cell?.s?.numFmt ? String(v) : formatValue(v, cell?.s?.numFmt).text
      row.push(quote(text, sep))
    }
    lines.push(row.join(sep))
  }
  return lines.join('\r\n') + (lines.length ? '\r\n' : '')
}
