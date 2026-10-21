/**
 * Every change to a document is one of these operations, whoever makes it: an AI app
 * through glance_doc_edit, the Ask AI sidebar, or the person typing in the editor. A list
 * of them is applied all or nothing, so one AI turn is one undo step, and an invalid op
 * changes nothing and says why.
 *
 * Blocks come in as AI apps write them: text with light marks (**bold**, *italic*,
 * [link](url)) or runs, and are checked into the model's shape here.
 */
import { BLOCK_TYPES, allBlocks, idMaker, isMediaPath, parseRuns, tidyRuns, type Block, type Doc, type Run, type Section } from './model'
import { DOC_DESIGN_ID, findDocDesign, lookOf, type DocBoard, type DocDesign } from './look'

export type DocOp =
  /** New blocks in a flowing section, after block `after` (null: at the start; left out: at the end). */
  | { op: 'addBlocks'; section?: string; after?: string | null; blocks: unknown[] }
  /** Moves blocks, keeping their order, to just after `after` (null: the start of `section`). */
  | { op: 'moveBlocks'; ids: string[]; after: string | null; section?: string }
  | { op: 'deleteBlocks'; ids: string[] }
  /** Puts a new block in the place of block `id`; it keeps the id. */
  | { op: 'replaceBlock'; id: string; block: unknown }
  /** Fills a fixed page's text box. Empty text clears it. */
  | { op: 'setText'; section: string; box: string; text: string }
  /** A new page or section from one of the look's designs, after section `after` (null: first). */
  | { op: 'addSection'; design: string; after?: string | null; texts?: Record<string, unknown>; tables?: Record<string, unknown>; blocks?: unknown[] }
  | { op: 'deleteSection'; ids: string[] }
  | { op: 'moveSection'; ids: string[]; after: string | null }
  /** Draws the document in another look; flowing text keeps flowing, fixed pages keep the boxes the new page also has. */
  | { op: 'setLook'; look: string }
  /** Table rows: a table block (`id`) or a fixed page's table (`section` and `table`). */
  | { op: 'addRow'; id?: string; section?: string; table?: string; at?: number; cells: unknown[] }
  | { op: 'deleteRow'; id?: string; section?: string; table?: string; row: number }
  | { op: 'setCell'; id?: string; section?: string; table?: string; row: number; col: number; text: string }
  | { op: 'setRows'; id?: string; section?: string; table?: string; rows: unknown[] }

export class DocError extends Error {}

export interface DocApplyResult {
  doc: Doc
  /** Ids of the blocks and sections the operations made. */
  added: string[]
  /** What a change of look or design left out. */
  dropped: string[]
}

/** Finds the loaded looks; the document's own look and any setLook names must be loaded. */
export type Looks = (id: string) => DocBoard | undefined

/**
 * Applies `ops` in order to a copy of `doc`. Throws DocError, changing nothing, if any op
 * is invalid.
 */
export function applyDocOps(doc: Doc, ops: DocOp[], looks: Looks): DocApplyResult {
  if (!Array.isArray(ops) || !ops.length) throw new DocError('ops must list at least one operation')
  const next = structuredClone(doc)
  const ids = idMaker(next)
  const added: string[] = []
  const dropped: string[] = []
  const ctx: Ctx = {
    doc: next,
    looks,
    dropped,
    block: () => { const id = ids.block(); added.push(id); return id },
    section: () => { const id = ids.section(); added.push(id); return id }
  }
  ops.forEach((op, i) => {
    try {
      apply(ctx, op)
    } catch (e) {
      if (e instanceof DocError) throw new DocError(`Operation ${i + 1} (${(op as { op?: unknown })?.op}): ${e.message}`)
      throw e
    }
  })
  return { doc: next, added, dropped }
}

interface Ctx {
  doc: Doc
  looks: Looks
  dropped: string[]
  block: () => string
  section: () => string
}

const board = (ctx: Ctx) => ctx.looks(ctx.doc.look)

