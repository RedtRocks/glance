import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateDeck } from '../src/state/templates'
import { checkDeck } from '../src/core/deck/check'
import { THEMES } from '../src/core/deck/themes'

describe('deck templates', () => {
  it('each builds a deck in its own theme that passes the design check, pictures aside', () => {
    for (const tpl of TEMPLATES) {
      const deck = templateDeck(tpl.id)!
      expect(deck, tpl.id).toBeTruthy()
      expect(Object.hasOwn(THEMES, tpl.theme), tpl.id).toBe(true)
      expect(deck.theme).toBe(tpl.theme)
      expect(deck.slides[0].layout).toBe('title')
      expect(new Set(deck.slides.map((s) => s.id)).size).toBe(deck.slides.length)
      // Picture slots are left for the person (or the AI) to fill.
      expect(checkDeck(deck).filter((f) => !(f.code === 'missing' && f.slot === 'image')), tpl.id).toEqual([])
    }
  })

  it('has unique ids and no unknown template', () => {
    expect(new Set(TEMPLATES.map((x) => x.id)).size).toBe(TEMPLATES.length)
    expect(templateDeck('nope')).toBeNull()
  })
})
