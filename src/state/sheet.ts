/**
 * Opening, saving, exporting and changing spreadsheets (.xlsx, .csv). ExcelJS and the
 * drawing code load only when a workbook is opened, so they stay off the startup path.
 */
import * as platform from '../platform'
import { addDoc, PreviewDoc } from './documents'
import { SheetDoc, type SheetSelection } from './sheetDoc'
import * as versions from './versions'
import { toast, withBusy } from './ui'
import { msg, t } from '../i18n'
import { cellName, colName, inRange, parseRange, rangeName } from '../core/sheet/address'
import { dataBounds, emptyWorkbook, plainText, styleAt, type Style, type Chart, type Sheet, type Workbook } from '../core/sheet/model'
import { recalc, todaySerial, useFunctions } from '../core/sheet/recalc'
import { SheetError, type ApplyResult, type SheetOp, type StyleInput } from '../core/sheet/ops'
import type { SheetFinding } from '../core/sheet/check'
import { csvWorkbook, sheetToCsv, guessSeparator } from '../core/sheet/csv'
import { extend, FUNCTIONS } from '../core/sheet/functions'

const xlsx = () => import('../sheet/xlsx')
const draw = () => import('../sheet/picture')

export const SHEET_EXTS = ['xlsx', 'xlsm', 'csv', 'tsv']
export const isSheetName = (name: string): boolean => SHEET_EXTS.includes(name.split('.').pop()?.toLowerCase() ?? '')

let fnsLoaded: Promise<void> | null = null
/** formulajs answers the functions Glance's own evaluator doesn't know. */
export function loadFunctions(): Promise<void> {
  fnsLoaded ??= import('@formulajs/formulajs')
    .then((lib) => useFunctions(extend(FUNCTIONS, lib as unknown as Record<string, unknown>)))
    .catch(() => undefined)
  return fnsLoaded
}