function apply(ctx: Ctx, op: DocOp): void {
  const doc = ctx.doc
  switch (op?.op) {
    case 'addBlocks': {
      const blocks = blockList(op.blocks, ctx)
      if (op.after) {
        const at = findBlock(doc, op.after)
        at.parent.splice(at.parent.indexOf(at.block) + 1, 0, ...blocks)
        return
      }
      const s = flowSection(ctx, op.section)
      if (op.after === null) s.blocks!.unshift(...blocks)
      else s.blocks!.push(...blocks)
      return
    }
    case 'moveBlocks': {
      const list = unique(op.ids, 'block')
      if (op.after && list.includes(op.after)) throw new DocError(`can't move ${op.after} after itself`)
      const found = list.map((id) => findBlock(doc, id))
      for (const f of found) f.parent.splice(f.parent.indexOf(f.block), 1)
      const moving = found.map((f) => f.block)
      if (op.after) {
        const at = findBlock(doc, op.after)
        at.parent.splice(at.parent.indexOf(at.block) + 1, 0, ...moving)
      } else flowSection(ctx, op.section).blocks!.unshift(...moving)
      return
    }
    case 'deleteBlocks':
      for (const id of unique(op.ids, 'block')) {
        const f = findBlock(doc, id)
        f.parent.splice(f.parent.indexOf(f.block), 1)
      }
      return
    case 'replaceBlock': {
      const f = findBlock(doc, op.id)
      const block = blockOf(op.block, ctx, op.id)
      f.parent[f.parent.indexOf(f.block)] = block
      return
    }
    case 'setText': {
      const s = section(doc, op.section)
      const d = designOf(ctx, s)
      const box = d.texts.find((t) => t.name === op.box)
      if (!box) throw new DocError(`${s.id} (${d.id}) has no text box ${op.box}; it has ${d.texts.map((t) => t.name).join(', ') || 'none'}`)
      if (d.auto?.[op.box] || d.calcs?.[op.box]) throw new DocError(`${op.box} is worked out by the page; change what it comes from instead`)
      if (typeof op.text !== 'string') throw new DocError('text must be text')
      if (op.text) s.texts[op.box] = op.text
      else delete s.texts[op.box]
      return
    }
    case 'addSection': {
      const b = board(ctx)
      if (typeof op.design !== 'string' || !DOC_DESIGN_ID.test(op.design)) throw new DocError('design must be a design id from glance_templates, like essay.2 or essay.plain')
      if (lookOf(op.design) !== doc.look) throw new DocError(`design ${op.design} isn't in this document's look (${doc.look}); use setLook first`)
      const d = findDocDesign(b, op.design)
      if (!d) throw new DocError(`no design ${op.design}; glance_templates lists the designs`)
      const s: Section = { id: ctx.section(), design: d.id, texts: {}, tables: {} }
      for (const [name, v] of Object.entries(op.texts ?? {})) {
        if (!d.texts.some((t) => t.name === name)) throw new DocError(`${d.id} has no text box ${name}`)
        if (typeof v !== 'string') throw new DocError(`text box ${name} takes text`)
        if (v) s.texts[name] = v
      }
      for (const [name, v] of Object.entries(op.tables ?? {})) {
        if (!d.tables.some((t) => t.name === name)) throw new DocError(`${d.id} has no table ${name}`)
        s.tables[name] = rowsOf(v)
      }
      if (d.flow) s.blocks = blockList(op.blocks ?? [], ctx)
      else if (op.blocks?.length) throw new DocError(`${d.id} is a fixed page; it takes texts and tables, not blocks`)
      doc.sections.splice(op.after === undefined ? doc.sections.length : op.after === null ? 0 : sectionIndex(doc, op.after) + 1, 0, s)
      return
    }
    case 'deleteSection': {
      const gone = new Set(unique(op.ids, 'section').map((id) => section(doc, id)))
      doc.sections = doc.sections.filter((s) => !gone.has(s))
      return
    }
    case 'moveSection': {
      const list = unique(op.ids, 'section')
      if (op.after && list.includes(op.after)) throw new DocError(`can't move ${op.after} after itself`)
      const moving = list.map((id) => section(doc, id)).sort((a, b) => doc.sections.indexOf(a) - doc.sections.indexOf(b))
      const rest = doc.sections.filter((s) => !moving.includes(s))
      const at = op.after === null ? 0 : rest.findIndex((s) => s.id === op.after) + 1
      if (op.after !== null && at === 0) throw new DocError(`no section ${op.after}`)
      rest.splice(at, 0, ...moving)
      doc.sections = rest
      return
    }
    case 'setLook':
      setLook(ctx, op.look)
      return
    case 'addRow': {
      const t = tableOf(ctx, op)
      const cells = cellsOf(op.cells)
      const at = op.at === undefined ? t.rows.length : op.at
      if (!Number.isInteger(at) || at < 0 || at > t.rows.length) throw new DocError(`at must be a row number from 0 to ${t.rows.length}`)
      t.rows.splice(at, 0, cells)
      return
    }
    case 'deleteRow': {
      const t = tableOf(ctx, op)
      rowAt(t.rows, op.row)
      t.rows.splice(op.row, 1)
      return
    }
    case 'setCell': {
      const t = tableOf(ctx, op)
      const row = rowAt(t.rows, op.row)
      if (!Number.isInteger(op.col) || op.col < 0 || op.col > 20) throw new DocError('col must be a column number from 0')
      if (typeof op.text !== 'string') throw new DocError('text must be text')
      while (row.length <= op.col) row.push('')
      row[op.col] = op.text
      return
    }
    case 'setRows': {
      const t = tableOf(ctx, op)
      t.rows.splice(0, t.rows.length, ...rowsOf(op.rows))
      return
    }
    default:
      throw new DocError(`unknown operation ${String((op as { op?: unknown })?.op)}; operations are addBlocks, moveBlocks, deleteBlocks, replaceBlock, setText, addSection, deleteSection, moveSection, setLook, addRow, deleteRow, setCell, setRows`)
  }
}

