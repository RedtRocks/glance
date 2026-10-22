import { describe, expect, it } from 'vitest'
import { deckPrompt, nameFromRequest, templatePrompt } from '../src/core/ai/make'

describe('making from a request', () => {
  it('names the file after the first words, safely', () => {
    expect(nameFromRequest('a birthday card for my dog Biscuit who is turning five', 'Deck')).toBe('A birthday card for my dog')
    expect(nameFromRequest('slides: Q3 / Q4 "results"', 'Deck')).toBe('Slides Q3 Q4 results')
    expect(nameFromRequest('   ', 'Deck')).toBe('Deck')
  })

  it('tells the AI which deck to fill and how to check it', () => {
    const p = deckPrompt('  a talk on bees ', 'doc7')
    expect(p).toContain('Make slides for me in Glance: a talk on bees')
    expect(p).toContain('tab doc7')
    for (const tool of ['glance_deck_edit', 'glance_deck_check', 'glance_deck_render']) expect(p).toContain(tool)
  })

  it('asks the AI to replace a template\'s sample text within each slot\'s maxChars', () => {
    const p = templatePrompt('our school fair', 'Event Plan', 'doc3')
    expect(p).toContain('from the Event Plan template: our school fair')
    expect(p).toContain('tab doc3')
    expect(p).toContain('maxChars')
    expect(p).toContain('glance_templates')
    expect(p).toContain('add with design')
    expect(p).toContain('glance_deck_outline')
  })
})
