/**
 * Typing on a slide: the text a box shows, and the operation that puts edited text back.
 * Lists are one entry per line, so editing a bullet list feels like editing text.
 */
import { type Item, type Slide, type SlotSpec } from './model'
import { noDesigns, slotSpecsOf, type DesignLookup } from './design'
import type { DeckOp } from './ops'
import type { SlotRef } from './layout'

/** The ref for a box's `data-ref` (see refKey in html.ts). */
export function parseRefKey(key: string): SlotRef {
  const [slot, a, b] = key.split('.')
  const ref: SlotRef = { slot }
  if (a !== undefined) ref.index = Number(a)
  if (b === 'heading' || b === 'body') ref.part = b
  else if (b !== undefined) ref.col = Number(b)
  return ref
}

const specOf = (slide: Slide, slot: string, designs: DesignLookup): SlotSpec | undefined => slotSpecsOf(slide, designs).find((s) => s.name === slot)

/** What the editor starts with for this box. */
export function slotText(slide: Slide, ref: SlotRef): string {
  const v = slide.slots[ref.slot]
  if (!v) return ''
  switch (v.kind) {
    case 'text':
      return v.value
    case 'list':
      return v.value.join('\n')
    case 'items':
      return v.value[ref.index ?? 0]?.[ref.part ?? 'heading'] ?? ''
    case 'table':
      return v.value[ref.index ?? 0]?.[ref.col ?? 0] ?? ''
    case 'image':
      return v.value.alt
  }
}

/** The operations that store `text` in the box, or none when nothing changed. */
export function editOps(slide: Slide, ref: SlotRef, text: string, designs: DesignLookup = noDesigns): DeckOp[] {
  const spec = specOf(slide, ref.slot, designs)
  if (!spec || slotText(slide, ref) === text) return []
  const id = slide.id
  const v = slide.slots[ref.slot]
  switch (spec.kind) {
    case 'text':
      return text.trim() ? [{ op: 'setSlot', id, slot: ref.slot, value: text }] : [{ op: 'clearSlot', id, slot: ref.slot }]
    case 'list': {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      return lines.length ? [{ op: 'setSlot', id, slot: ref.slot, value: lines }] : [{ op: 'clearSlot', id, slot: ref.slot }]
    }
    case 'items': {
      const items: Item[] = v?.kind === 'items' ? v.value.map((it) => ({ ...it })) : []
      const i = ref.index ?? 0
      while (items.length <= i) items.push({ heading: '', body: '' })
      items[i][ref.part ?? 'heading'] = text
      // Trailing cards left empty are dropped, so clearing the last card removes it.
      while (items.length && !items.at(-1)!.heading.trim() && !items.at(-1)!.body.trim()) items.pop()
      return items.length ? [{ op: 'setSlot', id, slot: ref.slot, value: items }] : [{ op: 'clearSlot', id, slot: ref.slot }]
    }
    case 'table': {
      const rows: string[][] = v?.kind === 'table' ? v.value.map((r) => [...r]) : []
      const r = ref.index ?? 0
      const c = ref.col ?? 0
      while (rows.length <= r) rows.push([])
      while (rows[r].length <= c) rows[r].push('')
      rows[r][c] = text
      return [{ op: 'setSlot', id, slot: ref.slot, value: rows }]
    }
    case 'image':
      return v?.kind === 'image' ? [{ op: 'setSlot', id, slot: ref.slot, value: { ...v.value, alt: text } }] : []
  }
}
