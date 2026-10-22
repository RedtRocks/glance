/**
 * Decks from designed templates: one slide per design, in the board's order, each slot
 * filled with the design's sample text (translated by the caller).
 */
import { emptyDeck, slideIdMaker, type Deck } from './model'
import { DeckError, applyOps, type DeckOp } from './ops'
import { boardOf, designSpecs, sampleSlots, type Board, type BoardInfo, type Design } from './design'

/** The ops that add these designs, with their samples or with no text at all. */
export function designOps(designs: Design[], translate: ((s: string) => string) | null): DeckOp[] {
  return designs.map((d) => ({ op: 'add', design: d.id, slots: translate ? sampleSlots(d, translate) : {} }))
}

/** A new deck holding every design of `board`, with its sample text. */
export function boardDeck(board: Board, translate: (s: string) => string = (s) => s): Deck {
  const start = emptyDeck()
  const lookup = (id: string) => board.designs.find((d) => d.id === id)
  return applyOps(start, designOps(board.designs, translate), slideIdMaker(start), lookup).deck
}

/** A template and its designs as glance_templates lists them: what each slide is for, and its slots. */
export function templateCatalog(board: Board, info: BoardInfo) {
  return {
    id: board.id,
    name: info.name,
    purpose: info.purpose,
    look: info.look,
    blurb: info.blurb,
    designs: board.designs.map((d) => ({
      id: d.id,
      for: d.role,
      slots: designSpecs(d).map((s) => ({ name: s.name, hint: s.hint, maxChars: s.maxChars }))
    }))
  }
}

/**
 * The slides glance_create asks for, as add ops. With a template, a slide may name its
 * design by number ("design": 3) as well as by id, and no slides means the template's own
 * slides with their sample text.
 */
export function createSlideOps(board: Board | undefined, slides: unknown): DeckOp[] {
  if (slides === undefined && board) return designOps(board.designs, (s) => s)
  if (!Array.isArray(slides)) throw new DeckError(board ? 'slides must be a list of {design, slots, notes?}, or left out to start from the template as it is' : 'slides must be a list of {layout, slots, notes?}')
  return slides.map((s: unknown) => {
    if (!s || typeof s !== 'object') throw new DeckError('each slide must be an object like {"layout": "bullets", "slots": {...}}')
    const slide = s as Record<string, unknown>
    const design = typeof slide.design === 'number' && board ? `${board.id}.${slide.design}` : slide.design
    return { ...slide, ...(design !== undefined ? { design } : {}), op: 'add' } as DeckOp
  })
}

/** A deck's designs all come from one template (its look); throws if these ops mix two. */
export function checkOneTemplate(ops: DeckOp[], board?: Board): void {
  const boards = new Set(ops.flatMap((op) => (op.op === 'add' && typeof op.design === 'string' ? [boardOf(op.design)] : [])))
  if (board) boards.add(board.id)
  if (boards.size > 1) throw new DeckError(`a deck's designs come from one template; these slides use ${[...boards].join(' and ')}`)
}
