/**
 * The workbook Glance edits (ADR 0018: spreadsheets are edited as .xlsx and .csv
 * directly). It mirrors what an .xlsx holds: sheets of cells with values, formulas and
 * styles, merges, sizes, frozen panes, validation, conditional formatting, pictures and
 * charts. Plain data, never mutated: every change makes a new workbook, so undo keeps
 * the old one.
 */
import { cellName, parseCell, type Addr } from './address'

/** An Excel error such as #DIV/0!. */
export interface CellError {
  error: string
}

export type Value = number | string | boolean | null | CellError

export const isError = (v: unknown): v is CellError => !!v && typeof v === 'object' && typeof (v as CellError).error === 'string'
export const err = (code: string): CellError => ({ error: code })

export interface Font {
  name?: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** #rrggbb */
  color?: string
}

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'double' | 'dashed' | 'dotted' | 'hair'
export interface BorderSide {
  style: BorderStyle
  color?: string
}

export interface Style {
  font?: Font
  /** Solid fill, #rrggbb. */
  fill?: string
  border?: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide }
  align?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'middle' | 'bottom'; wrap?: boolean; indent?: number }
  /** An Excel number format code, like "£#,##0.00" or "d mmm yyyy". */
  numFmt?: string
}

/** A run of rich text in a cell, as Excel stores it. */
export interface Run {
  text: string
  font?: Font
}

export interface Cell {
  /** The value: typed in, or a formula's last result. Dates are Excel serial numbers. */
  v?: Value
  /** Formula without the leading "=". */
  f?: string
  s?: Style
  /** Text in more than one font; v holds the plain text. */
  rich?: Run[]
}

export interface Size {
  /** Pixels. */
  size?: number
  hidden?: boolean
  /** Style for cells of the column (or row) that have none of their own. */
  s?: Style
}

/** Where a picture or chart sits: from the top-left of one cell to the top-left of another, with pixel offsets. */
export interface Anchor {
  from: { r: number; c: number; dx?: number; dy?: number }
  to: { r: number; c: number; dx?: number; dy?: number }
}

export interface SheetImage {
  id: string
  /** Key in the workbook's media. */
  media: string
  anchor: Anchor
  /** Alt text. */
  alt?: string
}

export type CfRule =
  | { type: 'dataBar'; color: string; min?: number; max?: number; showValue?: boolean }
  | { type: 'colorScale'; colors: string[]; min?: number; max?: number }
  | { type: 'iconSet'; icons: IconSetName; thresholds?: number[]; reverse?: boolean; showValue?: boolean }
  | { type: 'cellIs'; operator: CfOperator; values: (number | string)[]; style: Style }
  | { type: 'expression'; formula: string; style: Style }
  | { type: 'text'; operator: 'contains' | 'notContains' | 'beginsWith' | 'endsWith'; text: string; style: Style }

export type CfOperator = 'greaterThan' | 'lessThan' | 'between' | 'equal' | 'notEqual' | 'greaterThanOrEqual' | 'lessThanOrEqual' | 'notBetween'
export type IconSetName = '3TrafficLights1' | '3Arrows' | '3Symbols' | '3Symbols2' | '3Flags' | '3Stars' | '4Rating' | '5Rating' | '3Signs' | '4Arrows' | '5Arrows'

export interface CondFormat {
  ref: string
  rules: CfRule[]
}

export interface Validation {
  ref: string
  type: 'list' | 'whole' | 'decimal' | 'date' | 'textLength' | 'checkbox'
  /** list: the choices, or a range like "Categories!B2:B12". */
  values?: string[]
  source?: string
  min?: number
  max?: number
  allowBlank?: boolean
  /** Shown when the cell is picked. */
  prompt?: string
}

export type ChartType = 'column' | 'bar' | 'line' | 'pie' | 'doughnut' | 'area'

export interface ChartSeries {
  name?: string
  /** Values, like "Workouts!D10:D25". */
  values: string
  color?: string
}