/** Reads a workbook from bytes: CSV/TSV as text, everything else as .xlsx. */
export async function readWorkbook(name: string, bytes: Uint8Array): Promise<{ wb: Workbook; media: Map<string, Uint8Array>; warnings: string[]; sep?: string }> {
  await loadFunctions()
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'csv' || ext === 'tsv') {
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '')
    const sep = ext === 'tsv' ? '\t' : guessSeparator(text)
    return { wb: recalc(csvWorkbook(text, name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Sheet1'), { today: todaySerial() }), media: new Map(), warnings: [], sep }
  }
  const r = await (await xlsx()).readXlsx(bytes)
  return { ...r, wb: recalc(r.wb, { today: todaySerial() }) }
}

export async function openSheet(probe: platform.Probe): Promise<SheetDoc | PreviewDoc> {
  try {
    const r = await readWorkbook(probe.name, await platform.readFile(probe.path))
    const csv = /\.(csv|tsv)$/i.test(probe.name)
    const doc = new SheetDoc(probe.name, probe.path, csv ? 'csv' : 'xlsx')
    doc.wb.value = r.wb
    if (r.sep) doc.csvSeparator = r.sep
    for (const [k, v] of r.media) doc.media.set(k, v)
    doc.warnings = r.warnings
    addDoc(doc)
    if (r.warnings.length) toast(t('{count, plural, one {# part of this workbook couldn’t be read and was left out.} other {# parts of this workbook couldn’t be read and were left out.}}', { count: r.warnings.length }), 'error')
    return doc
  } catch {
    // Glance can still show it read-only.
    const doc = new PreviewDoc(probe)
    addDoc(doc)
    return doc
  }
}

/** A new, unsaved workbook: from a template's workbook, or empty. */
export function newSheet(name = t('Untitled spreadsheet'), wb?: Workbook, media?: Map<string, Uint8Array>): SheetDoc {
  void loadFunctions()
  const doc = new SheetDoc(`${name}.xlsx`, null)
  doc.wb.value = recalc(wb ?? emptyWorkbook(t('Sheet1')), { today: todaySerial() })
  for (const [k, v] of media ?? []) doc.media.set(k, v)
  addDoc(doc)
  return doc
}

export type SheetExport = 'xlsx' | 'csv' | 'pdf' | 'png'

/** The bytes of a workbook in a format: CSV and PNG are the sheet on screen. */
export async function sheetBytes(doc: SheetDoc, kind: SheetExport, sheet = doc.activeSheet.peek()): Promise<Uint8Array> {
  const wb = doc.wb.peek()
  if (kind === 'csv') return new TextEncoder().encode(sheetToCsv(sheet, doc.format === 'csv' ? doc.csvSeparator : ','))
  const pic = await draw()
  if (kind === 'png') return pic.sheetPng(wb, sheet, doc.media)
  if (kind === 'pdf') return pic.workbookPdf(wb, doc.media)
  return (await xlsx()).writeXlsx(wb, doc.media, { chartPicture: (s: Sheet, ch: Chart) => pic.chartPng(wb, s, ch) })
}

export async function saveSheet(doc: SheetDoc, opts: { auto?: boolean } = {}): Promise<void> {
  const path = doc.path.peek()
  if (!path) return opts.auto ? undefined : saveSheetAs(doc)
  // A CSV keeps one sheet and no formatting; a workbook with more is saved as .xlsx.
  if (doc.format === 'csv' && doc.wb.peek().sheets.length > 1) return opts.auto ? undefined : saveSheetAs(doc)
  const disk = await versions.checkDisk(doc, path, !!opts.auto)
  if (disk === 'cancel') return
  if (disk === 'copy') return saveSheetAs(doc)
  await versions.beforeOverwrite(doc, path)
  const run = async () => {
    const bytes = await sheetBytes(doc, doc.format)
    await platform.writeFile(path, bytes)
    return bytes
  }
  const bytes = opts.auto ? await run() : await withBusy(t('Saving…'), run)
  doc.dirty.value = false
  await versions.rememberStamp(doc)
  await versions.afterWrite(path, opts.auto ? msg('Autosaved') : msg('Saved'), bytes)
  if (!opts.auto) toast(t('Saved'))
}

export async function saveSheetAs(doc: SheetDoc): Promise<void> {
  const base = doc.name.peek().replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base}.xlsx`, [{ name: msg('Excel workbook'), extensions: ['xlsx'] }])
  if (!target) return
  await versions.afterWrite(target, msg('Before replacing')).catch(() => undefined)
  const bytes = await withBusy(t('Saving…'), async () => {
    const b = await sheetBytes(doc, 'xlsx')
    await platform.writeFile(target, b)
    return b
  })
  const old = doc.path.peek()
  doc.path.value = target
  doc.name.value = platform.baseName(target)
  ;(doc as { format: string }).format = 'xlsx'
  doc.dirty.value = false
  if (old) void platform.releaseFile(old)
  void platform.claimFile(target)
  await versions.rememberStamp(doc)
  await versions.afterWrite(target, msg('Saved'), bytes)
  toast(t('Saved'))
}

const EXPORT_NAMES: Record<SheetExport, string> = { xlsx: msg('Excel workbook'), csv: msg('CSV (this sheet)'), pdf: msg('PDF document'), png: msg('PNG picture (this sheet)') }

export async function exportSheet(doc: SheetDoc, kind: SheetExport): Promise<void> {
  const base = doc.name.peek().replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base}.${kind}`, [{ name: t(EXPORT_NAMES[kind]), extensions: [kind] }])
  if (!target) return
  await withBusy(t('Exporting…'), async () => platform.writeFile(target, await sheetBytes(doc, kind)))
  toast(t('Exported {file}', { file: platform.baseName(target) }))
}

/** Applies `ops` as one undo step, saying why in a toast when they can't apply. */
export function change(doc: SheetDoc, label: string, ops: SheetOp[]): ApplyResult | null {
  try {
    return doc.apply(label, ops)
  } catch (e) {
    if (!(e instanceof SheetError)) throw e
    toast(t('Couldn’t change the sheet: {error}', { error: e.message }), 'error')
    return null
  }
}

