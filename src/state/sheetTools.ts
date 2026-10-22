/**
 * The spreadsheet tools AI apps use (definitions in core/mcp/tools.json): create a workbook,
 * read it with the context an edit needs, change it with sheet operations, check it and
 * look at it. Changes go through SheetDoc.apply, so each call is one step the user can undo.
 * glance_create, glance_templates and glance_export cover decks too: those go on to the
 * deck tools. Messages here are read by the AI app, so they're English.
 */
import { ToolError, type ToolHandler, type ToolResult } from '../core/mcp/protocol'
import { checkOutput, extension, toBase64 } from '../core/mcp/helpers'
import { samePath } from '../core/paths'
import * as platform from '../platform'
import { activeDoc, activeId, docs } from './documents'
import { SheetDoc } from './sheetDoc'
import { deckHandlers } from './deckTools'
import { registerGuideContext } from './guideContext'
import { findPlaceholders, validationHint } from '../core/ai/guide'
import { newSheet, sheetBytes, sheetSelection, usedRange, loadFunctions } from './sheet'
import { SHEET_TEMPLATES, sheetTemplate } from './sheetTemplates'
import * as versions from './versions'
import { toast } from './ui'
import { msg, t } from '../i18n'
import { applyOps, SheetError, type SheetOp } from '../core/sheet/ops'
import { checkWorkbook } from '../core/sheet/check'
import { cellName, overlaps, parseRange } from '../core/sheet/address'
import { describeRule } from '../core/sheet/validate'
import { emptyWorkbook, findSheet, plainText, styleAt, type Sheet, type Workbook } from '../core/sheet/model'
import { todaySerial } from '../core/sheet/recalc'

const MAX_CELLS = 3000

function json(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value }
}

const isSheetTab = (tab: unknown): boolean => {
  const d = tab === undefined || tab === null || tab === '' ? activeDoc.value : docs.value.find((x) => x.id === tab || (x.path.peek() && samePath(x.path.peek()!, String(tab), platform.pathPolicy)))
  return d instanceof SheetDoc
}

function findSheetDoc(tab: unknown): SheetDoc {
  const d = tab === undefined || tab === null || tab === '' ? activeDoc.value : docs.value.find((x) => x.id === tab || (x.path.peek() && samePath(x.path.peek()!, String(tab), platform.pathPolicy)))
  if (!d) throw new ToolError(tab ? `No open tab "${String(tab)}". glance_list_open lists the tabs; open an .xlsx or .csv with glance_open.` : 'No spreadsheet is open in Glance. Create one with glance_create kind spreadsheet, or open an .xlsx or .csv with glance_open.')
  if (!(d instanceof SheetDoc)) throw new ToolError(`${d.name.peek()} is not a spreadsheet. Create one with glance_create kind spreadsheet.`)
  return d
}

function opsOf(value: unknown): SheetOp[] {
  if (!Array.isArray(value) || !value.every((op) => op && typeof op === 'object' && typeof op.op === 'string')) throw new ToolError('ops must be a list of operations like {"op": "set", "cell": "A1", "value": "Name"}')
  return value as SheetOp[]
}

/** Tables on a sheet: blocks whose first row is text headers over at least one row of data. */
function tablesOf(s: Sheet): { range: string; headers: string[] }[] {
  const out: { range: string; headers: string[] }[] = []
  const seen = new Set<string>()
  const text = (r: number, c: number) => plainText(s.cells[cellName(r, c)]?.v)
  const keys = Object.keys(s.cells).map((k) => parseRange(k)!).sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1)
  for (const k of keys) {
    const { r1: r, c1: c } = k
    if (seen.has(cellName(r, c)) || typeof s.cells[cellName(r, c)]?.v !== 'string' || s.cells[cellName(r, c)]?.f) continue
    let c2 = c
    while (typeof s.cells[cellName(r, c2 + 1)]?.v === 'string' && text(r, c2 + 1) && !s.cells[cellName(r, c2 + 1)]?.f) c2++
    if (c2 - c < 2) continue
    let r2 = r
    while (r2 - r < 2000 && Array.from({ length: c2 - c + 1 }, (_, i) => text(r2 + 1, c + i)).some(Boolean)) r2++
    if (r2 === r) continue
    for (let rr = r; rr <= r2; rr++) for (let cc = c; cc <= c2; cc++) seen.add(cellName(rr, cc))
    out.push({ range: `${cellName(r, c)}:${cellName(r2, c2)}`, headers: Array.from({ length: c2 - c + 1 }, (_, i) => text(r, c + i)) })
    if (out.length >= 12) break
  }
  return out
}

