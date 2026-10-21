/**
 * Reading and writing .xlsx with ExcelJS (MIT), loaded only when a workbook is opened or
 * saved. ExcelJS can't write Excel charts, so Glance keeps its chart model in a very
 * hidden sheet ("_glance") and also places a picture of each chart, so people opening
 * the file in Excel still see it. Reading drops those pictures again and restores the
 * live charts.
 */
import type ExcelJSType from 'exceljs'
import { cellName, colIndex, parseRange, splitSheet } from '../core/sheet/address'
import { DEFAULT_COL, DEFAULT_ROW, emptySheet, isError, type BorderSide, type Cell, type CfRule, type Chart, type Font, type Sheet, type Style, type Validation, type Value, type Workbook, type IconSetName } from '../core/sheet/model'

type ExcelJS = typeof ExcelJSType
type XWorkbook = ExcelJSType.Workbook
type XWorksheet = ExcelJSType.Worksheet

const HIDDEN = '_glance'
const MAX_CELLS = 2_000_000

export async function excel(): Promise<ExcelJS> {
  const m = (await import('exceljs')) as unknown as { default?: ExcelJS } & ExcelJS
  return m.default ?? m
}

/** Excel's default theme colours, for fills and fonts that name a theme colour. */
const THEME = ['ffffff', '000000', 'e7e6e6', '44546a', '4472c4', 'ed7d31', 'a5a5a5', 'ffc000', '5b9bd5', '70ad47']

function tint(hex: string, t: number): string {
  const n = parseInt(hex, 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t))
  return ch.map((c) => c.toString(16).padStart(2, '0')).join('')
}

function colorOf(c: { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined): string | undefined {
  if (!c) return undefined
  if (c.argb && /^[0-9a-f]{8}$/i.test(c.argb)) return '#' + c.argb.slice(2).toLowerCase()
  if (c.argb && /^[0-9a-f]{6}$/i.test(c.argb)) return '#' + c.argb.toLowerCase()
  if (c.theme !== undefined && THEME[c.theme]) return '#' + (c.tint ? tint(THEME[c.theme], c.tint) : THEME[c.theme])
  if (c.indexed === 64 || c.indexed === 65) return undefined
  return undefined
}

const argb = (hex: string) => ({ argb: 'FF' + hex.replace('#', '').toUpperCase() })

const DAY_MS = 86_400_000
const dateSerial = (d: Date) => (d.getTime() - Date.UTC(1899, 11, 30)) / DAY_MS

/** Column width in Excel's characters to pixels, and back (Calibri 11's 7-pixel digit). */
export const widthToPx = (w: number) => Math.round(w * 7 + 5)
export const pxToWidth = (px: number) => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100)
const EMU = 9525

// ---------------------------------------------------------------------------
// Reading

export interface ReadResult {
  wb: Workbook
  media: Map<string, Uint8Array>
  warnings: string[]
}

interface Extras {
  v: 1
  sheets: Record<string, { charts?: Chart[]; chartPictures?: number[]; checkboxes?: string[]; labels?: Record<string, NonNullable<Cell['label']>> }>
}

export async function readXlsx(bytes: Uint8Array): Promise<ReadResult> {
  const X = await excel()
  const xb = new X.Workbook()
  await xb.xlsx.load(bytes as never)
  const warnings: string[] = []
  const media = new Map<string, Uint8Array>()
  let extras: Extras | null = null
  const hidden = xb.getWorksheet(HIDDEN)
  if (hidden) {
    try {
      const text = String(hidden.getCell('A1').value ?? '')
      extras = JSON.parse(text) as Extras
    } catch {
      extras = null
    }
  }
  const sheets: Sheet[] = []
  let total = 0
  for (const ws of xb.worksheets) {
    if (ws.name === HIDDEN) continue
    const ex = extras?.sheets[ws.name]
    const s = readSheet(xb, ws, ex, media, warnings)
    total += Object.keys(s.cells).length
    if (total > MAX_CELLS) throw new Error('This workbook is too large to open for editing.')
    sheets.push(s)
  }
  if (!sheets.length) sheets.push(emptySheet('Sheet1'))
  const activeTab = (xb as unknown as { views?: { activeTab?: number }[] }).views?.[0]?.activeTab
  return { wb: { sheets, ...(activeTab ? { active: Math.min(activeTab, sheets.length - 1) } : {}) }, media, warnings }
}

