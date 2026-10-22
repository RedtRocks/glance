import { describe, expect, it } from 'vitest'
import { beyondGlance, findHandOff, handOffFolderName, handOffPrompt, HAND_OFF_MARK, madeByName, prefilledUrl, resultFiles, siteHost, withoutHandOff } from '../src/core/ai/handOff'
import { guideEdit } from '../src/core/ai/guide'

describe('hand-off line', () => {
  const answer = `I made the 6 slides.\n${HAND_OFF_MARK} Add animated charts for revenue and costs\n`
  it('finds what is left to make', () => {
    expect(findHandOff(answer)).toBe('Add animated charts for revenue and costs')
    expect(findHandOff('All done.')).toBeNull()
    expect(findHandOff(`Done. ${HAND_OFF_MARK}`)).toBeNull()
  })
  it('hides the line from the person', () => {
    expect(withoutHandOff(answer)).toBe('I made the 6 slides.')
    expect(withoutHandOff('Plain')).toBe('Plain')
  })
  it('is asked for in every guided request', () => {
    const g = guideEdit('Add animated charts', { kind: 'deck', tab: 't1' })
    expect(g.text).toContain(HAND_OFF_MARK)
  })
})

describe('beyondGlance', () => {
  it('spots kinds of file Glance cannot make', () => {
    expect(beyondGlance('Make a short video of this deck')).toBe('video')
    expect(beyondGlance('turn this into a podcast')).toBe('audio')
    expect(beyondGlance('export it as an animated gif')).toBe('animated GIF')
    expect(beyondGlance('Convert this to an EPUB')).toBe('e-book')
    expect(beyondGlance('create an svg')).toBe('vector drawing')
  })
  it('leaves what Glance can make, and topics, alone', () => {
    expect(beyondGlance('Make a deck about our video strategy')).toBeNull()
    expect(beyondGlance('Summarize this')).toBeNull()
    expect(beyondGlance('Make a spreadsheet of podcast guests')).toBeNull()
  })
})

describe('handOffPrompt', () => {
  it('names the files, the folder and the rules', () => {
    const p = handOffPrompt('Add animated charts', [{ path: 'C:\\Users\\a\\Q3.pptx', made: true }], 'C:\\out')
    expect(p.startsWith('Add animated charts')).toBe(true)
    expect(p).toContain('- C:\\Users\\a\\Q3.pptx')
    expect(p).toContain('C:\\out')
    expect(p).toContain("don't change")
  })
})

describe('results', () => {
  it('picks finished files, newest first', () => {
    const f = (name: string, size: number, modified: number, path = `/o/${name}`) => ({ name, size, modified, path })
    const got = resultFiles([f('a.pptx', 10, 1), f('b.pptx', 10, 5), f('~$b.pptx', 1, 9), f('x.crdownload', 9, 9), f('empty.pdf', 0, 9), f('make.py', 9, 9), f('c.png', 3, 9, '/o/.work/c.png')])
    expect(got.map((x) => x.name)).toEqual(['b.pptx', 'a.pptx'])
  })
  it('names the result after the company', () => {
    expect(madeByName('Q3 Review.pptx', 'Claude')).toBe('Q3 Review (Claude).pptx')
    expect(madeByName('Claude deck.pptx', 'Claude')).toBe('Claude deck.pptx')
    expect(madeByName('notes', 'ChatGPT')).toBe('notes (ChatGPT)')
  })
  it('makes safe folder names', () => {
    expect(handOffFolderName(new Date(2026, 9, 2, 3, 4, 5), 'ab/c:d')).toBe('2026-10-02 03.04.05 abcd')
  })
})

describe('website prompts', () => {
  it('pre-fills sites that support it', () => {
    expect(prefilledUrl('https://claude.ai/', 'Make it shorter & clearer')).toBe('https://claude.ai/new?q=Make%20it%20shorter%20%26%20clearer')
    expect(prefilledUrl('https://chatgpt.com/', 'hi')).toBe('https://chatgpt.com/?q=hi')
    expect(prefilledUrl('https://gemini.google.com/', 'hi')).toBeNull()
    expect(prefilledUrl('https://claude.ai/', '  ')).toBeNull()
    expect(prefilledUrl(undefined, 'hi')).toBeNull()
  })
  it('reads a site host', () => {
    expect(siteHost('https://claude.ai/new')).toBe('claude.ai')
    expect(siteHost('file:///x')).toBe('')
    expect(siteHost('nonsense')).toBe('')
  })
})