/** The cells of a range that hold something: [ref, shown value, formula?, number format?]. */
function cellsIn(s: Sheet, range: string): unknown[][] {
  const g = parseRange(range)
  if (!g) throw new ToolError(`range must look like "A1:D20", not ${range}`)
  const out: unknown[][] = []
  for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 999); r++) {
    for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 99); c++) {
      const cell = s.cells[cellName(r, c)]
      if (!cell || (cell.v === null || cell.v === undefined || cell.v === '') && !cell.f) continue
      const fmt = styleAt(s, r, c)?.numFmt
      out.push([cellName(r, c), cell.v ?? null, ...(cell.f || fmt ? [cell.f ? `=${cell.f}` : null] : []), ...(fmt ? [fmt] : [])])
      if (out.length >= MAX_CELLS) return out
    }
  }
  return out
}

function describe(doc: SheetDoc, sheetName?: unknown, range?: unknown) {
  const wb = doc.wb.peek()
  const s = sheetName ? findSheet(wb, String(sheetName)) : doc.activeSheet.peek()
  if (!s) throw new ToolError(`no sheet "${String(sheetName)}"; sheets are ${wb.sheets.map((x) => x.name).join(', ')}`)
  const used = usedRange(s)
  const want = range ? String(range).toUpperCase() : used
  const cells = cellsIn(s, want)
  return {
    tab: doc.id,
    name: doc.name.peek(),
    path: doc.path.peek(),
    unsaved_changes: doc.dirty.peek(),
    sheets: wb.sheets.map((x) => ({
      name: x.name,
      used_range: usedRange(x),
      ...(x.hidden ? { hidden: true } : {}),
      ...(x.frozen && (x.frozen.rows || x.frozen.cols) ? { frozen: x.frozen } : {}),
      tables: tablesOf(x),
      ...(x.validations.length ? { drop_downs_and_rules: x.validations.map((v) => ({ range: v.ref, type: v.type, ...(v.values ? { choices: v.values } : {}), ...(v.source ? { source: v.source } : {}), rule: describeRule(v) })) } : {}),
      ...(x.charts.length ? { charts: x.charts.map((c) => ({ id: c.id, type: c.type, title: c.title, categories: c.categories, series: c.series.map((z) => z.values) })) } : {}),
      ...(x.cf.length ? { conditional_formats: x.cf.map((c) => ({ range: c.ref, rules: c.rules.map((r) => r.type) })) } : {}),
      ...(x.filter ? { filter: x.filter.ref } : {})
    })),
    selection: sheetSelection(doc),
    sheet: s.name,
    range: want,
    // [cell, value, formula, number format]; values are what formulas give now.
    cells,
    ...(cells.length >= MAX_CELLS ? { note: `Only the first ${MAX_CELLS} filled cells; ask for a smaller range.` } : {})
  }
}

const read: ToolHandler = async ({ tab, sheet, range }) => json(describe(findSheetDoc(tab), sheet, range))

const edit: ToolHandler = async ({ tab, ops }) => {
  const doc = findSheetDoc(tab)
  const list = opsOf(ops)
  let r
  try {
    r = doc.apply(msg('AI Edit'), list)
  } catch (e) {
    if (e instanceof SheetError) throw new ToolError(e.message)
    throw e
  }
  await platform.showForAi()
  return json({ ...(r.added.length ? { added: r.added } : {}), active_sheet: doc.activeSheet.peek().name, findings: checkWorkbook(r.wb) })
}

const check: ToolHandler = async ({ tab }) => {
  const findings = checkWorkbook(findSheetDoc(tab).wb.peek())
  return json({ findings, passes: findings.length === 0 })
}

const render: ToolHandler = async ({ tab, sheet, scale }) => {
  const doc = findSheetDoc(tab)
  const wb = doc.wb.peek()
  const s = sheet ? findSheet(wb, String(sheet)) : doc.activeSheet.peek()
  if (!s) throw new ToolError(`no sheet "${String(sheet)}"`)
  const { sheetPng } = await import('../sheet/picture')
  const png = await sheetPng(wb, s, doc.media, Math.min(2, Math.max(0.5, Number(scale ?? 1))))
  // i18n-ignore: read by the AI app, not shown in Glance
  return { content: [{ type: 'text', text: `Sheet ${s.name}, ${usedRange(s)}` }, { type: 'image', data: toBase64(png), mimeType: 'image/png' }] }
}

