/**
 * The document tools AI apps use (definitions in core/mcp/tools.json): create a document,
 * read it, change it with document operations, check it and look at its pages. Changes go
 * through GDoc.apply as AI changes, so each call is one step the user can keep or undo.
 * glance_create, glance_templates and glance_export are shared with decks: these wrap the
 * deck handlers and take the document cases.
 * Messages here are read by the AI app, not shown in Glance's UI, so they're English.
 */
import { ToolError, type Content, type ToolHandler, type ToolResult } from '../core/mcp/protocol'
import { checkInput, checkOutput, extension, parsePages, toBase64 } from '../core/mcp/helpers'
import { samePath } from '../core/paths'
import * as platform from '../platform'
import { activeDoc, activeId, docs, GDoc } from './documents'
import { DOC_BOARDS } from '../doc/designs'
import { findLook, loadLook, loadLookWithFonts } from './docLooks'
import { gdocBytes, gdocExportBytes, gdocPictures, newGdoc, pagesOf, readAspects } from './gdoc'
import { checkDoc } from '../core/doc/check'
import { DocError, type DocOp } from '../core/doc/ops'
import { allBlocks, blockText, isMediaPath, runsToText, type Block, type Doc } from '../core/doc/model'
import { findDocDesign } from '../core/doc/look'
import { boardDoc, lookCatalog, pageDoc } from '../core/doc/template'
import { measureDocText } from '../doc/measure'
import * as versions from './versions'
import { toast } from './ui'
import { msg, t } from '../i18n'
import { deckHandlers } from './deckTools'
import { registerGuideContext } from './guideContext'
import { findPlaceholders } from '../core/ai/guide'

const PICTURES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']
const MAX_RENDER = 12

function json(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value }
}

const tabOf = (tab: unknown) =>
  tab === undefined || tab === null || tab === '' ? activeDoc.value : docs.value.find((x) => x.id === tab || (x.path.peek() && samePath(x.path.peek()!, String(tab), platform.pathPolicy)))

function findGdoc(tab: unknown): GDoc {
  const d = tabOf(tab)
  if (!d) throw new ToolError(tab ? `No open tab "${String(tab)}". glance_list_open lists the tabs; open a .gdoc with glance_open.` : 'No document is open in Glance. Create one with glance_create (kind "document"), or open a .gdoc with glance_open.')
  if (!(d instanceof GDoc)) throw new ToolError(`${d.name.peek()} is not a Glance document. Create one with glance_create (kind "document").`)
  return d
}

const looks = (id: string) => findLook(id)
const tidyError = (e: unknown) => {
  if (e instanceof DocError) return new ToolError(e.message)
  return e
}

// ---------------------------------------------------------------------------
// What an AI app reads: every section with its boxes (and their room), tables and blocks.

function blockOutline(b: Block): Record<string, unknown> {
  const base = { id: b.id, type: b.type }
  switch (b.type) {
    case 'heading':
      return { ...base, level: b.level, text: runsToText(b.runs), ...(b.style ? { style: b.style } : {}) }
    case 'paragraph':
      return { ...base, text: runsToText(b.runs), ...(b.style ? { style: b.style } : {}), ...(b.icon ? { icon: b.icon } : {}) }
    case 'quote':
      return { ...base, text: runsToText(b.runs), ...(b.cite ? { cite: b.cite } : {}), ...(b.style ? { style: b.style } : {}) }
    case 'list':
      return { ...base, ordered: b.ordered, items: b.items.map(runsToText), ...(b.style ? { style: b.style } : {}) }
    case 'callout':
      return { ...base, blocks: b.blocks.map(blockOutline), ...(b.style ? { style: b.style } : {}) }
    case 'columns':
      return { ...base, columns: b.columns.map((c) => c.map(blockOutline)), ...(b.widths ? { widths: b.widths } : {}) }
    case 'table':
      return { ...base, header: b.header, rows: b.rows, ...(b.footer ? { footer: true } : {}), ...(b.style ? { style: b.style } : {}) }
    case 'chart':
      return { ...base, chart: b.chart, rows: b.rows, ...(b.title ? { title: b.title } : {}), ...(b.caption ? { caption: b.caption } : {}) }
    case 'picture':
      return { ...base, src: b.src, alt: b.alt, ...(b.caption ? { caption: b.caption } : {}), ...(b.width ? { width: b.width } : {}) }
    case 'art':
      return { ...base, art: b.art, ...(b.caption ? { caption: b.caption } : {}) }
    default:
      return base
  }
}