function fontOf(f: Partial<ExcelJSType.Font> | undefined): Font | undefined {
  if (!f) return undefined
  const out: Font = {}
  if (f.name) out.name = f.name
  if (f.size) out.size = f.size
  if (f.bold) out.bold = true
  if (f.italic) out.italic = true
  if (f.underline) out.underline = true
  if (f.strike) out.strike = true
  const c = colorOf(f.color as never)
  if (c) out.color = c
  return Object.keys(out).length ? out : undefined
}

function styleOf(x: Partial<ExcelJSType.Style> | undefined): Style | undefined {
  if (!x) return undefined
  const s: Style = {}
  const font = fontOf(x.font)
  if (font) s.font = font
  const fill = x.fill as ExcelJSType.FillPattern | undefined
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const c = colorOf(fill.fgColor as never) ?? colorOf(fill.bgColor as never)
    if (c) s.fill = c
  }
  if (x.border) {
    const b: NonNullable<Style['border']> = {}
    for (const k of ['top', 'right', 'bottom', 'left'] as const) {
      const side = x.border[k]
      if (side?.style) b[k] = { style: (['thin', 'medium', 'thick', 'double', 'dashed', 'dotted', 'hair'].includes(side.style) ? side.style : 'thin') as BorderSide['style'], ...(colorOf(side.color as never) ? { color: colorOf(side.color as never) } : {}) }
    }
    if (Object.keys(b).length) s.border = b
  }
  const a = x.alignment
  if (a) {
    const al: NonNullable<Style['align']> = {}
    if (a.horizontal === 'left' || a.horizontal === 'center' || a.horizontal === 'right') al.h = a.horizontal
    if (a.horizontal === 'centerContinuous') al.h = 'center'
    if (a.vertical === 'top' || a.vertical === 'bottom') al.v = a.vertical
    if (a.vertical === 'middle') al.v = 'middle'
    if (a.wrapText) al.wrap = true
    if (a.indent) al.indent = a.indent
    if (Object.keys(al).length) s.align = al
  }
  if (x.numFmt && x.numFmt !== 'General') s.numFmt = x.numFmt
  return Object.keys(s).length ? s : undefined
}

function valueOf(v: ExcelJSType.CellValue, numFmt: string | undefined): { v?: Value; f?: string; rich?: Cell['rich'] } {
  if (v === null || v === undefined) return {}
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return { v }
  if (v instanceof Date) return { v: dateSerial(v) }
  const o = v as unknown as Record<string, unknown>
  if ('formula' in o || 'sharedFormula' in o) {
    const r = o.result as ExcelJSType.CellValue
    const res = r instanceof Date ? dateSerial(r) : r && typeof r === 'object' && 'error' in (r as object) ? { error: String((r as { error: string }).error) } : (r as Value | undefined)
    return { f: String(o.formula ?? ''), v: res ?? null }
  }
  if ('richText' in o && Array.isArray(o.richText)) {
    const runs = (o.richText as { text: string; font?: Partial<ExcelJSType.Font> }[]).map((r) => ({ text: r.text, ...(fontOf(r.font) ? { font: fontOf(r.font) } : {}) }))
    return { v: runs.map((r) => r.text).join(''), rich: runs }
  }
  if ('error' in o) return { v: { error: String(o.error) } }
  if ('text' in o) return { v: String(o.text) }
  void numFmt
  return {}
}

const CF_ICONS: IconSetName[] = ['3TrafficLights1', '3Arrows', '3Symbols', '3Symbols2', '3Flags', '3Stars', '4Rating', '5Rating', '3Signs', '4Arrows', '5Arrows']