export const selectionRange = (s: SheetSelection): string =>
  rangeName({ r1: Math.min(s.r, s.r2), c1: Math.min(s.c, s.c2), r2: Math.max(s.r, s.r2), c2: Math.max(s.c, s.c2) })

/** What the person has picked, for AI apps and the guide: the tab, range, values and formulas. */
export function sheetSelection(doc: SheetDoc): { kind: 'spreadsheet'; tab: string; sheet: string; range: string; values: string[][]; formulas: (string | null)[][] } {
  const sheet = doc.activeSheet.peek()
  const s = doc.sel.peek()
  const r1 = Math.min(s.r, s.r2)
  const c1 = Math.min(s.c, s.c2)
  const r2 = Math.min(Math.max(s.r, s.r2), r1 + 49)
  const c2 = Math.min(Math.max(s.c, s.c2), c1 + 25)
  const values: string[][] = []
  const formulas: (string | null)[][] = []
  for (let r = r1; r <= r2; r++) {
    const vr: string[] = []
    const fr: (string | null)[] = []
    for (let c = c1; c <= c2; c++) {
      const cell = sheet.cells[cellName(r, c)]
      vr.push(plainText(cell?.v))
      fr.push(cell?.f ?? null)
    }
    values.push(vr)
    formulas.push(fr)
  }
  return { kind: 'spreadsheet', tab: doc.id, sheet: sheet.name, range: selectionRange(s), values, formulas }
}

/** The used area of a sheet, as a range like A1:H30. */
export function usedRange(sheet: Sheet): string {
  const b = dataBounds(sheet)
  return b.rows >= 0 ? `A1:${colName(b.cols)}${b.rows + 1}` : 'A1'
}

// ---------------------------------------------------------------------------
// Commands on the picked cells: the menus, toolbar and shortcuts come through here.

const bounds = (doc: SheetDoc) => {
  const s = doc.sel.peek()
  return { r1: Math.min(s.r, s.r2), c1: Math.min(s.c, s.c2), r2: Math.max(s.r, s.r2), c2: Math.max(s.c, s.c2) }
}
const on = (doc: SheetDoc) => doc.activeSheet.peek().name

export function formatSelection(doc: SheetDoc, label: string, style: StyleInput): void {
  change(doc, label, [{ op: 'format', sheet: on(doc), range: selectionRange(doc.sel.peek()), style }])
}

export function insertRows(doc: SheetDoc, below: boolean): void {
  const b = bounds(doc)
  change(doc, msg('Insert Rows'), [{ op: 'insertRows', sheet: on(doc), at: (below ? b.r2 + 1 : b.r1) + 1, count: b.r2 - b.r1 + 1 }])
}

export function insertCols(doc: SheetDoc, right: boolean): void {
  const b = bounds(doc)
  change(doc, msg('Insert Columns'), [{ op: 'insertCols', sheet: on(doc), at: colName(right ? b.c2 + 1 : b.c1), count: b.c2 - b.c1 + 1 }])
}

export function deleteRows(doc: SheetDoc): void {
  const b = bounds(doc)
  change(doc, msg('Delete Rows'), [{ op: 'deleteRows', sheet: on(doc), at: b.r1 + 1, count: b.r2 - b.r1 + 1 }])
}

export function deleteCols(doc: SheetDoc): void {
  const b = bounds(doc)
  change(doc, msg('Delete Columns'), [{ op: 'deleteCols', sheet: on(doc), at: colName(b.c1), count: b.c2 - b.c1 + 1 }])
}

export function clearSelection(doc: SheetDoc): void {
  change(doc, msg('Clear'), [{ op: 'clear', sheet: on(doc), range: selectionRange(doc.sel.peek()), what: 'contents' }])
}