export interface Chart {
  id: string
  type: ChartType
  title?: string
  anchor: Anchor
  /** Category labels, like "B10:B25". */
  categories?: string
  series: ChartSeries[]
  /** Slice or bar colours, in order (pie, doughnut, or one series by point). */
  colors?: string[]
  legend?: 'right' | 'bottom' | 'none'
  stacked?: boolean
  /** Show each value on its bar or slice. */
  labels?: boolean
  /** A line across the chart, like a goal. */
  target?: { value: number; label?: string; color?: string }
  /** Words in the middle of a doughnut. */
  centre?: string
  font?: string
  /** #rrggbb background; none when unset. */
  bg?: string
  ink?: string
}

export interface Filter {
  ref: string
  /** Column index (0-based, in the sheet) to the values that stay shown. */
  shown?: Record<number, string[]>
}

export interface Sheet {
  name: string
  /** Keyed by A1 name. */
  cells: Record<string, Cell>
  cols: Record<number, Size>
  rows: Record<number, Size>
  merges: string[]
  frozen?: { rows: number; cols: number }
  cf: CondFormat[]
  validations: Validation[]
  images: SheetImage[]
  charts: Chart[]
  filter?: Filter
  tabColor?: string
  hidden?: boolean
  /** Gridlines shown (Excel's default). */
  gridlines?: boolean
  /** Selected cell when saved, for opening where the person left off. */
  active?: string
  /** Rows the filter hides; worked out from `filter`, never saved. */
  filterHidden?: Set<number>
}

export interface Workbook {
  sheets: Sheet[]
  /** Index of the sheet shown first. */
  active?: number
}

export const DEFAULT_COL = 72
export const DEFAULT_ROW = 20
export const DEFAULT_FONT: Required<Pick<Font, 'name' | 'size' | 'color'>> = { name: 'Calibri', size: 11, color: '#000000' }

export function emptySheet(name: string): Sheet {
  return { name, cells: {}, cols: {}, rows: {}, merges: [], cf: [], validations: [], images: [], charts: [] }
}

export function emptyWorkbook(sheetName = 'Sheet1'): Workbook {
  return { sheets: [emptySheet(sheetName)] }
}

export const colWidth = (s: Sheet, c: number): number => (s.cols[c]?.hidden ? 0 : (s.cols[c]?.size ?? DEFAULT_COL))
export const rowHeight = (s: Sheet, r: number): number => (s.rows[r]?.hidden || s.filterHidden?.has(r) ? 0 : (s.rows[r]?.size ?? DEFAULT_ROW))

export function getCell(s: Sheet, r: number, c: number): Cell | undefined {
  return s.cells[cellName(r, c)]
}

/** The style that applies to a cell: its own, else its row's, else its column's. */
export function styleAt(s: Sheet, r: number, c: number): Style | undefined {
  return s.cells[cellName(r, c)]?.s ?? s.rows[r]?.s ?? s.cols[c]?.s
}

export function findSheet(wb: Workbook, name: string): Sheet | undefined {
  const n = name.toLowerCase()
  return wb.sheets.find((s) => s.name.toLowerCase() === n)
}

/** The last row and column with anything in them (-1 when empty). */
export function usedBounds(s: Sheet): { rows: number; cols: number } {
  let rows = -1
  let cols = -1
  for (const key of Object.keys(s.cells)) {
    const a = parseCell(key) as Addr
    if (a.r > rows) rows = a.r
    if (a.c > cols) cols = a.c
  }
  return { rows, cols }
}

/** The last row and column holding a value or formula (styles alone don't count). */
export function dataBounds(s: Sheet): { rows: number; cols: number } {
  let rows = -1
  let cols = -1
  for (const [key, cell] of Object.entries(s.cells)) {
    if ((cell.v === undefined || cell.v === null || cell.v === '') && !cell.f) continue
    const a = parseCell(key) as Addr
    if (a.r > rows) rows = a.r
    if (a.c > cols) cols = a.c
  }
  return { rows, cols }
}

/** The text a value shows as when no number format applies. */
export function plainText(v: Value | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return generalNumber(v)
  if (isError(v)) return v.error
  return v
}

/** Excel's General format: up to 11 significant characters. */
export function generalNumber(n: number): string {
  if (!isFinite(n)) return '#NUM!'
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, 'E').replace('E+', 'E+').replace(/e/, 'E')
  const digits = abs < 1 ? 9 : Math.max(0, 9 - Math.floor(Math.log10(abs)))
  return String(Number(n.toFixed(Math.min(digits, 15))))
}
