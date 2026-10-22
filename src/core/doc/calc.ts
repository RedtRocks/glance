/**
 * Totals on fixed pages: an invoice's amounts are quantity times price, its subtotal the
 * amounts added up, its VAT a share of that and its total the two together. The design
 * says which (generated from the template's own numbers); this works them out again
 * whenever the table changes, in the sample's number format.
 */
import type { BoxCalc, DocDesign, TableRegion } from './look'
import type { Section } from './model'

/** The number in a cell like "£1,240.50", "0.5 h" or "36"; NaN when there is none. */
export function parseNumber(s: string): number {
  const m = /-?\d[\d,]*(\.\d+)?|-?\.\d+/.exec(String(s ?? ''))
  return m ? Number(m[0].replace(/,/g, '')) : NaN
}

/** How a sample number is written: what comes before and after it, decimals and thousands commas. */
export function formatOf(sample: string): { prefix: string; suffix: string; decimals: number; commas: boolean } {
  const m = /^(.*?)(-?\d[\d,]*(?:\.(\d+))?)(.*)$/.exec(sample.trim())
  if (!m) return { prefix: '', suffix: '', decimals: 0, commas: false }
  return { prefix: m[1], suffix: m[4], decimals: m[3]?.length ?? 0, commas: m[2].includes(',') || Math.abs(parseNumber(m[2])) >= 1000 }
}

export function formatNumber(v: number, f: ReturnType<typeof formatOf>): string {
  const fixed = v.toFixed(f.decimals)
  const [int, dec] = fixed.split('.')
  const grouped = f.commas ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int
  return `${f.prefix}${grouped}${dec !== undefined ? `.${dec}` : ''}${f.suffix}`
}

/** A table's rows with its worked-out columns filled in (rows whose inputs aren't numbers are left alone). */
export function computeRows(region: TableRegion, rows: string[][], sampleOf?: (col: number) => string): string[][] {
  if (!region.calc?.length) return rows
  return rows.map((row) => {
    const out = [...row]
    for (const c of region.calc!) {
      const a = parseNumber(out[c.mul[0]] ?? '')
      const b = parseNumber(out[c.mul[1]] ?? '')
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const like = sampleOf?.(c.col) ?? rows.find((r) => r[c.col])?.[c.col] ?? out[c.mul[1]] ?? ''
      out[c.col] = formatNumber(a * b, formatOf(like || out[c.mul[1]]))
    }
    return out
  })
}

/** The totals a section's text boxes show, worked out from its tables and each other. */
export function boxValues(design: DocDesign, section: Section): Record<string, string> {
  const calcs = design.calcs ?? {}
  const values: Record<string, number> = {}
  const seen = new Set<string>()
  const value = (name: string): number => {
    if (name in values) return values[name]
    if (seen.has(name)) return NaN
    seen.add(name)
    const c: BoxCalc | undefined = calcs[name]
    let v = NaN
    if (!c) v = parseNumber(section.texts[name] ?? '')
    else if ('sum' in c) {
      const region = design.tables.find((t) => t.name === c.sum.table)
      const rows = region ? computeRows(region, section.tables[c.sum.table] ?? []) : []
      v = rows.reduce((n, r) => n + (Number.isFinite(parseNumber(r[c.sum.col] ?? '')) ? parseNumber(r[c.sum.col]) : 0), 0)
    } else if ('mul' in c) v = value(c.mul.box) * c.mul.factor
    else v = c.add.reduce((n, k) => n + value(k), 0)
    values[name] = v
    return v
  }
  const out: Record<string, string> = {}
  for (const name of Object.keys(calcs)) {
    const v = value(name)
    const box = design.texts.find((t) => t.name === name)
    if (Number.isFinite(v) && box) out[name] = formatNumber(Math.round(v * 100) / 100, formatOf(box.sample))
  }
  return out
}