/** Sorts the rows of the table around the picked cell by its column (its first row stays as headers). */
export function sortBy(doc: SheetDoc, desc: boolean): void {
  const sheet = doc.activeSheet.peek()
  const s = doc.sel.peek()
  const b = bounds(doc)
  let range = selectionRange(s)
  let header = false
  if (b.r1 === b.r2) {
    const filled = (r: number) => plainText(sheet.cells[cellName(r, s.c)]?.v) !== ''
    let top = s.r
    let bottom = s.r
    while (top > 0 && filled(top - 1)) top--
    while (filled(bottom + 1)) bottom++
    range = rangeName({ r1: top, c1: 0, r2: bottom, c2: Math.max(0, dataBounds(sheet).cols) })
    header = true
  }
  change(doc, msg('Sort'), [{ op: 'sort', sheet: sheet.name, range, by: [{ col: colName(s.c), desc }], header }])
}

export function toggleFilter(doc: SheetDoc): void {
  const sheet = doc.activeSheet.peek()
  if (sheet.filter) return void change(doc, msg('Filter'), [{ op: 'filter', sheet: sheet.name, range: null }])
  const b = bounds(doc)
  const end = usedRange(sheet).split(':')[1] ?? 'A1'
  const range = b.r1 === b.r2 ? `${cellName(b.r1, 0)}:${end}` : selectionRange(doc.sel.peek())
  change(doc, msg('Filter'), [{ op: 'filter', sheet: sheet.name, range }])
}

export function toggleFreeze(doc: SheetDoc): void {
  const sheet = doc.activeSheet.peek()
  const s = doc.sel.peek()
  const off = !!sheet.frozen && (sheet.frozen.rows > 0 || sheet.frozen.cols > 0)
  change(doc, msg('Freeze Panes'), [{ op: 'freeze', sheet: sheet.name, rows: off ? 0 : s.r, cols: off ? 0 : s.c }])
}

export function activateSheet(doc: SheetDoc, name: string): void {
  const wb = doc.wb.peek()
  const i = wb.sheets.findIndex((s) => s.name === name)
  if (i < 0 || i === (wb.active ?? 0)) return
  // Switching tabs isn't an edit: no undo step, and the file isn't marked changed.
  doc.wb.value = { ...wb, active: i }
  doc.sel.value = { r: 0, c: 0, r2: 0, c2: 0 }
}

export function addSheet(doc: SheetDoc): void {
  const names = new Set(doc.wb.peek().sheets.map((s) => s.name.toLowerCase()))
  let n = doc.wb.peek().sheets.length + 1
  while (names.has(t('Sheet{n}', { n }).toLowerCase())) n++
  const name = t('Sheet{n}', { n })
  if (change(doc, msg('Add Sheet'), [{ op: 'addSheet', name, after: on(doc) }, { op: 'activate', sheet: name }])) doc.sel.value = { r: 0, c: 0, r2: 0, c2: 0 }
}

export function renameSheet(doc: SheetDoc, to: string): void {
  if (to.trim() && to !== on(doc)) change(doc, msg('Rename Sheet'), [{ op: 'renameSheet', from: on(doc), to: to.trim() }])
}

export function deleteSheet(doc: SheetDoc): void {
  change(doc, msg('Delete Sheet'), [{ op: 'deleteSheet', name: on(doc) }])
}

/** Looks for broken formulas, unknown functions, wrong types and leftover sample text. */
export async function checkSheet(doc: SheetDoc): Promise<SheetFinding[]> {
  const { checkWorkbook } = await import('../core/sheet/check')
  return checkWorkbook(doc.wb.peek())
}

/** The style of the picked cell, for toggles like bold. */
export function selectionStyle(doc: SheetDoc): Style | undefined {
  const s = doc.sel.peek()
  return styleAt(doc.activeSheet.peek(), s.r, s.c)
}

export function toggleMerge(doc: SheetDoc): void {
  const sheet = doc.activeSheet.peek()
  const s = doc.sel.peek()
  const hit = sheet.merges.find((m) => {
    const r = parseRange(m)
    return !!r && inRange(r, s.r, s.c)
  })
  if (hit) change(doc, msg('Unmerge Cells'), [{ op: 'unmerge', sheet: sheet.name, range: hit }])
  else if (s.r !== s.r2 || s.c !== s.c2) change(doc, msg('Merge Cells'), [{ op: 'merge', sheet: sheet.name, range: selectionRange(s) }])
}