function cfRuleOf(r: Record<string, unknown>): CfRule | null {
  const style = () => styleOf((r.style ?? {}) as never) ?? {}
  const dxfFill = () => {
    const st = r.style as { fill?: { bgColor?: never; fgColor?: never } } | undefined
    const c = colorOf(st?.fill?.bgColor) ?? colorOf(st?.fill?.fgColor)
    const base = style()
    return c ? { ...base, fill: c } : base
  }
  const cfvo = (r.cfvo as { type: string; value?: number }[] | undefined) ?? []
  const num = (i: number) => (cfvo[i] && cfvo[i].type === 'num' ? Number(cfvo[i].value) : undefined)
  switch (r.type) {
    case 'dataBar': {
      const c = colorOf(r.color as never) ?? '#638ec6'
      return { type: 'dataBar', color: c, ...(num(0) !== undefined ? { min: num(0) } : {}), ...(num(1) !== undefined ? { max: num(1) } : {}) }
    }
    case 'colorScale': {
      const colors = ((r.color as never[]) ?? []).map((c) => colorOf(c)).filter((c): c is string => !!c)
      return colors.length >= 2 ? { type: 'colorScale', colors } : null
    }
    case 'iconSet': {
      const icons = CF_ICONS.includes(r.iconSet as IconSetName) ? (r.iconSet as IconSetName) : '3TrafficLights1'
      const thresholds = cfvo.slice(1).map((c) => Number(c.value ?? 0))
      return { type: 'iconSet', icons, ...(thresholds.length ? { thresholds } : {}), ...(r.reverse ? { reverse: true } : {}), ...(r.showValue === false ? { showValue: false } : {}) }
    }
    case 'cellIs':
      return { type: 'cellIs', operator: r.operator as never, values: ((r.formulae as string[]) ?? []).map((f) => (isNaN(Number(f)) ? f.replace(/^"|"$/g, '') : Number(f))), style: dxfFill() }
    case 'expression':
      return { type: 'expression', formula: String((r.formulae as string[])?.[0] ?? ''), style: dxfFill() }
    case 'containsText': {
      const op = ({ containsText: 'contains', notContains: 'notContains', beginsWith: 'beginsWith', endsWith: 'endsWith' } as Record<string, 'contains' | 'notContains' | 'beginsWith' | 'endsWith'>)[String(r.operator)] ?? 'contains'
      return { type: 'text', operator: op, text: String(r.text ?? ''), style: dxfFill() }
    }
  }
  return null
}

