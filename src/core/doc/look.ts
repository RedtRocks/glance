/**
 * A document's look: one designed template's pages (its designs) and the styles taken
 * from them, so a document on any topic can be made in any look. The art and styles are
 * trusted app assets generated from the template boards (src/doc/designs, by
 * scripts/build-doc-templates.mjs); a document only names a look, its designs and its
 * styles.
 *
 * Page units are CSS pixels on an A4 page, 595 by 842, which are also PDF points.
 */
import type { DesignText, FontUse, Purpose } from '../deck/design'
import type { Section } from './model'

export const PAGE_W = 595
export const PAGE_H = 842

/** How one kind of text looks. Spacing is in page units. */
export interface TextStyle {
  font: string
  size: number
  weight: number
  italic: boolean
  colour: string
  /** As a multiple of the size. */
  lineHeight: number
  letterSpacing: number
  transform?: 'uppercase' | 'lowercase' | 'capitalize'
  align: 'left' | 'center' | 'right'
  /** Space above and below; between two blocks the larger of the two counts, as CSS margins do. */
  before: number
  after: number
  /** First-line indent; negative for a hanging indent, with `padLeft` holding the rest in. */
  indent?: number
  padLeft?: number
  /** A bar down the left (a quote's or a heading's). */
  bar?: { w: number; colour: string; gap: number }
  /** A line under the text. */
  rule?: { w: number; colour: string; gap: number }
  /** A drawing before the text, like a heading's icon: one of the look's arts. */
  lead?: { art: string; w: number; h: number; gap: number }
  /** A line after the text to the column's edge, like "Bibliography ———". */
  trail?: { colour: string; h: number; gap: number }
  /** A tint behind the text. */
  bg?: { colour: string; radius: number; pad: [number, number, number, number] }
  /** A quote's opening mark, drawn above it. */
  mark?: { text: string; size: number; colour: string; font: string; h: number }
}

/** A box around blocks: a callout's tint and padding. */
export interface BoxStyle {
  bg?: string
  radius: number
  /** Top, right, bottom, left. */
  pad: [number, number, number, number]
  border?: { w: number; colour: string; dashed?: boolean }
  bar?: { w: number; colour: string }
  before: number
  after: number
  /** Space between the blocks inside. */
  gap: number
}

/** One column of a table. */
export interface ColSpec {
  /** A share of the table's width, or with a fixed table its width in page units. */
  w: number
  /** Where it starts, for fixed tables (page units from the table's left). */
  x?: number
  align: 'left' | 'center' | 'right'
  bold?: boolean
  colour?: string
  size?: number
  /** A cell's second line ("Supplied and fitted" under "Chain, 9-speed"). */
  sub?: { size: number; colour: string; weight: number; italic: boolean }
  /** A bar before the number, as long as the number's share of the column's largest. */
  bar?: string
  /** Text drawn as a coloured pill, by value ("High", "The Green"). */
  pills?: Record<string, { bg: string; colour: string }>
}

export interface TableStyle {
  text: TextStyle
  head?: { bg?: string; colour: string; size: number; weight: number; transform?: TextStyle['transform']; letterSpacing: number; h: number; line?: { w: number; colour: string }; radius: number }
  /** A row's height; rows with more lines grow. */
  rowH: number
  padX: number
  stripe?: string
  line?: { w: number; colour: string }
  /** Lines between columns. */
  colLine?: { w: number; colour: string }
  foot?: { weight: number; colour: string; line?: { w: number; colour: string } }
  cols: ColSpec[]
  before: number
  after: number
}

/** A table on a fixed page: where it sits, how tall it may grow and its own columns. */
export interface TableRegion {
  name: string
  x: number
  y: number
  w: number
  /** The room it has before what is drawn under it. */
  h: number
  header: string[] | null
  style: TableStyle
  /** Columns worked out from others, like an amount from quantity times price. */
  calc?: { col: number; mul: [number, number] }[]
}

/** A total on a fixed page worked out from a table or other boxes. */
export type BoxCalc =
  | { sum: { table: string; col: number } }
  | { mul: { box: string; factor: number } }
  | { add: string[] }

export interface DocDesign {
  id: string
  /** What the page is for, in the board's words ("Invoice", "Cover letter"). A message: show it through t(). */
  role: string
  bg: string
  /** Absolutely positioned HTML and SVG covering the page. Trusted: it comes from the app, never from a document. */
  art: string
  over?: string
  texts: DesignText[]
  tables: TableRegion[]
  calcs?: Record<string, BoxCalc>
  /** Boxes the page fills itself, like its page number. */
  auto?: Record<string, 'page'>
  /** Where a flowing section's blocks go on this page. `next` is the design pages after the first use. */
  flow?: { x: number; y: number; w: number; h: number; next?: string }
}

/** A look's charts: the series colours and how labels look. */
export interface ChartStyle {
  colours: string[]
  text: TextStyle
  grid: string
}

export interface DocBoard {
  id: string
  fonts: FontUse[]
  designs: DocDesign[]
  /** Text styles by name: body, h1 to h3, quote, cite, caption, list and the template's own (like signature). */
  styles: Record<string, TextStyle>
  /** What each style is for, from the template's sample, for AI apps and the style menu. */
  styleHints: Record<string, string>
  boxes: Record<string, BoxStyle>
  tables: Record<string, TableStyle>
  chart: ChartStyle
  /** Colours runs can name (Run.c). */
  palette: Record<string, string>
  /** Drawings art blocks name: trusted HTML, w by h page units. */
  arts: Record<string, { html: string; w: number; h: number }>
  /** The page plain sections use: the look's paper and margins. */
  plain: { bg: string; x: number; w: number; top: number; bottom: number }
  /** The design new flowing sections use, or `${id}.plain`. */
  flow: string
  /** The board as a document: its sections with the template's sample content. */
  sample: Section[]
}

/** What the start screen shows before a board is loaded. */
export interface DocBoardInfo {
  id: string
  name: string
  blurb: string
  purpose: Purpose
  look: string
  fonts: string[]
  pages: number
  /** One document of several pages, or a pack of one-page documents. */
  pack: boolean
}

export type LookLookup = (id: string) => DocBoard | undefined

export const noLooks: LookLookup = () => undefined

/** A design id: the look, a dot and the page number, or "plain". */
export const DOC_DESIGN_ID = /^[A-Za-z][\w-]{0,40}\.(\d{1,3}|plain)$/

export const lookOf = (designId: string) => designId.slice(0, designId.lastIndexOf('.'))

/** The plain page of a look, as a design: the paper, no art, a frame inside the margins. */
export function plainDesign(board: DocBoard): DocDesign {
  const p = board.plain
  return { id: `${board.id}.plain`, role: 'Plain page', bg: p.bg, art: '', texts: [], tables: [], flow: { x: p.x, y: p.top, w: p.w, h: PAGE_H - p.top - p.bottom } }
}

/** Finds a design of a loaded look, the plain page included. */
export function findDocDesign(board: DocBoard | undefined, id: string): DocDesign | undefined {
  if (!board) return undefined
  if (id === `${board.id}.plain`) return plainDesign(board)
  return board.designs.find((d) => d.id === id)
}
