/**
 * The deck tools AI apps use (definitions in core/mcp/tools.json): create a deck, read
 * it, change it with deck operations, check its design and look at its slides. Changes
 * go through DeckDoc.apply, so each tool call is one step the user can undo.
 * Messages here are read by the AI app, not shown in Glance's UI, so they're English.
 */
import { ToolError, type Content, type ToolHandler, type ToolResult } from '../core/mcp/protocol'
import { checkInput, checkOutput, extension, parsePages, toBase64 } from '../core/mcp/helpers'
import { samePath } from '../core/paths'
import { checkDeck } from '../core/deck/check'
import { placeholderSpots } from '../core/ai/deckContext'
import { emptyDeck, isLayout, isMediaPath, slideIdMaker, type Deck } from '../core/deck/model'
import { DESIGN_ID, slotSpecsOf, type Board } from '../core/deck/design'
import { checkOneTemplate, createSlideOps, templateCatalog } from '../core/deck/template'
import { BOARDS } from '../deck/designs'
import { findDesign, loadAllBoards, loadBoard, loadDesigns } from './designs'
import { applyOps, DeckError, type DeckOp } from '../core/deck/ops'
import { THEMES } from '../core/deck/themes'
import * as platform from '../platform'
import { activeDoc, activeId, DeckDoc, docs } from './documents'
import { deckBytes, exportBytes, exportPictures, newDeck } from './deck'
import * as versions from './versions'
import { toast } from './ui'
import { msg, t } from '../i18n'

const PICTURES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']
const MAX_RENDER = 12

function json(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value }
}

function findDeck(tab: unknown): DeckDoc {
  const d = tab === undefined || tab === null || tab === '' ? activeDoc.value : docs.value.find((x) => x.id === tab || (x.path.peek() && samePath(x.path.peek()!, String(tab), platform.pathPolicy)))
  if (!d) throw new ToolError(tab ? `No open tab "${String(tab)}". glance_list_open lists the tabs; open a .gdeck with glance_open.` : 'No deck is open in Glance. Create one with glance_create, or open a .gdeck with glance_open.')
  if (!(d instanceof DeckDoc)) throw new ToolError(`${d.name.peek()} is not a deck. Create one with glance_create.`)
  return d
}

function opsOf(value: unknown): DeckOp[] {
  if (!Array.isArray(value) || !value.every((op) => op && typeof op === 'object' && typeof op.op === 'string')) throw new ToolError('ops must be a list of operations like {"op": "add", "layout": "bullets"}')
  return value as DeckOp[]
}

/**
 * Copies pictures the AI names by local path into the deck's media, rewriting each src to
 * its media/ path. Runs before the ops are applied, so a bad path fails the whole call.
 */
async function importPictures(ops: DeckOp[], layoutOf: (op: DeckOp) => { layout: string; design?: string } | undefined, add: (name: string, bytes: Uint8Array) => string): Promise<DeckOp[]> {
  const copied = new Map<string, string>()
  const pictureOf = async (value: unknown): Promise<unknown> => {
    const v = value as { src?: unknown }
    if (!v || typeof v !== 'object' || typeof v.src !== 'string' || isMediaPath(v.src)) return value
    const path = checkInput(v.src)
    if (!PICTURES.includes(extension(path))) throw new ToolError(`${path}: decks take PNG, JPEG, WebP, GIF, AVIF or SVG pictures. Convert it first with glance_convert.`)
    if (!copied.has(path)) {
      if ((await platform.fileStamp(path)) === null) throw new ToolError(`${path} doesn't exist`)
      copied.set(path, add(platform.baseName(path), await platform.readFile(path)))
    }
    return { ...v, src: copied.get(path) }
  }
  const out: DeckOp[] = []
  for (const op of ops) {
    const shape = layoutOf(op)
    const specs = shape && isLayout(shape.layout) ? slotSpecsOf({ layout: shape.layout, design: shape.design }, findDesign) : []
    const isPicture = (slot: string) => specs.some((s) => s.name === slot && s.kind === 'image')
    if (op.op === 'add' && op.slots) {
      const slots: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(op.slots)) slots[name] = isPicture(name) ? await pictureOf(value) : value
      out.push({ ...op, slots })
    } else if (op.op === 'setSlot' && isPicture(op.slot)) out.push({ ...op, value: await pictureOf(op.value) })
    else out.push(op)
  }
  return out
}

/** The layout (or design) each op's slots belong to: its own for add, the slide's for setSlot. */
const layoutFinder = (deck: Deck) => (op: DeckOp): { layout: string; design?: string } | undefined => {
  if (op.op === 'add') return op.design ? { layout: 'design', design: op.design } : op.layout ? { layout: op.layout } : undefined
  if (op.op === 'setSlot') return deck.slides.find((s) => s.id === op.id) as { layout: string; design?: string } | undefined
  return undefined
}

