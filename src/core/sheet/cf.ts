/**
 * Conditional formatting as it applies to one cell: the style a rule adds, a data bar's
 * length, a colour scale's colour or an icon set's icon. Pure, so the grid, the
 * picture export and the tests share it.
 */
import { cellName, inRange, parseRange, type Range } from './address'
import { shiftFormula } from './formula'
import { compare } from './evaluate'
import { isError, type CfRule, type Sheet, type Style, type Value, type Workbook, type IconSetName } from './model'
import { evaluateFormula, type RecalcOptions } from './recalc'

export interface CfLook {
  style?: Style
  bar?: { pct: number; color: string; showValue: boolean }
  fill?: string
  icon?: { set: IconSetName; index: number; count: number; showValue: boolean }
}

interface Stats {
  min: number
  max: number
  nums: number[]
}

function statsOf(s: Sheet, ranges: Range[]): Stats {
  const nums: number[] = []
  for (const r of ranges)
    for (const [k, c] of Object.entries(s.cells)) {
      if (typeof c.v !== 'number') continue
      const m = /^([A-Z]+)(\d+)$/.exec(k)!
      const row = Number(m[2]) - 1
      let col = 0
      for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64
      if (inRange(r, row, col - 1)) nums.push(c.v)
    }
  return { min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0, nums }
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const x = p(a)
  const y = p(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function cellIs(rule: Extract<CfRule, { type: 'cellIs' }>, v: Value): boolean {
  if (v === null || isError(v)) return false
  const [a, b] = rule.values
  const d = compare(v, a as Value)
  switch (rule.operator) {
    case 'greaterThan': return d > 0
    case 'lessThan': return d < 0
    case 'greaterThanOrEqual': return d >= 0
    case 'lessThanOrEqual': return d <= 0
    case 'equal': return d === 0
    case 'notEqual': return d !== 0
    case 'between': return d >= 0 && compare(v, b as Value) <= 0
    case 'notBetween': return d < 0 || compare(v, b as Value) > 0
  }
}

/** Works out conditional formatting for a sheet's cells, caching each block's numbers. */
export class CfEngine {
  private readonly blocks: { ranges: Range[]; rules: CfRule[]; stats?: Stats }[]

  constructor(
    readonly wb: Workbook,
    readonly sheet: Sheet,
    readonly opts: RecalcOptions = {}
  ) {
    this.blocks = sheet.cf.map((c) => ({ ranges: c.ref.split(/\s+/).map((x) => parseRange(x)).filter((r): r is Range => !!r), rules: c.rules }))
  }

  look(r: number, c: number): CfLook | null {
    let out: CfLook | null = null
    const v = this.sheet.cells[cellName(r, c)]?.v ?? null
    for (const b of this.blocks) {
      const at = b.ranges.find((x) => inRange(x, r, c))
      if (!at) continue
      for (const rule of b.rules) {
        out ??= {}
        switch (rule.type) {
          case 'dataBar': {
            if (typeof v !== 'number') break
            b.stats ??= statsOf(this.sheet, b.ranges)
            const lo = rule.min ?? Math.min(0, b.stats.min)
            const hi = rule.max ?? b.stats.max
            const pct = hi === lo ? 1 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
            out.bar = { pct, color: rule.color, showValue: rule.showValue !== false }
            break
          }
          case 'colorScale': {
            if (typeof v !== 'number') break
            b.stats ??= statsOf(this.sheet, b.ranges)
            const lo = rule.min ?? b.stats.min
            const hi = rule.max ?? b.stats.max
            const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
            const cs = rule.colors
            out.fill = cs.length === 3 ? (t < 0.5 ? mix(cs[0], cs[1], t * 2) : mix(cs[1], cs[2], (t - 0.5) * 2)) : mix(cs[0], cs[1], t)
            break
          }
          case 'iconSet': {
            if (typeof v !== 'number') break
            const count = Number(rule.icons[0])
            b.stats ??= statsOf(this.sheet, b.ranges)
            let index: number
            if (rule.thresholds) index = rule.thresholds.filter((x) => v >= x).length
            else {
              const span = b.stats.max - b.stats.min
              const pct = span ? ((v - b.stats.min) / span) * 100 : 100
              index = Array.from({ length: count - 1 }, (_, i) => ((i + 1) * 100) / count).filter((x) => pct >= x).length
            }
            if (rule.reverse) index = count - 1 - index
            out.icon = { set: rule.icons, index: Math.max(0, Math.min(count - 1, index)), count, showValue: rule.showValue !== false }
            break
          }
          case 'cellIs':
            if (cellIs(rule, v)) out.style = merge(out.style, rule.style)
            break
          case 'text': {
            if (typeof v !== 'string') break
            const a = v.toLowerCase()
            const t = rule.text.toLowerCase()
            const hit = rule.operator === 'contains' ? a.includes(t) : rule.operator === 'notContains' ? !a.includes(t) : rule.operator === 'beginsWith' ? a.startsWith(t) : a.endsWith(t)
            if (hit) out.style = merge(out.style, rule.style)
            break
          }
          case 'expression': {
            const f = shiftFormula(rule.formula, r - at.r1, c - at.c1)
            const res = evaluateFormula(this.wb, this.sheet.name, r, c, f, this.opts)
            if (res === true || (typeof res === 'number' && res !== 0)) out.style = merge(out.style, rule.style)
            break
          }
        }
      }
    }
    return out
  }
}

function merge(a: Style | undefined, b: Style): Style {
  return { ...a, ...b, ...(a?.font || b.font ? { font: { ...a?.font, ...b.font } } : {}) }
}