function section(doc: Doc, id: unknown): Section {
  const s = doc.sections.find((x) => x.id === id)
  if (!s) throw new DocError(`no section ${String(id)}; sections are ${doc.sections.map((x) => x.id).join(', ') || 'none'}`)
  return s
}

const sectionIndex = (doc: Doc, id: string) => doc.sections.indexOf(section(doc, id))

function designOf(ctx: Ctx, s: Section): DocDesign {
  const d = findDocDesign(board(ctx), s.design)
  if (!d) throw new DocError(`section ${s.id} uses design ${s.design}, which this Glance doesn't have`)
  return d
}

/** The flowing section blocks go in: the one named, or the last flowing one. */
function flowSection(ctx: Ctx, id?: string): Section {
  const doc = ctx.doc
  if (id !== undefined) {
    const s = section(doc, id)
    if (!s.blocks) throw new DocError(`section ${s.id} is a fixed page; use setText for its boxes`)
    return s
  }
  const s = [...doc.sections].reverse().find((x) => x.blocks)
  if (!s) throw new DocError('the document has no flowing section; add one with addSection (a design whose kind is flowing)')
  return s
}

function findBlock(doc: Doc, id: unknown): { block: Block; section: Section; parent: Block[] } {
  for (const x of allBlocks(doc)) if (x.block.id === id) return x
  throw new DocError(`no block ${String(id)}; glance_doc_outline lists the blocks`)
}

function unique(ids: unknown, what: string): string[] {
  if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === 'string')) throw new DocError(`ids must list at least one ${what}`)
  return [...new Set(ids as string[])]
}

/** A table to change: a table block, or a fixed page's table. */
function tableOf(ctx: Ctx, op: { id?: string; section?: string; table?: string }): { rows: string[][] } {
  if (op.id !== undefined) {
    const b = findBlock(ctx.doc, op.id).block
    if (b.type !== 'table' && b.type !== 'chart') throw new DocError(`${op.id} is a ${b.type}, not a table`)
    return b
  }
  if (op.section === undefined || op.table === undefined) throw new DocError('name the table: id (a table block) or section and table (a page\'s table)')
  const s = section(ctx.doc, op.section)
  const d = designOf(ctx, s)
  if (!d.tables.some((t) => t.name === op.table)) throw new DocError(`${s.id} has no table ${op.table}; it has ${d.tables.map((t) => t.name).join(', ') || 'none'}`)
  const rows = s.tables[op.table!] ?? (s.tables[op.table!] = [])
  return { rows }
}

function rowAt(rows: string[][], n: unknown): string[] {
  if (!Number.isInteger(n) || (n as number) < 0 || (n as number) >= rows.length) throw new DocError(`row must be a row number from 0 to ${rows.length - 1}`)
  return rows[n as number]
}

const isText = (v: unknown): v is string => typeof v === 'string'