function readSheet(xb: XWorkbook, ws: XWorksheet, ex: Extras['sheets'][string] | undefined, media: Map<string, Uint8Array>, warnings: string[]): Sheet {
  const s = emptySheet(ws.name)
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    const r = rn - 1
    if (row.height) s.rows[r] = { ...s.rows[r], size: Math.round((row.height * 4) / 3) }
    if (row.hidden) s.rows[r] = { ...s.rows[r], hidden: true }
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      if (cell.isMerged && cell.master !== cell) return
      const st = styleOf(cell.style)
      const numFmt = st?.numFmt
      let val = valueOf(cell.value, numFmt)
      const formula = (cell as unknown as { formula?: string }).formula
      if (formula && !val.f) val = { ...val, f: formula }
      if (val.f) val.f = val.f.replace(/^=/, '')
      const out: Cell = { ...val }
      if (st) out.s = st
      if (out.v === undefined && !out.f && !out.s) return
      if (typeof out.v === 'number' && !numFmt && cell.value instanceof Date) out.s = { ...out.s, numFmt: 'd mmm yyyy' }
      s.cells[cellName(r, cn - 1)] = out
    })
  })
  const cols = (ws as unknown as { _columns?: ExcelJSType.Column[] })._columns ?? []
  cols.forEach((col, i) => {
    if (!col) return
    const size: Sheet['cols'][number] = {}
    if (col.width) size.size = widthToPx(col.width)
    if (col.hidden) size.hidden = true
    const st = styleOf(col.style)
    if (st && (st.fill || st.font)) size.s = st
    if (Object.keys(size).length) s.cols[i] = size
  })
  s.merges = [...((ws.model as unknown as { merges?: string[] }).merges ?? [])]
  const view = ws.views?.[0] as (ExcelJSType.WorksheetView & { xSplit?: number; ySplit?: number; showGridLines?: boolean; activeCell?: string }) | undefined
  if (view?.state === 'frozen' && (view.xSplit || view.ySplit)) s.frozen = { rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 }
  if (view?.showGridLines === false) s.gridlines = false
  if (view?.activeCell) s.active = view.activeCell
  const tab = colorOf(ws.properties?.tabColor as never)
  if (tab) s.tabColor = tab
  if (ws.state === 'hidden' || ws.state === 'veryHidden') s.hidden = true
  // Validation
  const dv = (ws as unknown as { dataValidations?: { model?: Record<string, ExcelJSType.DataValidation> } }).dataValidations?.model ?? {}
  const boxes = new Set(ex?.checkboxes ?? [])
  for (const [ref, rule] of Object.entries(dv)) {
    const v = validationOf(ref.replace(/^range:/, ''), rule, boxes)
    if (v) s.validations.push(v)
  }
  s.validations = mergeValidations(s.validations)
  // Conditional formatting
  const cfs = (ws as unknown as { conditionalFormattings?: { ref: string; rules: Record<string, unknown>[] }[] }).conditionalFormattings ?? []
  for (const cf of cfs) {
    const rules = cf.rules.map(cfRuleOf).filter((x): x is CfRule => !!x)
    if (rules.length) s.cf.push({ ref: cf.ref, rules })
    if (rules.length < cf.rules.length) warnings.push(`${ws.name}: some conditional formatting isn't supported and was left out`)
  }
  // Filter
  const af = ws.autoFilter as unknown
  if (typeof af === 'string' && parseRange(af)) s.filter = { ref: af }
  else if (af && typeof af === 'object' && 'from' in (af as object)) {
    const a = af as { from: string | { row: number; column: number }; to: string | { row: number; column: number } }
    const p = (x: typeof a.from) => (typeof x === 'string' ? x : cellName(x.row - 1, x.column - 1))
    s.filter = { ref: `${p(a.from)}:${p(a.to)}` }
  }
  // Pictures, leaving out the ones that are pictures of Glance's charts.
  const skip = new Set(ex?.chartPictures ?? [])
  ws.getImages().forEach((img, i) => {
    if (skip.has(i)) return
    const m = xb.getImage(Number(img.imageId)) as unknown as { buffer?: ArrayBuffer | Uint8Array; base64?: string; extension?: string; name?: string } | undefined
    if (!m) return
    const bytes = m.buffer ? new Uint8Array(m.buffer as ArrayBuffer) : m.base64 ? Uint8Array.from(atob(m.base64.replace(/^data:[^,]*,/, '')), (c) => c.charCodeAt(0)) : null
    if (!bytes) return
    const key = `media/${ws.name.replace(/[^\w-]/g, '_')}-${i + 1}.${m.extension ?? 'png'}`
    media.set(key, bytes)
    const rg = img.range as unknown as { tl: { nativeCol: number; nativeRow: number; nativeColOff?: number; nativeRowOff?: number }; br?: { nativeCol: number; nativeRow: number; nativeColOff?: number; nativeRowOff?: number }; ext?: { width: number; height: number } }
    const tl = rg.tl
    const br = rg.br ?? { nativeCol: tl.nativeCol + 2, nativeRow: tl.nativeRow + 4 }
    s.images.push({
      id: `picture${s.images.length + 1}`,
      media: key,
      anchor: {
        from: { r: tl.nativeRow, c: tl.nativeCol, dx: Math.round((tl.nativeColOff ?? 0) / EMU), dy: Math.round((tl.nativeRowOff ?? 0) / EMU) },
        to: { r: br.nativeRow, c: br.nativeCol, dx: Math.round((br.nativeColOff ?? 0) / EMU), dy: Math.round((br.nativeRowOff ?? 0) / EMU) }
      }
    })
  })
  s.charts = ex?.charts ?? []
  for (const [k, label] of Object.entries(ex?.labels ?? {})) if (s.cells[k]) s.cells[k] = { ...s.cells[k], label }
  return s
}

function validationOf(ref: string, rule: ExcelJSType.DataValidation, boxes: Set<string>): Validation | null {
  const f = (rule.formulae ?? []).map((x) => String(x))
  const base = { ref, ...(rule.allowBlank === false ? { allowBlank: false } : {}), ...(rule.prompt ? { prompt: rule.prompt } : {}) }
  if (rule.type === 'list') {
    const first = f[0] ?? ''
    if (boxes.has(ref) || /^"?TRUE,FALSE"?$/i.test(first)) return { ...base, type: 'checkbox' }
    if (first.startsWith('"')) return { ...base, type: 'list', values: first.slice(1, -1).split(',').map((x) => x.trim()) }
    return { ...base, type: 'list', source: first.replace(/^=/, '').replace(/\$/g, '') }
  }
  const t = rule.type === 'whole' || rule.type === 'decimal' || rule.type === 'date' || rule.type === 'textLength' ? rule.type : null
  if (!t) return null
  const val = (x: unknown) => (x instanceof Date ? dateSerial(x) : Number(x))
  const op = rule.operator ?? 'between'
  const a = val(rule.formulae?.[0])
  const b = val(rule.formulae?.[1])
  if (op === 'between') return { ...base, type: t, min: a, max: b }
  if (op === 'greaterThanOrEqual' || op === 'greaterThan') return { ...base, type: t, min: a }
  if (op === 'lessThanOrEqual' || op === 'lessThan') return { ...base, type: t, max: a }
  return { ...base, type: t, min: a, max: a }
}

