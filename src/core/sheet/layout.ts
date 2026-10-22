/**
 * Where cells sit on screen: column and row edges in pixels (with hidden and filtered
 * rows taking no space), merged areas, and which cell a point is over.
 */
import { cellName, inRange, parseRange, type Range } from './address'
import { DEFAULT_COL, DEFAULT_ROW, type Sheet } from './model'

class Axis {
  private readonly sizes: [number, number][]
  constructor(
    explicit: Map<number, number>,
    readonly dflt: number
  ) {
    this.sizes = [...explicit.entries()].sort((a, b) => a[0] - b[0])
  }

  size(i: number): number {
    const hit = this.find(i)
    return hit >= 0 && this.sizes[hit][0] === i ? this.sizes[hit][1] : this.dflt
  }

  /** Index of the last explicit entry at or before i, or -1. */
  private find(i: number): number {
    let lo = 0
    let hi = this.sizes.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.sizes[mid][0] <= i) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  private prefix: number[] | null = null
  /** Start of entry i. */
  start(i: number): number {
    if (!this.prefix) {
      this.prefix = []
      let extra = 0
      for (const [, s] of this.sizes) {
        this.prefix.push(extra)
        extra += s - this.dflt
      }
      this.prefix.push(extra)
    }
    const k = this.find(i - 1)
    // Explicit entries before i: those with index <= i-1.
    const extraBefore = k < 0 ? 0 : this.prefix[k] + (this.sizes[k][1] - this.dflt)
    return i * this.dflt + extraBefore
  }

  /** The entry a pixel position falls in. */
  at(px: number, max: number): number {
    let lo = 0
    let hi = max
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.start(mid) <= px) lo = mid
      else hi = mid - 1
    }
    // Skip zero-size (hidden) entries.
    while (lo < max && this.size(lo) === 0) lo++
    return lo
  }
}

export class SheetLayout {
  readonly cols: Axis
  readonly rows: Axis
  readonly merges: Range[]
  private readonly mergeIndex = new Map<string, Range>()

  constructor(readonly sheet: Sheet) {
    const cols = new Map<number, number>()
    for (const [k, v] of Object.entries(sheet.cols)) if (v.size !== undefined || v.hidden) cols.set(Number(k), v.hidden ? 0 : (v.size ?? DEFAULT_COL))
    const rows = new Map<number, number>()
    for (const [k, v] of Object.entries(sheet.rows)) if (v.size !== undefined || v.hidden) rows.set(Number(k), v.hidden ? 0 : (v.size ?? DEFAULT_ROW))
    for (const r of sheet.filterHidden ?? []) rows.set(r, 0)
    this.cols = new Axis(cols, DEFAULT_COL)
    this.rows = new Axis(rows, DEFAULT_ROW)
    this.merges = sheet.merges.map((m) => parseRange(m)).filter((r): r is Range => !!r)
    for (const m of this.merges) for (let r = m.r1; r <= Math.min(m.r2, m.r1 + 500); r++) for (let c = m.c1; c <= Math.min(m.c2, m.c1 + 200); c++) this.mergeIndex.set(cellName(r, c), m)
  }

  x(c: number): number {
    return this.cols.start(c)
  }
  y(r: number): number {
    return this.rows.start(r)
  }
  w(c: number): number {
    return this.cols.size(c)
  }
  h(r: number): number {
    return this.rows.size(r)
  }

  mergeAt(r: number, c: number): Range | undefined {
    return this.mergeIndex.get(cellName(r, c))
  }

  /** The cell or merged area at (r, c). */
  area(r: number, c: number): Range {
    return this.mergeAt(r, c) ?? { r1: r, c1: c, r2: r, c2: c }
  }

  rect(a: Range): { x: number; y: number; w: number; h: number } {
    const x = this.x(a.c1)
    const y = this.y(a.r1)
    return { x, y, w: this.x(a.c2 + 1) - x, h: this.y(a.r2 + 1) - y }
  }

  colAt(px: number): number {
    return this.cols.at(Math.max(0, px), 16_383)
  }
  rowAt(px: number): number {
    return this.rows.at(Math.max(0, px), 1_048_575)
  }

  /** Whether (r, c) is covered by a merge but isn't its top-left cell. */
  hiddenByMerge(r: number, c: number): boolean {
    const m = this.mergeAt(r, c)
    return !!m && (m.r1 !== r || m.c1 !== c) && inRange(m, r, c)
  }
}
