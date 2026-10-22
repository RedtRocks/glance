/**
 * The design check (glance_deck_check): what an AI app has to fix before the person sees
 * the deck. Each finding names the slide and says what to do, in words a model can act on.
 */
import { type Deck, type Slide } from './model'
import { noDesigns, slotSpecsOf, type DesignLookup } from './design'

export type FindingCode = 'empty' | 'noTitleSlide' | 'missing' | 'overflow' | 'tooMany' | 'repeatLayout' | 'missingAlt' | 'unknownDesign'

export interface Finding {
  code: FindingCode
  /** The slide it is about; absent for the deck as a whole. */
  id?: string
  slot?: string
  detail: string
}

/** Three slides in a row with one layout reads as a wall; the third gets a finding. */
const REPEAT_RUN = 3

/** A template's first design is its cover, so it counts as a title slide. */
const isCover = (s: Slide) => s.layout === 'title' || (s.layout === 'design' && !!s.design?.endsWith('.1'))

/** What makes two slides look the same: the layout, or for designed slides the design. */
const lookOf = (s: Slide) => (s.layout === 'design' ? `design ${s.design}` : s.layout)

export function checkDeck(deck: Deck, designs: DesignLookup = noDesigns): Finding[] {
  const shown = deck.slides.filter((s) => !s.hidden)
  if (!shown.length) return [{ code: 'empty', detail: 'The deck has no slides. Add a title slide first.' }]
  const findings: Finding[] = []
  if (!isCover(shown[0])) {
    const detail = shown[0].layout === 'design'
      ? `Start with a cover: add the template's first design (${shown[0].design?.replace(/\.\d+$/, '.1')}) before this slide.`
      : 'Start with a title slide: add one with layout title before this slide.'
    findings.push({ code: 'noTitleSlide', id: shown[0].id, detail })
  }
  shown.forEach((slide, i) => {
    findings.push(...checkSlide(slide, designs))
    if (i >= REPEAT_RUN - 1 && shown.slice(i - REPEAT_RUN + 1, i + 1).every((s) => lookOf(s) === lookOf(slide))) {
      const detail = slide.layout === 'design'
        ? `${REPEAT_RUN} slides in a row use design ${slide.design}. Give this one another design from the same template.`
        : `${REPEAT_RUN} ${slide.layout} slides in a row. Give this one another layout, such as threeCards, bigNumber or imageRight.`
      findings.push({ code: 'repeatLayout', id: slide.id, detail })
    }
  })
  return findings
}

function checkSlide(slide: Slide, designs: DesignLookup): Finding[] {
  const out: Finding[] = []
  if (slide.layout === 'design' && !(slide.design && designs(slide.design))) {
    return [{ code: 'unknownDesign', id: slide.id, detail: `Design ${slide.design} doesn't exist. Pick one from glance_templates with setLayout.` }]
  }
  const needs = slide.layout === 'design' ? `design ${slide.design}` : `the ${slide.layout} layout`
  const short = slide.layout === 'design' ? `design ${slide.design}` : slide.layout
  for (const spec of slotSpecsOf(slide, designs)) {
    const value = slide.slots[spec.name]
    const at = { id: slide.id, slot: spec.name }
    if (!value) {
      if (spec.required) out.push({ ...at, code: 'missing', detail: `Fill ${spec.name}: ${needs} needs it.` })
      continue
    }
    const long = (text: string) => spec.maxChars !== undefined && text.length > spec.maxChars
    const tooLong = (what: string) => `${what} is too long for ${short}: keep it under ${spec.maxChars} characters, or split the slide.`
    switch (value.kind) {
      case 'text':
        if (!value.value.trim() && spec.required) out.push({ ...at, code: 'missing', detail: `Fill ${spec.name}: ${needs} needs it.` })
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