/** ExcelJS reads validation cell by cell; join neighbouring cells with the same rule back into ranges. */
function mergeValidations(list: Validation[]): Validation[] {
  const groups = new Map<string, Validation[]>()
  for (const v of list) {
    const { ref, ...rule } = v
    void ref
    const k = JSON.stringify(rule)
    groups.set(k, [...(groups.get(k) ?? []), v])
  }
  const out: Validation[] = []
  for (const g of groups.values()) {
    const refs = g.map((v) => v.ref).join(' ').split(/\s+/)
    const cells = refs.map((r) => parseRange(r)).filter((r): r is NonNullable<typeof r> => !!r)
    // Columns of single cells become one range per column run.
    const singles = cells.filter((r) => r.r1 === r.r2 && r.c1 === r.c2).sort((a, b) => a.c1 - b.c1 || a.r1 - b.r1)
    const ranges = cells.filter((r) => !(r.r1 === r.r2 && r.c1 === r.c2)).map((r) => `${cellName(r.r1, r.c1)}:${cellName(r.r2, r.c2)}`)
    let run: { c: number; r1: number; r2: number } | null = null
    for (const c of singles) {
      if (run && run.c === c.c1 && c.r1 === run.r2 + 1) run.r2 = c.r1
      else {
        if (run) ranges.push(run.r1 === run.r2 ? cellName(run.r1, run.c) : `${cellName(run.r1, run.c)}:${cellName(run.r2, run.c)}`)
        run = { c: c.c1, r1: c.r1, r2: c.r1 }
      }
    }
    if (run) ranges.push(run.r1 === run.r2 ? cellName(run.r1, run.c) : `${cellName(run.r1, run.c)}:${cellName(run.r2, run.c)}`)
    out.push({ ...g[0], ref: ranges.join(' ') })
  }
  return out
}

// ---------------------------------------------------------------------------
// Writing

export interface WriteOptions {
  /** A PNG picture of a chart, so Excel shows it; null to leave it out. */
  chartPicture?: (sheet: Sheet, chart: Chart) => Promise<Uint8Array | null>
}

function xFont(f: Font | undefined): Partial<ExcelJSType.Font> | undefined {
  if (!f) return undefined
  return {
    ...(f.name ? { name: f.name } : {}),
    ...(f.size ? { size: f.size } : {}),
    ...(f.bold ? { bold: true } : {}),
    ...(f.italic ? { italic: true } : {}),
    ...(f.underline ? { underline: true } : {}),
    ...(f.strike ? { strike: true } : {}),
    ...(f.color ? { color: argb(f.color) } : {})
  }
}

function xStyle(s: Style): Partial<ExcelJSType.Style> {
  const out: Partial<ExcelJSType.Style> = {}
  const font = xFont(s.font)
  if (font && Object.keys(font).length) out.font = font
  if (s.fill) out.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(s.fill) }
  if (s.border) {
    const b: Partial<ExcelJSType.Borders> = {}
    for (const k of ['top', 'right', 'bottom', 'left'] as const) {
      const side = s.border[k]
      if (side) b[k] = { style: side.style as ExcelJSType.BorderStyle, ...(side.color ? { color: argb(side.color) } : {}) }
    }
    out.border = b
  }
  if (s.align) out.alignment = { ...(s.align.h ? { horizontal: s.align.h } : {}), ...(s.align.v ? { vertical: s.align.v } : {}), ...(s.align.wrap ? { wrapText: true } : {}), ...(s.align.indent ? { indent: s.align.indent } : {}) }
  if (s.numFmt) out.numFmt = s.numFmt
  return out
}

function xValue(c: Cell): ExcelJSType.CellValue {
  const res = c.v === undefined ? null : isError(c.v) ? ({ error: c.v.error } as never) : c.v
  if (c.f) return { formula: c.f, result: res ?? undefined } as never
  if (c.rich?.length) return { richText: c.rich.map((r) => ({ text: r.text, ...(r.font ? { font: xFont(r.font) } : {}) })) } as never
  return res as ExcelJSType.CellValue
}

