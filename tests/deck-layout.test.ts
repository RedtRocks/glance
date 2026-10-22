import { describe, expect, it } from 'vitest'
import { emptyDeck, layoutIds } from '../src/core/deck/model'
import { applyOps } from '../src/core/deck/ops'
import { SLIDE_H, SLIDE_W, fitSize, layoutSlide, wrappedLines, type TextBox } from '../src/core/deck/layout'
import { escapeHtml, refKey, slideHtml } from '../src/core/deck/html'
import { THEMES, themeOf } from '../src/core/deck/themes'

const theme = THEMES.wollo
let n = 0
const slideOf = (layout: (typeof layoutIds)[number], slots: Record<string, unknown> = {}) =>
  applyOps(emptyDeck(), [{ op: 'add', layout, slots }], () => `s${++n}`).deck.slides[0]

const texts = (boxes: ReturnType<typeof layoutSlide>) => boxes.filter((b): b is TextBox => b.type === 'text' && !b.decor)

describe('wrappedLines and fitSize', () => {
  it('wraps at spaces and breaks words longer than a line', () => {
    expect(wrappedLines(['aaa bbb ccc'], 70, 20)).toBe(2) // 7 characters a line
    expect(wrappedLines(['abcdefghijklmnop'], 50, 20)).toBe(4) // 5 a line
    expect(wrappedLines(['one', 'two'], 1000, 20)).toBe(2)
  })

  it('shrinks text until it fits, but not below the minimum', () => {
    const long = ['word '.repeat(60)]
    const size = fitSize(long, 800, 300, 80, 20, 1.2)
    expect(size).toBeLessThan(80)
    expect(wrappedLines(long, 800, size) * size * 1.2).toBeLessThanOrEqual(300)
    expect(fitSize(['short'], 800, 300, 80, 20, 1.2)).toBe(80)
    expect(fitSize(['word '.repeat(5000)], 800, 300, 80, 20, 1.2)).toBe(20)
  })
})

describe('layoutSlide', () => {
  it('keeps every box of every layout on the slide, decoration aside', () => {
    for (const layout of layoutIds) {
      for (const b of layoutSlide(slideOf(layout), theme).filter((b) => b.type === 'image' || !b.decor)) {
        expect(b.x, `${layout} x`).toBeGreaterThanOrEqual(0)
        expect(b.y, `${layout} y`).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w, `${layout} right`).toBeLessThanOrEqual(SLIDE_W)
        expect(b.y + b.h, `${layout} bottom`).toBeLessThanOrEqual(SLIDE_H)
      }
    }
  })

  it('marks empty slots as placeholders and fills the others', () => {
    const boxes = texts(layoutSlide(slideOf('title', { title: 'Bake Sale' }), theme))
    expect(boxes.map((b) => [b.ref.slot, b.placeholder])).toEqual([['title', false], ['subtitle', true]])
  })

  it('makes room for a picture on a title slide', () => {
    const plain = layoutSlide(slideOf('title', { title: 'T' }), theme)
    const pic = layoutSlide(slideOf('title', { title: 'T', image: { src: 'media/a.jpg', alt: 'A' } }), theme)
    expect(plain.some((b) => b.type === 'image')).toBe(false)
    expect(texts(pic)[0].w).toBeLessThan(texts(plain)[0].w)
  })

  it('gives each card its heading and body with a ref back to the slot', () => {
    const boxes = texts(layoutSlide(slideOf('threeCards', { title: 'Ways', items: [{ heading: 'Bake', body: 'Cakes' }, { heading: 'Bring', body: 'Friends' }, { heading: 'Buy', body: 'Treats' }] }), theme))
    expect(boxes.slice(1).map((b) => `${refKey(b.ref)}=${b.paragraphs[0]}`)).toEqual([
      'items.0.heading=Bake', 'items.0.body=Cakes', 'items.1.heading=Bring', 'items.1.body=Friends', 'items.2.heading=Buy', 'items.2.body=Treats'
    ])
  })

  it('shrinks a long title rather than letting it overflow', () => {
    const short = texts(layoutSlide(slideOf('bullets', { title: 'Hi', bullets: ['a'] }), theme))[0]
    const long = texts(layoutSlide(slideOf('bullets', { title: 'A much longer title that runs across the slide twice over', bullets: ['a'] }), theme))[0]
    expect(long.size).toBeLessThan(short.size)
  })
})

describe('decoration', () => {
  it('blocks colour in the theme\'s pops, and varies the look from slide to slide', () => {
    for (const t of Object.values(THEMES)) expect(t.pops.length, t.id).toBeGreaterThanOrEqual(3)
    const fills = (id: string) => layoutSlide({ ...slideOf('title', { title: 'T' }), id }, theme).filter((b) => b.type === 'rect' && b.decor).map((b) => (b.type === 'rect' ? `${b.x},${b.y}` : ''))
    const looks = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => fills(id).join(' ')))
    expect(looks.size).toBeGreaterThan(1)
  })

  it('keeps decoration out of the editor: no slot refs on it', () => {
    const html = slideHtml(slideOf('threeCards', { title: 'T' }), theme, { resolveSrc: () => null })
    expect(html).toContain('>01<')
    expect(html).not.toContain('data-ref=""')
  })
})

describe('slideHtml', () => {
  it('escapes text, alt text and picture paths', () => {
    const slide = slideOf('imageLeft', { title: '<b>Hi</b> & "you"', image: { src: 'media/x.jpg', alt: '<img onerror=1>' } })
    const html = slideHtml(slide, theme, { resolveSrc: (src) => `blob:"${src}"` })
    expect(html).toContain('&lt;b&gt;Hi&lt;/b&gt; &amp; &quot;you&quot;')
    expect(html).toContain('alt="&lt;img onerror=1&gt;"')
    expect(html).toContain('src="blob:&quot;media/x.jpg&quot;"')
    expect(html).not.toContain('<b>')
  })

  it('shows hints for empty slots only when asked, and no picture it cannot find', () => {
    const slide = slideOf('imageRight', { title: 'T', image: { src: 'media/gone.jpg', alt: 'Gone' } })
    const edit = slideHtml(slide, theme, { resolveSrc: () => null, placeholder: (ref) => `Add ${ref.slot}` })
    expect(edit).toContain('Add body')
    expect(edit).toContain('Add image')
    expect(edit).not.toContain('<img')
    const exported = slideHtml(slide, theme, { resolveSrc: () => null })
    expect(exported).not.toContain('Add ')
  })

  it('escapes the characters HTML cares about', () => {
    expect(escapeHtml(`<a href='x'>&</a>`)).toBe('&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;')
  })

  it('falls back to Wollo for a theme it does not know', () => {
    expect(themeOf('neon').id).toBe('wollo')
    expect(themeOf('wolloDark').id).toBe('wolloDark')
    expect(themeOf('constructor').id).toBe('wollo')
  })
})
