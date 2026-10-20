import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateDeck } from '../src/state/templates'
import { findDesign, loadAllBoards } from '../src/state/designs'
import { BOARDS, BOARD_LOADERS } from '../src/deck/designs'
import { FONT_FILES } from '../src/deck/fonts'
import { checkDeck } from '../src/core/deck/check'
import { slideHtml } from '../src/core/deck/html'
import { themeOf } from '../src/core/deck/themes'
import { DESIGN_ID, PURPOSES, boardOf, slotSpecsOf } from '../src/core/deck/design'
import { boardDeck, templateCatalog } from '../src/core/deck/template'

describe('designed templates', () => {
  it('lists every board once, with a purpose, a look and a loader', () => {
    expect(TEMPLATES).toBe(BOARDS)
    expect(BOARDS.length).toBe(18)
    expect(new Set(BOARDS.map((b) => b.id)).size).toBe(BOARDS.length)
    for (const b of BOARDS) {
      expect(PURPOSES, b.id).toContain(b.purpose)
      expect(b.look.trim(), b.id).not.toBe('')
      expect(BOARD_LOADERS[b.id], b.id).toBeTypeOf('function')
    }
    expect(Object.keys(BOARD_LOADERS).sort()).toEqual(BOARDS.map((b) => b.id).sort())
  })

  it('builds six slides per template whose designs all resolve and pass the design check', async () => {
    for (const tpl of TEMPLATES) {
      const deck = (await templateDeck(tpl.id))!
      expect(deck, tpl.id).toBeTruthy()
      expect(deck.slides.length, tpl.id).toBe(tpl.slides)
      expect(deck.slides.length, tpl.id).toBe(6)
      for (const [i, s] of deck.slides.entries()) {
        expect(s.layout).toBe('design')
        expect(s.design).toBe(`${tpl.id}.${i + 1}`)
        const design = findDesign(s.design!)!
        expect(design, s.design).toBeTruthy()
        // Every text box is a slot holding the design's own sample.
        expect(Object.keys(s.slots).sort()).toEqual(design.texts.map((t) => t.name).sort())
        for (const t of design.texts) expect(s.slots[t.name]).toEqual({ kind: 'text', value: t.sample })
        expect(slotSpecsOf(s, findDesign).length).toBe(design.texts.length)
      }
      expect(checkDeck(deck, findDesign), tpl.id).toEqual([])
    }
    expect(await templateDeck('nope')).toBeNull()
  })

  it('keeps its art to what the app trusts: no scripts, handlers or anything from the web', async () => {
    const ids = new Set<string>()
    const svgIds = new Set<string>()
    for (const board of await loadAllBoards()) {
      const families = new Set(FONT_FILES.map((f) => f.family))
      for (const f of board.fonts) expect(families, `${board.id}: ${f.family}`).toContain(f.family)
      for (const d of board.designs) {
        expect(d.id).toMatch(DESIGN_ID)
        expect(boardOf(d.id)).toBe(board.id)
        expect(ids.has(d.id)).toBe(false)
        ids.add(d.id)
        expect(d.role.trim()).not.toBe('')
        for (const art of [d.art, d.over ?? '']) {
          expect(art).not.toMatch(/<script|\son\w+=|javascript:|<iframe|<object|<embed/i)
          // The only URLs are namespaces; nothing is fetched.
          expect(art.replace(/http:\/\/www\.w3\.org\/[\w/]+/g, '')).not.toMatch(/https?:|url\(\s*['"]?(?!#)/i)
          for (const [, id] of art.matchAll(/\sid="([^"]+)"/g)) {
            expect(svgIds.has(id), id).toBe(false)
            svgIds.add(id)
          }
        }
        expect(new Set(d.texts.map((t) => t.name)).size).toBe(d.texts.length)
        expect(d.texts.filter((t) => t.name === 'title').length).toBe(1)
        for (const t of d.texts) expect(t.sample.length, `${d.id} ${t.name}`).toBeLessThanOrEqual(t.maxChars)
      }
    }
  })

  it('draws a designed slide as its art and escaped text boxes', async () => {
    const [board] = await loadAllBoards()
    const deck = boardDeck(board)
    const slide = { ...deck.slides[0], slots: { ...deck.slides[0].slots, title: { kind: 'text' as const, value: '<img src=x onerror=alert(1)>' } } }
    const html = slideHtml(slide, themeOf(deck.theme), { resolveSrc: () => null, designs: findDesign })
    expect(html).toContain(`data-design="${board.designs[0].id}"`)
    expect(html).toContain(board.designs[0].art)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('data-ref="title"')
  })

  it('lists each template’s designs with what they are for and their slots, for AI apps', async () => {
    const [board] = await loadAllBoards()
    const info = BOARDS.find((b) => b.id === board.id)!
    const c = templateCatalog(board, info)
    expect(c).toMatchObject({ id: board.id, name: info.name, purpose: info.purpose, look: info.look })
    expect(c.designs.map((d) => d.id)).toEqual(board.designs.map((d) => d.id))
    expect(c.designs[0].for).toBe('Cover')
    const title = c.designs[0].slots.find((s) => s.name === 'title')!
    expect(title.hint).toBe(board.designs[0].texts.find((t) => t.name === 'title')!.sample)
    expect(title.maxChars).toBeGreaterThanOrEqual(title.hint!.length)
  })
})