function xCf(rule: CfRule): Record<string, unknown> {
  const dxf = (st: Style) => ({ ...(st.font ? { font: xFont(st.font) } : {}), ...(st.fill ? { fill: { type: 'pattern', pattern: 'solid', bgColor: argb(st.fill) } } : {}) })
  switch (rule.type) {
    case 'dataBar':
      return { type: 'dataBar', cfvo: [rule.min !== undefined ? { type: 'num', value: rule.min } : { type: 'min' }, rule.max !== undefined ? { type: 'num', value: rule.max } : { type: 'max' }], color: argb(rule.color), gradient: true }
    case 'colorScale':
      return { type: 'colorScale', cfvo: rule.colors.length === 3 ? [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }] : [{ type: 'min' }, { type: 'max' }], color: rule.colors.map(argb) }
    case 'iconSet': {
      const n = Number(rule.icons[0])
      const th = rule.thresholds ?? Array.from({ length: n - 1 }, (_, i) => Math.round(((i + 1) * 100) / n))
      return { type: 'iconSet', iconSet: rule.icons, cfvo: [{ type: 'percent', value: 0 }, ...th.map((v) => ({ type: rule.thresholds ? 'num' : 'percent', value: v }))], ...(rule.reverse ? { reverse: true } : {}), ...(rule.showValue === false ? { showValue: false } : {}) }
    }
    case 'cellIs':
      return { type: 'cellIs', operator: rule.operator, formulae: rule.values.map((v) => (typeof v === 'number' ? String(v) : `"${v}"`)), style: dxf(rule.style) }
    case 'expression':
      return { type: 'expression', formulae: [rule.formula], style: dxf(rule.style) }
    case 'text':
      return { type: 'containsText', operator: rule.operator === 'contains' ? 'containsText' : rule.operator, text: rule.text, style: dxf(rule.style) }
  }
}

function xValidation(v: Validation): ExcelJSType.DataValidation | null {
  const common = { allowBlank: v.allowBlank !== false, showErrorMessage: true, ...(v.prompt ? { showInputMessage: true, prompt: v.prompt } : {}) }
  if (v.type === 'checkbox') return { ...common, type: 'list', formulae: ['"TRUE,FALSE"'] }
  if (v.type === 'list') {
    if (v.source) {
      const { sheet, ref } = splitSheet(v.source)
      const r = parseRange(ref)
      if (!r) return null
      const abs = `$${ref.replace(/\$/g, '').replace(/([A-Z]+)(\d+)/g, '$1$$$2').replace(/:/, ':$')}`
      return { ...common, type: 'list', formulae: [sheet ? `${/^[A-Za-z_]\w*$/.test(sheet) ? sheet : `'${sheet}'`}!${abs}` : abs] }
    }
    return { ...common, type: 'list', formulae: [`"${(v.values ?? []).join(',')}"`] }
  }
  const op = v.min !== undefined && v.max !== undefined ? 'between' : v.min !== undefined ? 'greaterThanOrEqual' : 'lessThanOrEqual'
  const vals = [v.min, v.max].filter((x) => x !== undefined) as number[]
  return { ...common, type: v.type, operator: op, formulae: vals.map((x) => (v.type === 'date' ? new Date(Date.UTC(1899, 11, 30) + x * DAY_MS) : x)) as never }
}