async function createSheet({ title, template, ops, output_path, overwrite }: Record<string, unknown>): Promise<ToolResult> {
  let out: string | null = null
  if (output_path !== undefined) {
    out = String(output_path)
    if (extension(out) !== 'xlsx') throw new ToolError('output_path must end in .xlsx')
    checkOutput(out, [], (await platform.fileStamp(out)) !== null, overwrite === true, platform.pathPolicy)
  }
  await loadFunctions()
  let start: Workbook = emptyWorkbook('Sheet1')
  let media = new Map<string, Uint8Array>()
  if (template !== undefined) {
    const tpl = await sheetTemplate(String(template))
    if (!tpl) throw new ToolError(`no spreadsheet template ${String(template)}; glance_templates lists them (${SHEET_TEMPLATES.map((x) => x.id).join(', ')})`)
    start = tpl.wb
    media = tpl.media
  }
  let wb: Workbook
  try {
    wb = applyOps(start, ops === undefined ? [] : opsOf(ops), { media, today: todaySerial() }).wb
  } catch (e) {
    if (e instanceof SheetError) throw new ToolError(e.message)
    throw e
  }
  const name = (typeof title === 'string' && title.trim()) || (template ? SHEET_TEMPLATES.find((x) => x.id === template)?.name : '') || 'Spreadsheet'
  await platform.showForAi()
  const doc = newSheet(name.replace(/[\\/:*?"<>|]/g, '').slice(0, 80), wb, media)
  if (out) {
    const bytes = await sheetBytes(doc, 'xlsx')
    await platform.writeFile(out, bytes)
    doc.path.value = out
    doc.name.value = platform.baseName(out)
    void platform.claimFile(out)
    await versions.rememberStamp(doc)
    await versions.afterWrite(out, msg('Created by AI'), bytes)
  } else doc.dirty.value = true
  activeId.value = doc.id
  toast(t('AI made a spreadsheet.'))
  return json({
    ...describe(doc),
    findings: checkWorkbook(wb),
    ...(out ? {} : { note: 'The workbook is open in Glance and not saved yet; the user can save it, or pass output_path next time.' })
  })
}

const create: ToolHandler = async (args) => (args.kind === 'spreadsheet' ? createSheet(args) : deckHandlers.glance_create(args))

const templates: ToolHandler = async (args) => {
  const decks = await deckHandlers.glance_templates(args)
  const base = typeof decks === 'string' ? { decks } : (decks.structuredContent ?? {})
  return json({
    ...base,
    spreadsheets: SHEET_TEMPLATES.map((x) => ({ id: x.id, name: x.name, blurb: x.blurb, purpose: x.purpose, sheets: x.sheets })),
    spreadsheet_note: 'Pass a spreadsheet template id to glance_create with kind spreadsheet; it opens with sample data and live formulas. Read it with glance_sheet_read before changing the data.'
  })
}

const exportTool: ToolHandler = async (args) => {
  if (!isSheetTab(args.tab)) return deckHandlers.glance_export(args)
  const doc = findSheetDoc(args.tab)
  const out = String(args.output_path)
  const want = String(args.format)
  if (!['xlsx', 'csv', 'pdf', 'png'].includes(want)) throw new ToolError('a spreadsheet exports as xlsx, csv (the active sheet), pdf or png (the active sheet)')
  if (extension(out) !== want) throw new ToolError(`output_path must end in .${want}`)
  checkOutput(out, doc.path.peek() ? [doc.path.peek()!] : [], (await platform.fileStamp(out)) !== null, args.overwrite === true, platform.pathPolicy)
  await platform.writeFile(out, await sheetBytes(doc, want as 'xlsx' | 'csv' | 'pdf' | 'png'))
  return `Wrote ${out}`
}

// Guided AI requests about an open spreadsheet get its sheets, the picked cells and their rules.
registerGuideContext((doc) => {
  if (!(doc instanceof SheetDoc)) return null
  const sel = sheetSelection(doc)
  const s = doc.activeSheet.peek()
  const picked = parseRange(sel.range)
  const validation = s.validations
    .filter((v) => !picked || v.ref.split(/\s+/).some((x) => {
      const g = parseRange(x)
      return !!g && overlaps(g, picked)
    }))
    .map((v) => `${v.ref}: ${v.source ? `one of the values in ${v.source}` : validationHint(v)}`)
  const path = doc.path.peek()
  const text = doc.wb.peek().sheets.flatMap((x) => Object.values(x.cells).map((c) => plainText(c?.v))).join('\n')
  return {
    kind: 'spreadsheet',
    tab: doc.id,
    name: doc.name.peek(),
    ...(path && !path.startsWith('browser:') ? { path } : {}),
    count: doc.wb.peek().sheets.length,
    selection: { kind: 'spreadsheet', sheet: sel.sheet, range: sel.range, values: sel.values, formulas: sel.formulas, ...(validation.length ? { validation } : {}) },
    placeholders: findPlaceholders(text)
  }
})

export const sheetHandlers: Record<string, ToolHandler> = {
  glance_templates: templates,
  glance_create: create,
  glance_export: exportTool,
  glance_sheet_read: read,
  glance_sheet_edit: edit,
  glance_sheet_check: check,
  glance_sheet_render: render
}

