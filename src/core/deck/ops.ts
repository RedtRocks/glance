/**
 * Every change to a deck is one of these operations, whoever makes it: an AI app through
 * glance_deck_edit, the Ask AI sidebar, or the person dragging a slide. A list of them is
 * applied all or nothing, so one AI turn is one undo step.
 */
import { LAYOUTS, isLayout, type Deck, type LayoutId, type Slide, type SlotKind, type SlotSpec, type SlotValue } from './model'

export type DeckOp =
  /** A new slide, at the end unless `after` names a slide (null puts it first). */
  | { op: 'add'; layout: LayoutId; slots?: Record<string, unknown>; notes?: string; after?: string | null }
  /** Moves slides, keeping their order, to just after `after` (null: to the start). */
  | { op: 'move'; ids: string[]; after: string | null }
  | { op: 'delete'; ids: string[] }
  | { op: 'duplicate'; id: string }
  | { op: 'hide'; ids: string[]; hidden: boolean }
  /** Keeps the slots the new layout also has; the others are reported as dropped. */
  | { op: 'setLayout'; id: string; layout: LayoutId }
  | { op: 'setSlot'; id: string; slot: string; value: unknown }
  | { op: 'clearSlot'; id: string; slot: string }
  | { op: 'setNotes'; id: string; notes: string }
  | { op: 'setTheme'; theme: string }
  /** Moves the second half of the slide's list onto a new slide after it, same layout and title. */
  | { op: 'split'; id: string }
  /** Appends the second slide's list to the first's and removes the second. Same layout only. */
  | { op: 'merge'; ids: [string, string] }

export class DeckError extends Error {}

export interface ApplyResult {
  deck: Deck
  /** Ids of the slides the operations made, in the order they were made. */
  added: string[]
  /** Content a layout change left out, so the caller can say so or put it elsewhere. */
  dropped: { id: string; slots: string[] }[]
}

/** Applies `ops` in order to a copy of `deck`. Throws DeckError, changing nothing, if any op is invalid. */
export function applyOps(deck: Deck, ops: DeckOp[], newId: () => string): ApplyResult {
  const next = structuredClone(deck)
  const added: string[] = []
  const dropped: ApplyResult['dropped'] = []
  const fresh = (): string => {
    let id = newId()
    while (next.slides.some((s) => s.id === id)) id = newId()
    added.push(id)
    return id
  }
  ops.forEach((op, i) => {
    try {
      apply(next, op, fresh, dropped)
    } catch (e) {
      if (e instanceof DeckError) throw new DeckError(`Operation ${i + 1} (${op.op}): ${e.message}`)
      throw e
    }
  })
  return { deck: next, added, dropped }
}

function apply(deck: Deck, op: DeckOp, fresh: () => string, dropped: ApplyResult['dropped']): void {
  const slides = deck.slides
  switch (op.op) {
    case 'add': {
      const slide: Slide = { id: fresh(), layout: layoutOf(op.layout), slots: {}, notes: op.notes ?? '', hidden: false }
      for (const [name, value] of Object.entries(op.slots ?? {})) slide.slots[name] = slotValue(slide.layout, name, value)
      slides.splice(op.after === undefined ? slides.length : op.after === null ? 0 : index(deck, op.after) + 1, 0, slide)
      return
    }
    case 'move': {
      const moving = unique(op.ids).map((id) => slides[index(deck, id)])
      if (op.after !== null && op.ids.includes(op.after)) throw new DeckError(`can't move ${op.after} after itself`)
      const rest = slides.filter((s) => !moving.includes(s))
      const at = op.after === null ? 0 : rest.findIndex((s) => s.id === op.after) + 1
      if (op.after !== null && at === 0) throw new DeckError(`no slide ${op.after}`)
      // Keep the moved slides in deck order, whatever order the ids came in.
      moving.sort((a, b) => slides.indexOf(a) - slides.indexOf(b))
      rest.splice(at, 0, ...moving)
      deck.slides = rest
      return
    }
    case 'delete': {
      const gone = new Set(unique(op.ids).map((id) => slides[index(deck, id)].id))
      deck.slides = slides.filter((s) => !gone.has(s.id))
      return
    }
    case 'duplicate': {
      const i = index(deck, op.id)
      slides.splice(i + 1, 0, { ...structuredClone(slides[i]), id: fresh() })
      return
    }
    case 'hide':
      for (const id of unique(op.ids)) slides[index(deck, id)].hidden = op.hidden
      return
    case 'setLayout': {
      const slide = slides[index(deck, op.id)]
      const layout = layoutOf(op.layout)
      const lost: string[] = []
      for (const [name, value] of Object.entries(slide.slots)) {
        const spec = specOf(layout, name)
        if (!spec || spec.kind !== value.kind) {
          lost.push(name)
          delete slide.slots[name]
        }
      }
      slide.layout = layout
      if (lost.length) dropped.push({ id: slide.id, slots: lost })
      return
    }
    case 'setSlot': {
      const slide = slides[index(deck, op.id)]
      slide.slots[op.slot] = slotValue(slide.layout, op.slot, op.value)
      return
    }
    case 'clearSlot': {
      const slide = slides[index(deck, op.id)]
      if (!specOf(slide.layout, op.slot)) throw new DeckError(`layout ${slide.layout} has no slot ${op.slot}`)
      delete slide.slots[op.slot]
      return
    }
    case 'setNotes':
      if (typeof op.notes !== 'string') throw new DeckError('notes must be text')
      slides[index(deck, op.id)].notes = op.notes
      return
    case 'setTheme':
      if (typeof op.theme !== 'string' || !op.theme) throw new DeckError('theme must be a theme id')
      deck.theme = op.theme
      return
    case 'split': {
      const i = index(deck, op.id)
      const slide = slides[i]
      const name = listSlot(slide)
      const value = slide.slots[name] as Extract<SlotValue, { kind: 'list' | 'items' }>
      if (value.value.length < 2) throw new DeckError(`${slide.id} has fewer than 2 entries in ${name}`)
      const half = Math.ceil(value.value.length / 2)
      const second = structuredClone(slide)
      second.id = fresh()
      ;(second.slots[name] as typeof value).value = value.value.slice(half) as never
      value.value = value.value.slice(0, half) as never
      slides.splice(i + 1, 0, second)
      return
    }
    case 'merge': {
      const [a, b] = op.ids.map((id) => slides[index(deck, id)])
      if (a === b) throw new DeckError('merge needs two different slides')
      if (a.layout !== b.layout) throw new DeckError(`${a.id} is ${a.layout} and ${b.id} is ${b.layout}; merge needs the same layout`)
      const name = listSlot(a)
      const into = a.slots[name] as Extract<SlotValue, { kind: 'list' | 'items' }>
      const from = b.slots[name] as typeof into | undefined
      if (from) into.value = [...into.value, ...from.value] as never
      deck.slides = slides.filter((s) => s !== b)
      return
    }
    default:
      throw new DeckError(`unknown operation ${(op as { op: unknown }).op}`)
  }
}