function cellsOf(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.length > 20) throw new DocError('cells must be a list of 1 to 20 cells')
  return v.map((c) => (typeof c === 'number' ? String(c) : isText(c) ? c : bad('cells must be text')))
}

function rowsOf(v: unknown): string[][] {
  if (!Array.isArray(v) || v.length > 500) throw new DocError('rows must be a list of rows, each a list of text cells')
  return v.map(cellsOf)
}

const bad = (why: string): never => {
  throw new DocError(why)
}

/** Runs from text with light marks, or from a list of runs. */
function runsOf(v: unknown, what = 'text'): Run[] {
  if (isText(v)) return parseRuns(v)
  if (Array.isArray(v) && v.every((r) => r && isText(r.text))) {
    return tidyRuns(v.map((r) => ({
      text: r.text,
      ...(r.b ? { b: true } : {}),
      ...(r.i ? { i: true } : {}),
      ...(r.u ? { u: true } : {}),
      ...(isText(r.href) && /^(https?:|mailto:)/.test(r.href) ? { href: r.href } : {}),
      ...(isText(r.c) && /^\w{1,20}$/.test(r.c) ? { c: r.c } : {})
    })))
  }
  return bad(`${what} must be text (with **bold**, *italic* or [link](url)) or a list of runs { text, b, i }`)
}

function styleName(ctx: Ctx, v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (!isText(v)) return bad('style must be a style name from glance_templates')
  const b = board(ctx)
  if (b && !b.styles[v] && !b.boxes[v] && !b.tables[v]) return bad(`the look has no style ${v}; it has ${Object.keys(b.styles).join(', ')}`)
  return v
}

function blockList(v: unknown, ctx: Ctx): Block[] {
  if (!Array.isArray(v)) return bad('blocks must be a list of blocks')
  return v.map((b) => blockOf(b, ctx))
}

/** Checks a block that came from outside into the model's shape. */
function blockOf(v: unknown, ctx: Ctx, keepId?: string): Block {
  const o = (v ?? {}) as Record<string, unknown>
  if (typeof o !== 'object' || !isText(o.type) || !BLOCK_TYPES.includes(o.type as Block['type'])) {
    return bad(`a block needs a type: ${BLOCK_TYPES.join(', ')}`)
  }
  const id = keepId ?? ctx.block()
  const style = styleName(ctx, o.style)
  const st = style ? { style } : {}
  switch (o.type) {
    case 'heading': {
      const level = o.level === undefined ? 1 : o.level
      if (level !== 1 && level !== 2 && level !== 3) return bad('a heading\'s level is 1, 2 or 3')
      return { id, type: 'heading', level, runs: runsOf(o.text ?? o.runs), ...st }
    }
    case 'paragraph':
      return { id, type: 'paragraph', runs: runsOf(o.text ?? o.runs), ...st, ...(isText(o.icon) && board(ctx)?.arts[o.icon] ? { icon: o.icon } : {}) }
    case 'list': {
      if (!Array.isArray(o.items) || !o.items.length) return bad('a list needs items: a list of text')
      return { id, type: 'list', ordered: o.ordered === true, items: o.items.map((it) => runsOf(it, 'a list item')), ...st }
    }
    case 'quote':
      return { id, type: 'quote', runs: runsOf(o.text ?? o.runs), ...(isText(o.cite) && o.cite ? { cite: o.cite } : {}), ...st }
    case 'callout': {
      const inner = o.blocks !== undefined ? blockList(o.blocks, ctx) : [blockOf({ type: 'paragraph', text: o.text }, ctx)]
      if (inner.some((b) => b.type === 'callout' || b.type === 'pageBreak')) return bad('a callout can\'t hold callouts or page breaks')
      return { id, type: 'callout', blocks: inner, ...st }
    }
    case 'table': {
      const rows = rowsOf(o.rows)
      if (!rows.length) return bad('a table needs rows')
      return { id, type: 'table', rows, header: o.header !== false, ...(o.footer === true ? { footer: true } : {}), ...st }
    }
    case 'picture': {
      if (!isText(o.src) || !isMediaPath(o.src)) return bad('a picture\'s src must be a file in the document\'s media/ folder, like media/photo.jpg')
      const width = typeof o.width === 'number' ? Math.min(1, Math.max(0.2, o.width)) : undefined
      return { id, type: 'picture', src: o.src, alt: isText(o.alt) ? o.alt : '', ...(isText(o.caption) && o.caption ? { caption: o.caption } : {}), ...(width ? { width } : {}) }
    }
    case 'chart': {
      const chart = o.chart ?? 'bar'
      if (chart !== 'bar' && chart !== 'line' && chart !== 'pie') return bad('chart is bar, line or pie')
      const rows = rowsOf(o.rows)
      if (rows.length < 2) return bad('a chart\'s rows are a header row (label, series…) then one row per label')
      return { id, type: 'chart', chart, rows, ...(isText(o.title) && o.title ? { title: o.title } : {}), ...(isText(o.caption) && o.caption ? { caption: o.caption } : {}) }
    }
    case 'art': {
      const b = board(ctx)
      if (!isText(o.art) || (b && !b.arts[o.art])) return bad(`art must be one of the look's drawings: ${Object.keys(b?.arts ?? {}).join(', ') || 'none'}`)
      return { id, type: 'art', art: o.art, ...(isText(o.caption) && o.caption ? { caption: o.caption } : {}) }
    }
    case 'divider':
      return { id, type: 'divider', ...st }
    case 'columns': {
      if (!Array.isArray(o.columns) || o.columns.length < 2 || o.columns.length > 3) return bad('columns needs 2 or 3 columns, each a list of blocks')
      const columns = o.columns.map((c) => blockList(c, ctx))
      if (columns.flat().some((b) => b.type === 'columns' || b.type === 'pageBreak')) return bad('columns can\'t hold columns or page breaks')
      let widths: number[] | undefined
      if (Array.isArray(o.widths) && o.widths.length === columns.length && o.widths.every((w) => typeof w === 'number' && w > 0)) {
        const sum = (o.widths as number[]).reduce((a, b) => a + b, 0)
        widths = Math.abs(sum - 1) < 0.02 ? [...(o.widths as number[])] : (o.widths as number[]).map((w) => Math.round((w / sum) * 1000) / 1000)
      }
      return { id, type: 'columns', columns, ...(widths ? { widths } : {}), ...st }
    }
    case 'pageBreak':
      return { id, type: 'pageBreak' }
  }
  return bad('unknown block')
}