export function docOutline(g: GDoc) {
  const doc = g.doc.peek()
  const board = findLook(doc.look)
  const pages = board ? pagesOf(g) : []
  const sel = g.selection.peek()
  return {
    tab: g.id,
    name: g.name.peek(),
    path: g.path.peek(),
    look: doc.look,
    page_count: pages.length,
    current_page: g.current.peek() + 1,
    unsaved_changes: g.dirty.peek(),
    ...(sel ? { selection: sel } : {}),
    styles: board ? Object.keys(board.styles) : [],
    sections: doc.sections.map((s) => {
      const d = findDocDesign(board, s.design)
      const on = pages.filter((p) => p.section === s.id).map((p) => p.number)
      return {
        id: s.id,
        design: s.design,
        ...(d ? { for: d.role, kind: d.flow ? 'flowing' : 'fixed' } : { unknown_design: true }),
        pages: on.length > 1 ? `${on[0]}-${on.at(-1)}` : String(on[0] ?? ''),
        boxes: (d?.texts ?? []).filter((x) => !d?.auto?.[x.name]).map((x) => ({
          name: x.name,
          text: s.texts[x.name] ?? '',
          hint: x.sample,
          maxChars: x.maxChars,
          ...(d?.calcs?.[x.name] ? { worked_out: true } : {})
        })),
        ...(d?.tables.length ? {
          tables: d.tables.map((r) => ({
            name: r.name,
            columns: r.header ?? r.style.cols.map((_, i) => `column ${i + 1}`),
            rows: s.tables[r.name] ?? [],
            ...(r.calc?.length ? { worked_out_columns: r.calc.map((c) => c.col) } : {})
          }))
        } : {}),
        ...(s.blocks ? { blocks: s.blocks.map(blockOutline) } : {})
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Pictures named by local path are copied into the document's media first.

async function importPictures(value: unknown, add: (name: string, bytes: Uint8Array) => string, copied = new Map<string, string>()): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => importPictures(v, add, copied)))
  if (!value || typeof value !== 'object') return value
  const o = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'object' ? await importPictures(v, add, copied) : v
  if (o.type === 'picture' && typeof o.src === 'string' && !isMediaPath(o.src)) {
    const path = checkInput(o.src)
    if (!PICTURES.includes(extension(path))) throw new ToolError(`${path}: documents take PNG, JPEG, WebP, GIF, AVIF or SVG pictures. Convert it first with glance_convert.`)
    if (!copied.has(path)) {
      if ((await platform.fileStamp(path)) === null) throw new ToolError(`${path} doesn't exist`)
      copied.set(path, add(platform.baseName(path), await platform.readFile(path)))
    }
    out.src = copied.get(path)
  }
  return out
}

function opsOf(value: unknown): DocOp[] {
  if (!Array.isArray(value) || !value.every((op) => op && typeof op === 'object' && typeof op.op === 'string')) throw new ToolError('ops must be a list of operations like {"op": "addBlocks", "blocks": [{"type": "paragraph", "text": "…"}]}')
  return value as DocOp[]
}

/** Loads the looks the ops name, so setLook can check them. */
async function loadOpLooks(ops: DocOp[]) {
  for (const op of ops) if (op.op === 'setLook' && typeof op.look === 'string') await loadLook(op.look)
}

// ---------------------------------------------------------------------------
// Handlers

const outline: ToolHandler = async ({ tab }) => {
  const g = findGdoc(tab)
  await loadLookWithFonts(g.doc.peek().look)
  return json(docOutline(g))
}

const edit: ToolHandler = async ({ tab, ops }) => {
  const g = findGdoc(tab)
  const asked = opsOf(ops)
  await loadLookWithFonts(g.doc.peek().look)
  await loadOpLooks(asked)
  const list = (await importPictures(asked, (name, bytes) => g.addMedia(name, bytes))) as DocOp[]
  let r
  try {
    r = g.apply(msg('AI Edit'), list, { ai: true })
  } catch (e) {
    throw tidyError(e)
  }
  await readAspects(g)
  await platform.showForAi()
  const board = findLook(r.doc.look)
  return json({
    added: r.added,
    ...(r.dropped.length ? { dropped: r.dropped } : {}),
    page_count: board ? pagesOf(g).length : 0,
    findings: checkDoc(r.doc, board, measureDocText)
  })
}

const check: ToolHandler = async ({ tab }) => {
  const g = findGdoc(tab)
  const board = await loadLookWithFonts(g.doc.peek().look)
  const findings = checkDoc(g.doc.peek(), board, measureDocText)
  return json({ findings, passes: findings.length === 0 })
}

/** Page numbers ("1-3,7") or section ids ("p2,p5", every page they fill) to page indexes. */
function pickPages(g: GDoc, count: number, spec: unknown): number[] {
  if (spec === undefined || spec === '') return count ? [Math.min(g.current.peek(), count - 1)] : []
  const s = String(spec).trim()
  if (/^[\d\s,-]+$/.test(s) || /^all$/i.test(s)) return parsePages(s, count)
  const pages = pagesOf(g)
  return s.split(',').flatMap((id) => {
    const on = pages.flatMap((p, i) => (p.section === id.trim() ? [i] : []))
    if (!on.length) throw new ToolError(`no section ${id.trim()}`)
    return on
  })
}

const render: ToolHandler = async ({ tab, pages: spec, max_size }) => {
  const g = findGdoc(tab)
  const board = await loadLookWithFonts(g.doc.peek().look)
  await readAspects(g)
  const pages = pagesOf(g)
  const picked = pickPages(g, pages.length, spec)
  if (!picked.length) throw new ToolError('The document has no pages yet.')
  if (picked.length > MAX_RENDER) throw new ToolError(`Ask for at most ${MAX_RENDER} pages at a time.`)
  const width = Number(max_size ?? 800)
  const { pageCanvas, canvasPng } = await import('../doc/raster')
  const content: Content[] = []
  for (const i of picked) {
    const p = pages[i]
    // i18n-ignore: read by the AI app, not shown in Glance
    content.push({ type: 'text', text: `Page ${i + 1} (section ${p.section}, ${p.design?.id ?? 'unknown design'}${p.overflow.length ? `; too full: ${p.overflow.join(', ')}` : ''})` })
    content.push({ type: 'image', data: toBase64(await canvasPng(await pageCanvas(p, board, g.media, width))), mimeType: 'image/png' })
  }
  return { content }
}

/** The document glance_create asks for: a template as it is, its pages filled in, or flowing blocks in a look. */
async function startDoc(args: Record<string, unknown>, add: (name: string, bytes: Uint8Array) => string): Promise<Doc> {
  const template = args.template ?? args.look
  const lookId = template === undefined || template === null || template === '' ? 'essay' : String(template)
  const board = await loadLookWithFonts(lookId)
  if (!board) throw new ToolError(`no template ${lookId}; glance_templates lists them (${DOC_BOARDS.map((b) => b.id).join(', ')})`)
  const info = DOC_BOARDS.find((b) => b.id === lookId)
  const pagesArg = args.pages
  const blocks = args.blocks
  if (pagesArg === undefined && blocks === undefined) {
    // The template as it is, with its sample text; a pack's page is its own document.
    if (info?.pack) {
      const design = typeof args.design === 'string' ? (args.design.includes('.') ? args.design : `${lookId}.${args.design}`) : `${lookId}.1`
      if (!board.designs.some((d) => d.id === design)) throw new ToolError(`no design ${design}; ${lookId} has ${board.designs.map((d) => d.id).join(', ')}`)
      return pageDoc(board, design)
    }
    return boardDoc(board)
  }
  const ops: DocOp[] = []
  if (Array.isArray(pagesArg)) {
    for (const [i, p] of pagesArg.entries()) {
      const page = (p ?? {}) as Record<string, unknown>
      let design = typeof page.design === 'number' || /^\d+$/.test(String(page.design ?? '')) ? `${lookId}.${page.design}` : String(page.design ?? '')
      if (design === 'plain') design = `${lookId}.plain`
      if (!design) throw new ToolError(`Page ${i + 1} needs a design: a design id from glance_templates, like ${board.designs[0]?.id ?? `${lookId}.1`}, or plain`)
      ops.push({ op: 'addSection', design, texts: page.texts as Record<string, unknown> | undefined, tables: page.tables as Record<string, unknown> | undefined, blocks: (await importPictures(page.blocks, add)) as unknown[] | undefined })
    }
  } else if (pagesArg !== undefined) throw new ToolError('pages must be a list of {design, texts?, tables?, blocks?}')
  if (blocks !== undefined) {
    if (!Array.isArray(blocks)) throw new ToolError('blocks must be a list of blocks')
    ops.push({ op: 'addSection', design: board.flow, blocks: (await importPictures(blocks, add)) as unknown[] })
  }
  const { applyDocOps } = await import('../core/doc/ops')
  try {
    return applyDocOps({ version: 1, look: lookId, sections: [] }, ops, looks).doc
  } catch (e) {
    if (e instanceof DocError) throw new ToolError(e.message.replace(/^Operation (\d+) \(addSection\)/, 'Page $1'))
    throw e
  }
}

const createDocument = async (args: Record<string, unknown>): Promise<ToolResult> => {
  let out: string | null = null
  if (args.output_path !== undefined) {
    out = String(args.output_path)
    if (extension(out) !== 'gdoc') throw new ToolError('output_path must end in .gdoc for a document')
    checkOutput(out, [], (await platform.fileStamp(out)) !== null, args.overwrite === true, platform.pathPolicy)
  }
  const media = new Map<string, Uint8Array>()
  const add = (name: string, bytes: Uint8Array) => {
    let path = `media/${name.replace(/[^\w .()-]/g, '').replace(/^[^\w]+/, '') || 'picture.png'}`
    for (let n = 2; media.has(path); n++) path = path.replace(/( \(\d+\))?(\.\w+)$/, ` (${n})$2`)
    media.set(path, bytes)
    return path
  }
  let doc: Doc
  let lost: string[] = []
  if (args.from !== undefined) {
    // A Word file as a Glance document.
    const from = checkInput(args.from)
    if (extension(from) !== 'docx') throw new ToolError('from must be a .docx file')
    const lookId = String(args.template ?? args.look ?? 'essay')
    const board = await loadLookWithFonts(lookId)
    if (!board) throw new ToolError(`no template ${lookId}`)
    const { importDocx } = await import('../core/doc/importDocx')
    const r = await importDocx(await platform.readFile(from), lookId, board.flow)
    doc = r.doc
    for (const [p, b] of r.media) media.set(p, b)
    lost = r.lost
  } else doc = await startDoc(args, add)
  const firstText = doc.sections.flatMap((s) => [...Object.values(s.texts), ...(s.blocks ?? []).filter((b) => b.type === 'heading').map((b) => (b.type === 'heading' ? b.runs.map((r) => r.text).join('') : ''))]).find((x) => x.trim())
  const name = (typeof args.title === 'string' && args.title.trim()) || firstText || 'Document'
  await platform.showForAi()
  const g = newGdoc(name.replace(/[\\/:*?"<>|\n]/g, '').slice(0, 80), doc, media)
  await readAspects(g)
  if (out) {
    const bytes = await gdocBytes(g)
    await platform.writeFile(out, bytes)
    g.path.value = out
    g.name.value = platform.baseName(out)
    void platform.claimFile(out)
    await versions.rememberStamp(g)
    await versions.afterWrite(out, msg('Created by AI'), bytes)
  } else g.dirty.value = true
  activeId.value = g.id
  const board = findLook(doc.look)
  const pages = pagesOf(g).length
  toast(t('{count, plural, one {AI made a document of # page.} other {AI made a document of # pages.}}', { count: pages }))
  return json({
    ...docOutline(g),
    findings: checkDoc(doc, board, measureDocText),
    ...(lost.length ? { left_out: lost } : {}),
    ...(out ? {} : { note: 'The document is open in Glance and not saved yet; the user can save it, or pass output_path next time.' })
  })
}

const create: ToolHandler = async (args) => {
  if (args.kind === 'document') return createDocument(args)
  return deckHandlers.glance_create(args)
}

const templates: ToolHandler = async (args) => {
  const kind = args.kind
  const one = args.template !== undefined && args.template !== '' ? String(args.template) : null
  const docInfos = DOC_BOARDS.filter((b) => !one || b.id === one)
  const wantDocs = kind === undefined || kind === 'document'
  const wantDecks = kind === undefined || kind === 'deck'
  let decks: unknown[] = []
  if (wantDecks && !(one && docInfos.length)) {
    try {
      const r = (await deckHandlers.glance_templates({ ...(one ? { template: one } : {}) })) as ToolResult
      decks = ((r.structuredContent as { templates?: unknown[] })?.templates ?? []).map((x) => ({ kind: 'deck', ...(x as object) }))
    } catch (e) {
      if (!(one && wantDocs)) throw e
    }
  }
  const documents = wantDocs ? (await Promise.all(docInfos.map(async (info) => {
    const board = await loadLook(info.id)
    return board ? [lookCatalog(board, info)] : []
  }))).flat() : []
  if (one && !decks.length && !documents.length) throw new ToolError(`no template ${one}`)
  const list = [...decks, ...documents]
  return { content: [{ type: 'text', text: JSON.stringify({ templates: list }) }], structuredContent: { templates: list } }
}

const exportTool: ToolHandler = async (args) => {
  const d = tabOf(args.tab)
  if (!(d instanceof GDoc)) return deckHandlers.glance_export(args)
  const out = String(args.output_path)
  const want = String(args.format)
  if (!['pdf', 'docx', 'png'].includes(want)) throw new ToolError('A document exports as pdf, docx or png')
  if (extension(out) !== want) throw new ToolError(`output_path must end in .${want}`)
  checkOutput(out, d.path.peek() ? [d.path.peek()!] : [], (await platform.fileStamp(out)) !== null, args.overwrite === true, platform.pathPolicy)
  if (want === 'png') {
    const n = await gdocPictures(d, out)
    return `Wrote ${n} PNG ${n === 1 ? 'picture' : 'pictures'} next to ${out}`
  }
  await platform.writeFile(out, await gdocExportBytes(d, want as 'pdf' | 'docx'))
  return `Wrote ${out}`
}

/** Replaces text in a Word file, writing a new file: the original is never changed. */
const wordReplace: ToolHandler = async ({ path, find, replace, output_path, overwrite }) => {
  const from = checkInput(path)
  if (extension(from) !== 'docx') throw new ToolError('path must be a .docx file')
  if (typeof find !== 'string' || !find) throw new ToolError('find must be the text to look for')
  if (typeof replace !== 'string') throw new ToolError('replace must be text (empty to delete)')
  const out = String(output_path)
  if (extension(out) !== 'docx') throw new ToolError('output_path must end in .docx')
  checkOutput(out, [from], (await platform.fileStamp(out)) !== null, overwrite === true, platform.pathPolicy)
  const { replaceInDocx } = await import('../core/doc/importDocx')
  const r = await replaceInDocx(await platform.readFile(from), find, replace)
  if (!r.count) throw new ToolError(`"${find}" wasn't found in ${from} (text split across formatting changes can't be matched; try a shorter piece)`)
  await platform.writeFile(out, r.bytes)
  return json({ output_path: out, replaced: r.count })
}

/** What the person has picked in the document on screen, for the AI request guide. */
export function gdocSelection(g: unknown = activeDoc.value): { kind: 'document'; tab: string; page: number; section?: string; block?: string; box?: string; text?: string } | null {
  if (!(g instanceof GDoc)) return null
  const sel = g.selection.peek()
  const doc = g.doc.peek()
  const block = sel?.block ? [...allBlocks(doc)].find((x) => x.block.id === sel.block)?.block : undefined
  const section = doc.sections.find((s) => s.id === sel?.section)
  const text = block ? JSON.stringify(blockOutline(block)) : sel?.box ? section?.texts[sel.box] : undefined
  return { kind: 'document', tab: g.id, page: g.current.peek() + 1, ...(sel ?? {}), ...(text ? { text } : {}) }
}

// Guided AI requests about an open document get its template, pages and what is picked.
registerGuideContext((doc) => {
  const sel = gdocSelection(doc)
  if (!sel || !(doc instanceof GDoc)) return null
  const data = doc.doc.peek()
  const info = DOC_BOARDS.find((b) => b.id === data.look)
  const design = findDocDesign(findLook(data.look), data.sections.find((x) => x.id === sel.section)?.design ?? '')
  const maxChars = sel.box ? design?.texts.find((x) => x.name === sel.box)?.maxChars : undefined
  const picked = sel.block ? { id: sel.block, type: 'block', text: sel.text ?? '' } : sel.box ? { id: sel.box, type: 'text box', text: sel.text ?? '', ...(maxChars ? { maxChars } : {}) } : null
  const path = doc.path.peek()
  const text = data.sections.flatMap((x) => [...Object.values(x.texts), ...[...(x.blocks ?? [])].map(blockText)]).join('\n')
  return {
    kind: 'document',
    tab: doc.id,
    name: doc.name.peek(),
    ...(path && !path.startsWith('browser:') ? { path } : {}),
    ...(info ? { template: { id: info.id, name: info.name, look: data.look } } : { look: data.look }),
    count: doc.pageCount.peek(),
    selection: { kind: 'document', page: sel.page, blocks: picked ? [picked] : [] },
    placeholders: findPlaceholders(text)
  }
})

export const docHandlers: Record<string, ToolHandler> = {
  glance_templates: templates,
  glance_create: create,
  glance_export: exportTool,
  glance_doc_outline: outline,
  glance_doc_edit: edit,
  glance_doc_check: check,
  glance_doc_render: render,
  glance_word_replace: wordReplace
}
