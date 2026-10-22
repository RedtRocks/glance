/**
 * Documents from designed templates: the board's pages with their sample content
 * (translated by the caller), and what glance_templates tells AI apps about a look.
 */
import { DOC_VERSION, type Block, type Doc, type Run, type Section } from './model'
import { findDocDesign, type DocBoard, type DocBoardInfo, type DocDesign } from './look'
import { designSpecs } from '../deck/design'

type Tr = (s: string) => string

const trRuns = (runs: Run[], tr: Tr): Run[] => runs.map((r) => ({ ...r, text: /\p{L}{2}/u.test(r.text) ? tr(r.text) : r.text }))
const trCell = (s: string, tr: Tr) => (/\p{L}{2}/u.test(s) ? tr(s) : s)

export function translateBlocks(blocks: Block[], tr: Tr): Block[] {
  return blocks.map((b): Block => {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        return { ...b, runs: trRuns(b.runs, tr) }
      case 'quote':
        return { ...b, runs: trRuns(b.runs, tr), ...(b.cite ? { cite: tr(b.cite) } : {}) }
      case 'list':
        return { ...b, items: b.items.map((i) => trRuns(i, tr)) }
      case 'callout':
        return { ...b, blocks: translateBlocks(b.blocks, tr) }
      case 'columns':
        return { ...b, columns: b.columns.map((c) => translateBlocks(c, tr)) }
      case 'table':
        return { ...b, rows: b.rows.map((r) => r.map((c) => trCell(c, tr))) }
      case 'chart':
        return { ...b, rows: b.rows.map((r) => r.map((c) => trCell(c, tr))), ...(b.title ? { title: tr(b.title) } : {}) }
      default:
        return { ...b }
    }
  })
}

/** A section of `design` with its sample content. */
export function sampleSection(board: DocBoard, designId: string, tr: Tr = (s) => s): Section | null {
  const s = board.sample.find((x) => x.design === designId)
  if (!s) return null
  return {
    id: s.id,
    design: s.design,
    texts: Object.fromEntries(Object.entries(s.texts).map(([k, v]) => [k, v ? trCell(v, tr) : v])),
    tables: Object.fromEntries(Object.entries(s.tables).map(([k, rows]) => [k, rows.map((r) => r.map((c) => trCell(c, tr)))])),
    ...(s.blocks ? { blocks: translateBlocks(s.blocks, tr) } : {})
  }
}

/** A new document holding every page of `board` with its sample content. */
export function boardDoc(board: DocBoard, tr: Tr = (s) => s): Doc {
  return { version: DOC_VERSION, look: board.id, sections: board.designs.map((d) => sampleSection(board, d.id, tr)!).filter(Boolean) }
}

/** One page of a pack as its own document (a pack's pages are separate documents). */
export function pageDoc(board: DocBoard, designId: string, tr: Tr = (s) => s): Doc {
  const s = sampleSection(board, designId, tr)
  return { version: DOC_VERSION, look: board.id, sections: s ? [{ ...s, id: 'p1' }] : [] }
}

/** What a design holds, for AI apps: its text boxes and tables, and for flowing pages the styles. */
function designCatalog(d: DocDesign) {
  return {
    id: d.id,
    for: d.role,
    kind: d.flow ? 'flowing' : 'fixed',
    boxes: designSpecs({ texts: d.texts.filter((t) => !d.auto?.[t.name]) } as never).map((s) => ({ name: s.name, hint: s.hint, maxChars: s.maxChars })),
    ...(d.tables.length ? { tables: d.tables.map((t) => ({ name: t.name, columns: t.header ?? t.style.cols.map((_, i) => `column ${i + 1}`), ...(t.calc?.length ? { worked_out: t.calc.map((c) => c.col) } : {}) })) } : {}),
    ...(d.calcs ? { totals: Object.keys(d.calcs) } : {})
  }
}

/** A look and its designs as glance_templates lists them. */
export function lookCatalog(board: DocBoard, info: DocBoardInfo) {
  return {
    id: board.id,
    kind: 'document',
    name: info.name,
    purpose: info.purpose,
    look: info.look,
    blurb: info.blurb,
    pack: info.pack,
    designs: [...board.designs.map(designCatalog), { id: `${board.id}.plain`, for: 'Plain page in this look, for any flowing text', kind: 'flowing', boxes: [] }],
    flow_design: board.flow,
    styles: Object.fromEntries(Object.keys(board.styles).map((k) => [k, board.styleHints[k] ?? ''])),
    colours: board.palette
  }
}

export { findDocDesign }
