/**
 * Cell addresses and ranges in A1 style. Rows and columns are 0-based inside Glance and
 * 1-based / lettered in everything people and AI apps read.
 */

export interface Addr {
  r: number
  c: number
}

export interface Range {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** Excel's limits. */
export const MAX_ROWS = 1_048_576
export const MAX_COLS = 16_384

export function colName(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function colIndex(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export const cellName = (r: number, c: number): string => `${colName(c)}${r + 1}`

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/

export function parseCell(ref: string): Addr | null {
  const m = CELL.exec(ref.trim())
  if (!m) return null
  const r = Number(m[2]) - 1
  const c = colIndex(m[1])
  if (r < 0 || r >= MAX_ROWS || c < 0 || c >= MAX_COLS) return null
  return { r, c }
}

/** "B2:D9", "B2", "B:D" (whole columns), "3:5" (whole rows). Corners come back sorted. */
export function parseRange(ref: string): Range | null {
  const s = ref.trim().replace(/\$/g, '')
  const [a, b = a, extra] = s.split(':')
  if (extra !== undefined || !a) return null
  if (/^[A-Za-z]{1,3}$/.test(a) && /^[A-Za-z]{1,3}$/.test(b)) return norm({ r1: 0, c1: colIndex(a), r2: MAX_ROWS - 1, c2: colIndex(b) })
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) < 1 || Number(b) < 1 ? null : norm({ r1: Number(a) - 1, c1: 0, r2: Number(b) - 1, c2: MAX_COLS - 1 })
  const p = parseCell(a)
  const q = parseCell(b)
  return p && q ? norm({ r1: p.r, c1: p.c, r2: q.r, c2: q.c }) : null
}

function norm(r: Range): Range {
  return { r1: Math.min(r.r1, r.r2), c1: Math.min(r.c1, r.c2), r2: Math.max(r.r1, r.r2), c2: Math.max(r.c1, r.c2) }
}

export function rangeName(r: Range): string {
  if (r.r1 === 0 && r.r2 === MAX_ROWS - 1) return `${colName(r.c1)}:${colName(r.c2)}`
  if (r.c1 === 0 && r.c2 === MAX_COLS - 1) return `${r.r1 + 1}:${r.r2 + 1}`
  const a = cellName(r.r1, r.c1)
  return r.r1 === r.r2 && r.c1 === r.c2 ? a : `${a}:${cellName(r.r2, r.c2)}`
}

export const inRange = (r: Range, row: number, col: number): boolean => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2

export const overlaps = (a: Range, b: Range): boolean => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2

export const contains = (outer: Range, inner: Range): boolean => inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2

/** "Sheet 1!A1:B2" or "'Sheet 1'!A1" or "A1" to its sheet name (if any) and range text. */
export function splitSheet(ref: string): { sheet?: string; ref: string } {
  const s = ref.trim()
  const quoted = /^'((?:[^']|'')+)'!(.+)$/.exec(s)
  if (quoted) return { sheet: quoted[1].replace(/''/g, "'"), ref: quoted[2] }
  const bare = /^([^!'"]+)!(.+)$/.exec(s)
  if (bare) return { sheet: bare[1], ref: bare[2] }
  return { ref: s }
}

/** A sheet name as formulas write it: quoted when it has spaces or punctuation. */
export function sheetRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

/** Every cell of a range, row by row (clipped so whole columns don't run to a million rows). */
export function* cellsOf(r: Range, maxRow = r.r2, maxCol = r.c2): Generator<Addr> {
  for (let row = r.r1; row <= Math.min(r.r2, maxRow); row++) for (let col = r.c1; col <= Math.min(r.c2, maxCol); col++) yield { r: row, c: col }
}
