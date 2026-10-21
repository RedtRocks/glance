/**
 * Documents (ADR 0018): a document is a look and a list of sections. A section is one of
 * the look's designed pages: a fixed page (a poster, a certificate, an invoice) with its
 * text boxes and tables filled in, or a flowing section (an essay, a letter, a report)
 * whose blocks flow across as many A4 pages as they need inside the page's frame. Agents
 * and people say what the text is; the look decides how it looks, so blocks hold no
 * positions, fonts or colours, only the names of the look's styles.
 *
 * Pure data, saved as document.json inside a .gdoc file.
 */

export const DOC_VERSION = 1

/** A run of text with the same marks. `c` names a colour of the look's palette. */
export interface Run {
  text: string
  b?: boolean
  i?: boolean
  u?: boolean
  href?: string
  c?: string
}

interface Base {
  /** Stable across edits, so "delete b7" still means the same block later. */
  id: string
}

export type Block =
  | (Base & { type: 'heading'; level: 1 | 2 | 3; runs: Run[]; style?: string })
  /** icon: one of the look's drawings before the text, like a card's symbol. */
  | (Base & { type: 'paragraph'; runs: Run[]; style?: string; icon?: string })
  | (Base & { type: 'list'; ordered: boolean; items: Run[][]; style?: string })
  | (Base & { type: 'quote'; runs: Run[]; cite?: string; style?: string })
  /** A tinted box around a few blocks: a tip, a "what went well", a key fact. */
  | (Base & { type: 'callout'; blocks: Block[]; style?: string })
  /** Rows of text cells; with `header` the first row heads the columns, with `footer` the last is a total. */
  | (Base & { type: 'table'; rows: string[][]; header: boolean; footer?: boolean; style?: string })
  /** A picture from the document's media/ folder; width is a share of the column, 1 when left out. */
  | (Base & { type: 'picture'; src: string; alt: string; caption?: string; width?: number })
  /** A chart drawn from its rows: the first row names the series, then one row per label. */
  | (Base & { type: 'chart'; chart: ChartKind; rows: string[][]; title?: string; caption?: string })
  /** One of the template's own drawings (a diagram, a map), by id; trusted app art, never from the file. */
  | (Base & { type: 'art'; art: string; caption?: string })
  | (Base & { type: 'divider'; style?: string })
  /** Two or three columns side by side, each its own blocks. widths are shares that add up to 1. */
  | (Base & { type: 'columns'; columns: Block[][]; widths?: number[]; style?: string })
  | (Base & { type: 'pageBreak' })

export type BlockType = Block['type']
export type ChartKind = 'bar' | 'line' | 'pie'

export const BLOCK_TYPES: BlockType[] = ['heading', 'paragraph', 'list', 'quote', 'callout', 'table', 'picture', 'chart', 'art', 'divider', 'columns', 'pageBreak']

export interface Section {
  /** Stable across edits, like "p3". */
  id: string
  /** The look's design this section is drawn from, like "essay.2", or "essay.plain" for a plain page. */
  design: string
  /** The design's text boxes, by name. */
  texts: Record<string, string>
  /** The design's tables (an invoice's items), by name: rows of text cells, the header row left out. */
  tables: Record<string, string[][]>
  /** A flowing section's blocks; absent on fixed pages. */
  blocks?: Block[]
}

export interface Doc {
  version: number
  /** The look: one template's designs and styles, like "essay". */
  look: string
  sections: Section[]
}

/** Pictures a document can name: media/ then a plain file name, no folders. */
const MEDIA_PATH = /^media\/\w[\w .()-]{0,120}\.(png|jpe?g|webp|gif|avif|svg)$/i
export const isMediaPath = (src: string) => MEDIA_PATH.test(src) && !src.includes('..')

export function emptyDoc(look: string): Doc {
  return { version: DOC_VERSION, look, sections: [] }
}

/** Every block of a document, columns' and callouts' blocks included, with the section it is in. */
export function* allBlocks(doc: Doc): Generator<{ block: Block; section: Section; parent: Block[] }> {
  for (const section of doc.sections) yield* walk(section.blocks ?? [], section)
}

function* walk(list: Block[], section: Section): Generator<{ block: Block; section: Section; parent: Block[] }> {
  for (const block of list) {
    yield { block, section, parent: list }
    if (block.type === 'columns') for (const col of block.columns) yield* walk(col, section)
    if (block.type === 'callout') yield* walk(block.blocks, section)
  }
}

/** Short ids for new blocks ("b7") and sections ("p3"), so AI apps can name them back easily. */
export function idMaker(doc: Doc): { block: () => string; section: () => string } {
  const num = (re: RegExp, ids: string[]) => Math.max(0, ...ids.map((id) => Number(re.exec(id)?.[1] ?? 0)))
  let b = num(/^b(\d+)$/, [...allBlocks(doc)].map((x) => x.block.id))
  let p = num(/^p(\d+)$/, doc.sections.map((s) => s.id))
  return { block: () => `b${++b}`, section: () => `p${++p}` }
}

/** The plain text of some runs. */
export const plain = (runs: Run[]): string => runs.map((r) => r.text).join('')

/** The text a block shows, for outlines, search and checks. */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return plain(block.runs)
    case 'quote':
      return plain(block.runs) + (block.cite ? `\n${block.cite}` : '')
    case 'list':
      return block.items.map(plain).join('\n')
    case 'callout':
      return block.blocks.map(blockText).join('\n')
    case 'columns':
      return block.columns.map((c) => c.map(blockText).join('\n')).join('\n')
    case 'table':
    case 'chart':
      return block.rows.map((r) => r.join('\t')).join('\n')
    case 'picture':
      return block.caption ?? block.alt
    case 'art':
      return block.caption ?? ''
    default:
      return ''
  }
}

/**
 * Runs from text with light marks, as people and AI apps type it: **bold**, *italic* and
 * [a link](https://…). Anything else is plain text.
 */
export function parseRuns(text: string): Run[] {
  const out: Run[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) })
    if (m[1] !== undefined) out.push({ text: m[1], b: true })
    else if (m[2] !== undefined) out.push({ text: m[2], i: true })
    else out.push({ text: m[3], href: m[4] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out.length ? out : [{ text: '' }]
}

/** Runs back to text with light marks (the reverse of parseRuns), for AI apps to read. */
export function runsToText(runs: Run[]): string {
  return runs.map((r) => {
    let s = r.text
    if (r.href) s = `[${s}](${r.href})`
    if (r.i) s = `*${s}*`
    if (r.b) s = `**${s}**`
    return s
  }).join('')
}

/** Joins neighbouring runs that look the same and drops empty ones (keeping at least one). */
export function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out.at(-1)
    if (last && !!last.b === !!r.b && !!last.i === !!r.i && !!last.u === !!r.u && last.href === r.href && last.c === r.c) last.text += r.text
    else out.push({ ...r })
  }
  return out.length ? out : [{ text: '' }]
}