/** Loads the template boards the ops name designs from, so they can be checked. */
async function loadOpDesigns(ops: DeckOp[]): Promise<void> {
  const ids = ops.flatMap((op) => ('design' in op && typeof op.design === 'string' && DESIGN_ID.test(op.design) ? [op.design] : []))
  await loadDesigns(ids)
}

const templates: ToolHandler = async ({ template }) => {
  const boards = template !== undefined && template !== '' ? [await loadBoard(String(template))] : await loadAllBoards()
  if (!boards[0]) throw new ToolError(`no template ${String(template)}; templates are ${BOARDS.map((b) => b.id).join(', ')}`)
  const list = boards.flatMap((b) => {
    const info = b && BOARDS.find((x) => x.id === b.id)
    return b && info ? [templateCatalog(b, info)] : []
  })
  // Compact: the full list is long, and an AI app reads it as data.
  return { content: [{ type: 'text', text: JSON.stringify({ templates: list }) }], structuredContent: { templates: list } }
}

/** The slides glance_create asks for, with the designs they name loaded and checked. */
async function createOps(template: unknown, slides: unknown): Promise<DeckOp[]> {
  let board: Board | undefined
  if (template !== undefined && template !== null && template !== '') {
    board = await loadBoard(String(template))
    if (!board) throw new ToolError(`no template ${String(template)}; glance_templates lists them (${BOARDS.map((b) => b.id).join(', ')})`)
  }
  try {
    const ops = createSlideOps(board, slides)
    await loadOpDesigns(ops)
    checkOneTemplate(ops, board)
    return ops
  } catch (e) {
    if (e instanceof DeckError) throw new ToolError(e.message)
    throw e
  }
}

function outline(doc: DeckDoc) {
  const deck = doc.deck.peek()
  return {
    tab: doc.id,
    name: doc.name.peek(),
    path: doc.path.peek(),
    theme: deck.theme,
    current_slide: doc.current.peek() + 1,
    unsaved_changes: doc.dirty.peek(),
    slides: deck.slides.map((s, i) => ({
      id: s.id,
      number: i + 1,
      layout: s.layout,
      ...(s.design ? { design: s.design } : {}),
      slots: Object.fromEntries(Object.entries(s.slots).map(([k, v]) => [k, v.value])),
      ...(s.notes ? { notes: s.notes } : {}),
      ...(s.hidden ? { hidden: true } : {})
    }))
  }
}

