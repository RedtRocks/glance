import { describe, expect, it } from 'vitest'
import { nodesToLines, nodesToRuns, runsToHtml, splitRuns, joinRuns, sameRuns, trimRuns, type NodeLike } from '../src/core/doc/richText'

const text = (s: string): NodeLike => ({ nodeType: 3, nodeName: '#text', nodeValue: s, childNodes: [] })
const el = (name: string, kids: NodeLike[], attrs: Record<string, string> = {}, style: NodeLike['style'] = {}): NodeLike => ({
  nodeType: 1,
  nodeName: name,
  childNodes: kids,
  getAttribute: (n) => attrs[n] ?? null,
  style
})
const root = (...kids: NodeLike[]) => el('DIV', kids)

describe('typing with live bold and italic', () => {
  it('shows runs as HTML with their marks', () => {
    expect(runsToHtml([{ text: 'We took the ' }, { text: 'night train', b: true }, { text: ' & ' }, { text: 'so', i: true, u: true }])).toBe('We took the <b>night train</b> &amp; <i><u>so</u></i>')
    expect(runsToHtml([{ text: 'site', href: 'https://a.b/?x="1"' }])).toBe('<a href="https://a.b/?x=&quot;1&quot;">site</a>')
    expect(runsToHtml([{ text: 'a\nb' }])).toBe('a<br>b')
  })

  it('reads the marks back from what was typed', () => {
    const r = root(text('We took the '), el('B', [text('night '), el('I', [text('train')])]), text(' home'))
    expect(nodesToRuns(r)).toEqual([{ text: 'We took the ' }, { text: 'night ', b: true }, { text: 'train', b: true, i: true }, { text: ' home' }])
  })

  it('understands the styles the browser uses to take bold off', () => {
    const r = root(el('B', [text('one '), el('SPAN', [text('two')], {}, { fontWeight: 'normal' })]), el('SPAN', [text(' three')], {}, { fontStyle: 'italic' }))
    expect(nodesToRuns(r)).toEqual([{ text: 'one ', b: true }, { text: 'two' }, { text: ' three', i: true }])
  })

  it('keeps links and palette colours, and drops unsafe links', () => {
    const r = root(el('A', [text('ok')], { href: 'https://x.y' }), el('A', [text('bad')], { href: 'javascript:alert(1)' }), el('SPAN', [text('red')], { 'data-c': 'accent' }))
    expect(nodesToRuns(r)).toEqual([{ text: 'ok', href: 'https://x.y' }, { text: 'bad' }, { text: 'red', c: 'accent' }])
  })

  it('reads list lines from divs and line breaks', () => {
    const r = root(text('Milk'), el('DIV', [text('Eggs')]), el('DIV', [el('BR', [])]), el('DIV', [el('B', [text('Bread')])]))
    expect(nodesToLines(r).map((l) => l.map((x) => x.text).join(''))).toEqual(['Milk', 'Eggs', '', 'Bread'])
    expect(nodesToLines(root(text('one'), el('BR', []), text('two'), el('BR', [])))).toEqual([[{ text: 'one' }], [{ text: 'two' }]])
  })

  it('splits and joins runs where Enter and Backspace are pressed', () => {
    const runs = [{ text: 'night ' }, { text: 'train', b: true }]
    expect(splitRuns(runs, 8)).toEqual([[{ text: 'night ' }, { text: 'tr', b: true }], [{ text: 'ain', b: true }]])
    expect(splitRuns(runs, 0)).toEqual([[{ text: '' }], runs])
    expect(splitRuns(runs, 11)).toEqual([runs, [{ text: '' }]])
    expect(joinRuns([{ text: 'a', b: true }], [{ text: 'b', b: true }])).toEqual([{ text: 'ab', b: true }])
    expect(sameRuns([{ text: 'a' }, { text: 'b' }], [{ text: 'ab' }])).toBe(true)
    expect(sameRuns([{ text: 'ab', b: true }], [{ text: 'ab' }])).toBe(false)
    expect(trimRuns([{ text: 'end' }, { text: '\n' }])).toEqual([{ text: 'end' }])
  })
})
