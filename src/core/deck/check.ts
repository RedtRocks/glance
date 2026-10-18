/**
 * The design check (glance_deck_check): what an AI app has to fix before the person sees
 * the deck. Each finding names the slide and says what to do, in words a model can act on.
 */
import { LAYOUTS, type Deck, type Slide, type SlotSpec } from './model'

export type FindingCode = 'empty' | 'noTitleSlide' | 'missing' | 'overflow' | 'tooMany' | 'repeatLayout' | 'missingAlt'

export interface Finding {
  code: FindingCode
  /** The slide it is about; absent for the deck as a whole. */
  id?: string
  slot?: string
  detail: string
}

/** Three slides in a row with one layout reads as a wall; the third gets a finding. */
const REPEAT_RUN = 3

export function checkDeck(deck: Deck): Finding[] {
  const shown = deck.slides.filter((s) => !s.hidden)
  if (!shown.length) return [{ code: 'empty', detail: 'The deck has no slides. Add a title slide first.' }]
  const findings: Finding[] = []
  if (shown[0].layout !== 'title') {
    findings.push({ code: 'noTitleSlide', id: shown[0].id, detail: 'Start with a title slide: add one with layout title before this slide.' })
  }
  shown.forEach((slide, i) => {
    findings.push(...checkSlide(slide))
    if (i >= REPEAT_RUN - 1 && shown.slice(i - REPEAT_RUN + 1, i + 1).every((s) => s.layout === slide.layout)) {
      findings.push({ code: 'repeatLayout', id: slide.id, detail: `${REPEAT_RUN} ${slide.layout} slides in a row. Give this one another layout, such as threeCards, bigNumber or imageRight.` })
    }
  })
  return findings
}

function checkSlide(slide: Slide): Finding[] {
  const out: Finding[] = []
  for (const spec of LAYOUTS[slide.layout] as SlotSpec[]) {
    const value = slide.slots[spec.name]
    const at = { id: slide.id, slot: spec.name }
    if (!value) {
      if (spec.required) out.push({ ...at, code: 'missing', detail: `Fill ${spec.name}: the ${slide.layout} layout needs it.` })
      continue
    }
    const long = (text: string) => spec.maxChars !== undefined && text.length > spec.maxChars
    const tooLong = (what: string) => `${what} is too long for ${slide.layout}: keep it under ${spec.maxChars} characters, or split the slide.`
    switch (value.kind) {
      case 'text':
        if (!value.value.trim() && spec.required) out.push({ ...at, code: 'missing', detail: `Fill ${spec.name}: the ${slide.layout} layout needs it.` })
        else if (long(value.value)) out.push({ ...at, code: 'overflow', detail: tooLong(spec.name) })
        break
      case 'list':
        value.value.forEach((entry, n) => {
          if (long(entry)) out.push({ ...at, code: 'overflow', detail: tooLong(`${spec.name} entry ${n + 1}`) })
        })
        break
      case 'items':
        value.value.forEach((item, n) => {
          if (long(item.heading + item.body)) out.push({ ...at, code: 'overflow', detail: tooLong(`${spec.name} entry ${n + 1}`) })
        })
        break
      case 'table':
        value.value.forEach((row, r) => row.forEach((cell, c) => {
          if (long(cell)) out.push({ ...at, code: 'overflow', detail: tooLong(`${spec.name} row ${r + 1}, column ${c + 1}`) })
        }))
        break
      case 'image':
        if (!value.value.alt.trim()) out.push({ ...at, code: 'missingAlt', detail: `Describe the picture in ${spec.name} (alt) for people who can't see it.` })
        break
    }
    if ((value.kind === 'list' || value.kind === 'items' || value.kind === 'table') && spec.maxItems !== undefined && value.value.length > spec.maxItems) {
      out.push({ ...at, code: 'tooMany', detail: `${spec.name} has ${value.value.length} entries; ${slide.layout} fits ${spec.maxItems}. Split the slide or cut entries.` })
    }
  }
  return out
}
