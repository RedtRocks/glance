import { describe, expect, it } from 'vitest'
import { buildLines, buildParagraphs, findSpans, genericOf, paragraphGap, parseFontName, pickFamily, planInsert, planReplace, wrapText, type Measurer, type Run, type RunStyle } from '../src/core/textLayout'

const body: RunStyle = { family: 'Arial', bold: false, italic: false, size: 10, ascent: 0.9, descent: 0.2 }
const heading: RunStyle = { ...body, bold: true, size: 14 }
/** Every character is half the size wide. */
const measure: Measurer = (text, style) => text.length * style.size * 0.5

const run = (str: string, x: number, baseline: number, style = body): Run => ({ str, x, baseline, width: measure(str, style), style })

/** A heading, then two paragraphs of two lines each, 12 pt apart, 40 pt wide columns. */
function page() {
  const runs = [
    run('Terms', 72, 700, heading),
    run('The tenant pays rent', 72, 680),
    run('on the first day.', 72, 668),
    run('The landlord fixes', 72, 644),
    run('the roof.', 72, 632)
  ]
  return buildParagraphs(buildLines(runs))
}

describe('reading the page', () => {
  it('joins runs on one baseline and keeps columns apart', () => {
    const lines = buildLines([run('Hello', 72, 700), run('world', 72 + measure('Hello ', body), 700), run('Far away', 400, 700)])
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Far away'])
  })

  it('groups lines into paragraphs, with headings on their own', () => {
    const paras = page()
    expect(paras.map((p) => p.text)).toEqual(['Terms', 'The tenant pays rent on the first day.', 'The landlord fixes the roof.'])
    expect(paras[1].lineHeight).toBeCloseTo(1.2)
    expect(paras[0].style.bold).toBe(true)
  })

  it('finds text exactly, then loosely', () => {
    const paras = page()
    expect(findSpans(paras, 'first day')[0]).toMatchObject({ para: paras[1] })
    expect(findSpans(paras, 'THE ROOF')).toHaveLength(1)
    expect(findSpans(paras, 'not here')).toEqual([])
  })

  it('measures the usual gap between paragraphs', () => {
    const paras = page()
    const gap = paragraphGap(paras)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(2 * body.size)
  })
})

describe('planning edits', () => {
  it('wraps at the width and keeps line breaks', () => {
    expect(wrapText('aa bb cc', measure('aa bb', body), body, measure)).toEqual(['aa bb', 'cc'])
    expect(wrapText('one\ntwo', 1000, body, measure)).toEqual(['one', 'two'])
  })

  it('replaces a word on its line in the same style', () => {
    const paras = page()
    const [span] = findSpans(paras, 'tenant')
    const plan = planReplace(span, 'renter', measure)
    expect(plan.box.text).toContain('renter')
    expect(plan.box.style).toMatchObject({ family: 'Arial', size: 10, bold: false })
    expect(plan.extraLines).toBe(0)
  })

  it('reflows a paragraph when the new text is longer', () => {
    const paras = page()
    const [span] = findSpans(paras, 'on the first day.')
    const plan = planReplace(span, 'on the first working day of every month, by bank transfer.', measure)
    expect(plan.reflowed).toBe(true)
    expect(plan.extraLines).toBeGreaterThan(0)
  })

  it('inserts body text under a heading in the body style', () => {
    const paras = page()
    const plan = planInsert(paras[0], 'after', 'New clause.', paragraphGap(paras), measure, {}, paras[1])
    expect(plan.style.size).toBe(10)
    expect(plan.style.bold).toBe(false)
    expect(plan.rect[3]).toBeLessThan(paras[0].bottom)
    expect(plan.rect[0]).toBeLessThanOrEqual(paras[0].left)
  })
})

describe('fonts', () => {
  it('reads family, weight and slant from PDF font names', () => {
    expect(parseFontName('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toEqual({ family: 'Times New Roman', bold: true, italic: true })
    expect(parseFontName('Helvetica-Bold')).toEqual({ family: 'Arial', bold: true, italic: false })
    expect(parseFontName('Calibri')).toEqual({ family: 'Calibri', bold: false, italic: false })
  })

  it('picks an installed font of the same kind', () => {
    expect(pickFamily('Calibri', ['Arial', 'Calibri'])).toBe('Calibri')
    expect(pickFamily('Garamond Premier', ['Arial', 'Times New Roman'], genericOf('Garamond Premier'))).toBe('Times New Roman')
    expect(genericOf('Courier New')).toBe('monospace')
  })
})