/**
 * Moves the document to another look. Flowing sections take the new look's flowing
 * design; a fixed page takes the new look's page with the same role, then the same
 * number, and keeps the boxes that page also has.
 */
function setLook(ctx: Ctx, look: unknown) {
  if (!isText(look) || !look) return bad('look must be a look id from glance_templates')
  const nb = ctx.looks(look)
  if (!nb) return bad(`no look ${look} (or it isn't loaded); glance_templates lists the looks`)
  const ob = board(ctx)
  const doc = ctx.doc
  for (const s of doc.sections) {
    const od = findDocDesign(ob, s.design)
    if (s.blocks || od?.flow) {
      s.design = nb.flow
      s.blocks ??= []
      for (const [name, text] of Object.entries(s.texts)) if (text && !findDocDesign(nb, nb.flow)?.texts.some((t) => t.name === name)) ctx.dropped.push(`${s.id}: text box ${name}`)
      continue
    }
    const num = s.design.slice(s.design.lastIndexOf('.') + 1)
    const nd = nb.designs.find((d) => !d.flow && od && d.role === od.role) ?? nb.designs.find((d) => d.id === `${look}.${num}` && !d.flow)
    if (!nd) {
      // No page like it: its text flows on a plain page instead.
      const texts = Object.values(s.texts).filter(Boolean)
      ctx.dropped.push(`${s.id}: page ${s.design} became plain text`)
      s.design = `${look}.plain`
      s.blocks = texts.map((t) => ({ id: ctx.block(), type: 'paragraph', runs: parseRuns(t) }))
      s.texts = {}
      s.tables = {}
      continue
    }
    for (const name of Object.keys(s.texts)) if (!nd.texts.some((t) => t.name === name)) { ctx.dropped.push(`${s.id}: text box ${name}`); delete s.texts[name] }
    for (const name of Object.keys(s.tables)) if (!nd.tables.some((t) => t.name === name)) { ctx.dropped.push(`${s.id}: table ${name}`); delete s.tables[name] }
    s.design = nd.id
  }
  // Styles the new look lacks fall back to its body style when drawn, so they are left as they are.
  doc.look = look
}