function index(deck: Deck, id: string): number {
  const i = deck.slides.findIndex((s) => s.id === id)
  if (i < 0) throw new DeckError(`no slide ${id}`)
  return i
}

function unique(ids: string[]): string[] {
  if (!Array.isArray(ids) || !ids.length) throw new DeckError('ids must list at least one slide')
  return [...new Set(ids)]
}

function layoutOf(id: string): LayoutId {
  if (!isLayout(id)) throw new DeckError(`no layout ${id}; layouts are ${Object.keys(LAYOUTS).join(', ')}`)
  return id
}

function specOf(layout: LayoutId, name: string): SlotSpec | undefined {
  return (LAYOUTS[layout] as SlotSpec[]).find((s) => s.name === name)
}

/** The slot split and merge work on: the layout's list or items slot that has content. */
function listSlot(slide: Slide): string {
  const spec = (LAYOUTS[slide.layout] as SlotSpec[]).find((s) => (s.kind === 'list' || s.kind === 'items') && slide.slots[s.name])
  if (!spec) throw new DeckError(`${slide.id} has no list to split or merge`)
  return spec.name
}

const isText = (v: unknown): v is string => typeof v === 'string'

/** Checks a value against the slot's kind, so a bad AI call fails with a reason instead of saving junk. */
function slotValue(layout: LayoutId, name: string, value: unknown): SlotValue {
  const spec = specOf(layout, name)
  if (!spec) throw new DeckError(`layout ${layout} has no slot ${name}; it has ${(LAYOUTS[layout] as SlotSpec[]).map((s) => s.name).join(', ')}`)
  const bad = (shape: string) => new DeckError(`slot ${name} takes ${shape}`)
  const kind: SlotKind = spec.kind
  switch (kind) {
    case 'text':
      if (!isText(value)) throw bad('text')
      return { kind, value }
    case 'list':
      if (!Array.isArray(value) || !value.every(isText)) throw bad('a list of text')
      return { kind, value: [...value] }
    case 'image': {
      const v = value as { src?: unknown; alt?: unknown; focus?: { x?: unknown; y?: unknown } }
      if (!v || !isText(v.src) || !v.src) throw bad('an image: { src, alt }')
      const focus = v.focus && typeof v.focus.x === 'number' && typeof v.focus.y === 'number'
        ? { x: clamp01(v.focus.x), y: clamp01(v.focus.y) }
        : undefined
      return { kind, value: { src: v.src, alt: isText(v.alt) ? v.alt : '', ...(focus ? { focus } : {}) } }
    }
    case 'items':
      if (!Array.isArray(value) || !value.every((it) => it && isText(it.heading) && isText(it.body ?? ''))) throw bad('a list of { heading, body }')
      return { kind, value: value.map((it) => ({ heading: it.heading, body: it.body ?? '' })) }
    case 'table':
      if (!Array.isArray(value) || !value.every((row) => Array.isArray(row) && row.every(isText))) throw bad('rows of text cells')
      return { kind, value: value.map((row: string[]) => [...row]) }
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