const create: ToolHandler = async ({ kind, title, theme, template, slides, output_path, overwrite }) => {
  if (kind !== 'deck') throw new ToolError('kind must be "deck"')
  if (theme !== undefined && !Object.hasOwn(THEMES, String(theme))) throw new ToolError(`theme must be one of ${Object.keys(THEMES).join(', ')}`)
  let out: string | null = null
  if (output_path !== undefined) {
    out = String(output_path)
    if (extension(out) !== 'gdeck') throw new ToolError('output_path must end in .gdeck')
    checkOutput(out, [], (await platform.fileStamp(out)) !== null, overwrite === true, platform.pathPolicy)
  }
  const ops = await createOps(template, slides)
  // Pictures go into a scratch map first: the deck tab only appears once everything is valid.
  const media = new Map<string, Uint8Array>()
  const add = (name: string, bytes: Uint8Array) => {
    let path = `media/${name.replace(/[^\w .()-]/g, '').replace(/^[^\w]+/, '') || 'picture.png'}`
    for (let n = 2; media.has(path); n++) path = path.replace(/( \(\d+\))?(\.\w+)$/, ` (${n})$2`)
    media.set(path, bytes)
    return path
  }
  const start = emptyDeck(theme ? String(theme) : undefined)
  let deck: Deck
  try {
    deck = applyOps(start, await importPictures(ops, layoutFinder(start), add), slideIdMaker(start), findDesign).deck
  } catch (e) {
    if (e instanceof DeckError) throw new ToolError(e.message.replace(/^Operation (\d+) \(add\)/, 'Slide $1'))
    throw e
  }
  const first = deck.slides[0]?.slots.title
  const name = (typeof title === 'string' && title.trim()) || (first?.kind === 'text' ? first.value : '') || 'Deck'
  await platform.showForAi()
  const doc = newDeck(name.replace(/[\\/:*?"<>|]/g, '').slice(0, 80))
  doc.deck.value = deck
  for (const [p, b] of media) doc.media.set(p, b)
  if (out) {
    const bytes = await deckBytes(doc)
    await platform.writeFile(out, bytes)
    doc.path.value = out
    doc.name.value = platform.baseName(out)
    void platform.claimFile(out)
    await versions.rememberStamp(doc)
    await versions.afterWrite(out, msg('Created by AI'), bytes)
  } else doc.dirty.value = true
  activeId.value = doc.id
  toast(t('{count, plural, one {AI made a deck with # slide.} other {AI made a deck with # slides.}}', { count: deck.slides.length }))
  return json({
    tab: doc.id,
    path: out,
    slides: deck.slides.map((s, i) => ({ id: s.id, number: i + 1, layout: s.layout, ...(s.design ? { design: s.design } : {}) })),
    findings: checkDeck(deck, findDesign),
    ...(out ? {} : { note: 'The deck is open in Glance and not saved yet; the user can save it, or pass output_path next time.' })
  })
}

const read: ToolHandler = async ({ tab }) => json(outline(findDeck(tab)))

const edit: ToolHandler = async ({ tab, ops }) => {
  const doc = findDeck(tab)
  const asked = opsOf(ops)
  await loadOpDesigns(asked)
  const list = await importPictures(asked, layoutFinder(doc.deck.peek()), (name, bytes) => doc.addMedia(name, bytes))
  let r
  try {
    r = doc.apply(msg('AI Edit'), list)
  } catch (e) {
    if (e instanceof DeckError) throw new ToolError(e.message)
    throw e
  }
  if (r.added.length) doc.current.value = doc.deck.peek().slides.findIndex((s) => s.id === r.added.at(-1))
  await platform.showForAi()
  return json({
    added: r.added,
    ...(r.dropped.length ? { dropped: r.dropped } : {}),
    slide_count: r.deck.slides.length,
    findings: checkDeck(r.deck, findDesign)
  })
}

/** Placeholders like [date] the AI left for the person: listed, not findings, since only the person knows them. */
function placeholders(deck: Parameters<typeof placeholderSpots>[0]): Record<string, unknown> {
  const spots = placeholderSpots(deck)
  return spots.length ? { placeholders: spots, placeholders_note: 'Left for the user to fill; Glance highlights them. Fill one only if you know the fact.' } : {}
}

const check: ToolHandler = async ({ tab }) => {
  const deck = findDeck(tab).deck.peek()
  const findings = checkDeck(deck, findDesign)
  return json({ findings, passes: findings.length === 0, ...placeholders(deck) })
}

/** Slide numbers ("1-3,7") or ids ("s2,s5") to indexes. */
function pickSlides(doc: DeckDoc, spec: unknown): number[] {
  const slides = doc.deck.peek().slides
  if (spec === undefined || spec === '') return slides.length ? [doc.current.peek()] : []
  const s = String(spec).trim()
  if (/^[\d\s,-]+$/.test(s)) return parsePages(s, slides.length)
  return s.split(',').map((id) => {
    const i = slides.findIndex((x) => x.id === id.trim())
    if (i < 0) throw new ToolError(`no slide ${id.trim()}`)
    return i
  })
}

const render: ToolHandler = async ({ tab, slides, max_size }) => {
  const doc = findDeck(tab)
  const picked = pickSlides(doc, slides)
  if (!picked.length) throw new ToolError('The deck has no slides yet.')
  if (picked.length > MAX_RENDER) throw new ToolError(`Ask for at most ${MAX_RENDER} slides at a time.`)
  const width = Number(max_size ?? 960)
  const { slideCanvas } = await import('../deck/raster')
  const deck = doc.deck.peek()
  const content: Content[] = []
  for (const i of picked) {
    const slide = deck.slides[i]
    const c = await slideCanvas(deck, slide, doc.media, width)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) throw new ToolError(`couldn't draw slide ${i + 1}`)
    // i18n-ignore: read by the AI app, not shown in Glance
    content.push({ type: 'text', text: `Slide ${i + 1} (${slide.id}, ${slide.design ?? slide.layout}${slide.hidden ? ', hidden' : ''})` })
    content.push({ type: 'image', data: toBase64(new Uint8Array(await blob.arrayBuffer())), mimeType: 'image/png' })
  }
  return { content }
}

const exportTool: ToolHandler = async ({ tab, format, output_path, overwrite }) => {
  const doc = findDeck(tab)
  const out = String(output_path)
  const want = String(format)
  if (extension(out) !== want) throw new ToolError(`output_path must end in .${want}`)
  if (!doc.deck.peek().slides.some((s) => !s.hidden)) throw new ToolError('The deck has no slides to export.')
  checkOutput(out, doc.path.peek() ? [doc.path.peek()!] : [], (await platform.fileStamp(out)) !== null, overwrite === true, platform.pathPolicy)
  if (want === 'png') {
    const n = await exportPictures(doc, out)
    return `Wrote ${n} PNG ${n === 1 ? 'picture' : 'pictures'} next to ${out}`
  }
  await platform.writeFile(out, await exportBytes(doc, want as 'pdf' | 'pptx'))
  return `Wrote ${out}`
}

export const deckHandlers: Record<string, ToolHandler> = {
  glance_templates: templates,
  glance_create: create,
  glance_deck_outline: read,
  glance_deck_edit: edit,
  glance_deck_check: check,
  glance_deck_render: render,
  glance_export: exportTool
}