export async function writeXlsx(wb: Workbook, media: Map<string, Uint8Array>, opts: WriteOptions = {}): Promise<Uint8Array> {
  const X = await excel()
  const xb = new X.Workbook()
  xb.creator = 'Glance'
  const extras: Extras = { v: 1, sheets: {} }
  const ids = new Map<string, number>()
  const imageId = (key: string, bytes: Uint8Array) => {
    let id = ids.get(key)
    if (id === undefined) {
      const ext = /\.(png|jpe?g|gif)$/i.exec(key)?.[1]?.toLowerCase().replace('jpg', 'jpeg') ?? 'png'
      id = xb.addImage({ buffer: bytes as never, extension: ext as 'png' })
      ids.set(key, id)
    }
    return id
  }
  for (const s of wb.sheets) {
    const ws = xb.addWorksheet(s.name, {
      properties: { ...(s.tabColor ? { tabColor: argb(s.tabColor) } : {}), defaultRowHeight: (DEFAULT_ROW * 3) / 4 },
      views: [{ ...(s.frozen ? { state: 'frozen', xSplit: s.frozen.cols, ySplit: s.frozen.rows } : {}), ...(s.gridlines === false ? { showGridLines: false } : {}), ...(s.active ? { activeCell: s.active } : {}) } as ExcelJSType.WorksheetView],
      state: s.hidden ? 'hidden' : 'visible'
    })
    const maxCol = Math.max(-1, ...Object.keys(s.cols).map(Number))
    for (let c = 0; c <= maxCol; c++) {
      const size = s.cols[c]
      const col = ws.getColumn(c + 1)
      col.width = pxToWidth(size?.size ?? DEFAULT_COL)
      if (size?.hidden) col.hidden = true
      if (size?.s) col.style = xStyle(size.s) as ExcelJSType.Style
    }
    for (const [k, size] of Object.entries(s.rows)) {
      const row = ws.getRow(Number(k) + 1)
      if (size.size !== undefined) row.height = (size.size * 3) / 4
      if (size.hidden || s.filterHidden?.has(Number(k))) row.hidden = true
      if (size.s) (row as unknown as { style: unknown }).style = xStyle(size.s)
    }
    for (const r of s.filterHidden ?? []) ws.getRow(r + 1).hidden = true
    for (const [k, c] of Object.entries(s.cells)) {
      if (c.label) ((extras.sheets[s.name] ??= {}).labels ??= {})[k] = c.label
      const cell = ws.getCell(k)
      cell.value = xValue(c)
      const st = c.s ?? s.rows[Number(/\d+/.exec(k)![0]) - 1]?.s ?? s.cols[colIndex(/^[A-Z]+/.exec(k)![0])]?.s
      if (st) cell.style = xStyle(st) as ExcelJSType.Style
    }
    for (const m of s.merges) {
      try {
        ws.mergeCells(m)
      } catch {
        // Overlapping merges from a damaged file: keep the first.
      }
    }
    for (const v of s.validations) {
      const rule = xValidation(v)
      if (!rule) continue
      for (const part of v.ref.split(/\s+/)) (ws as unknown as { dataValidations: { add(ref: string, v: ExcelJSType.DataValidation): void } }).dataValidations.add(part, rule)
      if (v.type === 'checkbox') ((extras.sheets[s.name] ??= {}).checkboxes ??= []).push(...v.ref.split(/\s+/))
    }
    for (const cf of s.cf) ws.addConditionalFormatting({ ref: cf.ref, rules: cf.rules.map(xCf) as never })
    if (s.filter) ws.autoFilter = s.filter.ref
    let picture = 0
    for (const im of s.images) {
      const bytes = media.get(im.media)
      if (!bytes) continue
      ws.addImage(imageId(im.media, bytes), anchorOf(s, im.anchor) as never)
      picture++
    }
    if (s.charts.length) {
      const ex = (extras.sheets[s.name] ??= {})
      ex.charts = s.charts
      ex.chartPictures = []
      for (const ch of s.charts) {
        const png = opts.chartPicture ? await opts.chartPicture(s, ch) : null
        if (!png) continue
        ws.addImage(xb.addImage({ buffer: png as never, extension: 'png' }), anchorOf(s, ch.anchor) as never)
        ex.chartPictures.push(picture++)
      }
    }
  }
  if (Object.keys(extras.sheets).length) {
    const hidden = xb.addWorksheet(HIDDEN, { state: 'veryHidden' })
    hidden.getCell('A1').value = JSON.stringify(extras)
  }
  if (wb.active) (xb as unknown as { views: unknown[] }).views = [{ activeTab: wb.active, firstSheet: 0, visibility: 'visible', x: 0, y: 0, width: 12000, height: 24000 }]
  return new Uint8Array(await xb.xlsx.writeBuffer())
}

/** ExcelJS takes anchors as fractional column and row numbers. */
function anchorOf(s: Sheet, a: Sheet['images'][number]['anchor']) {
  const w = (c: number) => s.cols[c]?.size ?? DEFAULT_COL
  const h = (r: number) => s.rows[r]?.size ?? DEFAULT_ROW
  const pt = (p: Sheet['images'][number]['anchor']['from']) => ({ col: p.c + Math.min(0.999, (p.dx ?? 0) / w(p.c)), row: p.r + Math.min(0.999, (p.dy ?? 0) / h(p.r)) })
  return { tl: pt(a.from), br: pt(a.to), editAs: 'oneCell' }
}

