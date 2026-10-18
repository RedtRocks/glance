/**
 * Decks (ADR 0018): a deck is a theme and a list of slides; a slide is a layout with its
 * slots filled in. Agents and people say what goes in a slot, the layout and theme decide
 * how it looks, so nothing here holds a position, a font or a colour.
 *
 * Pure data, saved as deck.json inside a .gdeck file.
 */

export const DECK_VERSION = 1

export type SlotKind = 'text' | 'list' | 'image' | 'items' | 'table'

export interface ImageRef {
  /** A path inside the deck's media/ folder. */
  src: string
  alt: string
  /** Where the subject is, 0 to 1 from the top left, so crops keep it in view. */
  focus?: { x: number; y: number }
}

/** A short heading with a line under it: one card of a three-card row, a timeline step. */
export interface Item {
  heading: string
  body: string
}

export type SlotValue =
  | { kind: 'text'; value: string }
  | { kind: 'list'; value: string[] }
  | { kind: 'image'; value: ImageRef }
  | { kind: 'items'; value: Item[] }
  | { kind: 'table'; value: string[][] }

export interface Slide {
  /** Stable across edits, so "move s7 after s2" still means the same slides later. */
  id: string
  layout: LayoutId
  slots: Record<string, SlotValue>
  notes: string
  hidden: boolean
}

export interface Deck {
  version: number
  theme: string
  slides: Slide[]
}

export interface SlotSpec {
  name: string
  kind: SlotKind
  required: boolean
  /** Characters that fit before the text would have to shrink, for text slots and each list entry. */
  maxChars?: number
  /** Entries that fit, for list, items and table (rows) slots. */
  maxItems?: number
}

const slot = (name: string, kind: SlotKind, required: boolean, maxChars?: number, maxItems?: number): SlotSpec => ({ name, kind, required, maxChars, maxItems })

/** The layouts, in the order a layout picker shows them. */
export const LAYOUTS = {
  title: [slot('title', 'text', true, 60), slot('subtitle', 'text', false, 120), slot('image', 'image', false)],
  section: [slot('title', 'text', true, 50), slot('subtitle', 'text', false, 100)],
  bullets: [slot('title', 'text', true, 60), slot('bullets', 'list', true, 70, 6)],
  twoColumns: [slot('title', 'text', true, 60), slot('left', 'list', true, 60, 5), slot('right', 'list', true, 60, 5)],
  imageLeft: [slot('title', 'text', true, 60), slot('image', 'image', true), slot('body', 'text', false, 280)],
  imageRight: [slot('title', 'text', true, 60), slot('image', 'image', true), slot('body', 'text', false, 280)],
  fullImage: [slot('image', 'image', true), slot('caption', 'text', false, 90)],
  bigNumber: [slot('stat', 'text', true, 8), slot('statLabel', 'text', true, 60), slot('body', 'text', false, 160)],
  threeCards: [slot('title', 'text', true, 60), slot('items', 'items', true, 80, 3)],
  quote: [slot('quote', 'text', true, 220), slot('attribution', 'text', false, 60)],
  comparison: [slot('title', 'text', true, 60), slot('table', 'table', true, 40, 7)],
  timeline: [slot('title', 'text', true, 60), slot('items', 'items', true, 60, 6)]
} satisfies Record<string, SlotSpec[]>

export type LayoutId = keyof typeof LAYOUTS

export const layoutIds = Object.keys(LAYOUTS) as LayoutId[]

export const isLayout = (id: string): id is LayoutId => Object.hasOwn(LAYOUTS, id)

export function emptyDeck(theme = 'wollo'): Deck {
  return { version: DECK_VERSION, theme, slides: [] }
}
