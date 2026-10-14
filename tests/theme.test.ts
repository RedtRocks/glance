import { describe, expect, it } from 'vitest'
import { contrast, mix, parseHex, readableAccent, textOn, themeVars } from '../src/core/theme'

describe('colour maths', () => {
  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('6312f6')).toEqual([99, 18, 246])
    expect(parseHex('violet')).toBeNull()
  })

  it('mixes two colours', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#6312f6', '#ffffff', 0)).toBe('#6312f6')
  })

  it('puts dark text on yellow and white text on violet', () => {
    expect(textOn('#f8d32c')).toBe('#0a0a0a')
    expect(textOn('#6312f6')).toBe('#ffffff')
  })

  it('lifts a dark accent until it stands out on a dark window', () => {
    const shown = readableAccent('#0a0a0a', '#0e0d12')
    expect(contrast(shown, '#0e0d12')).toBeGreaterThanOrEqual(3)
  })

  it('darkens a pale accent on a white window', () => {
    expect(contrast(readableAccent('#f8d32c', '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(3)
  })
})

describe('themeVars', () => {
  it('keeps the window untinted by default', () => {
    const v = themeVars({ accent: '#6312f6', tint: 'none', look: 'wollo', dark: false })
    expect(v['--accent']).toBe('#6312f6')
    expect(v['--bg-solid']).toBeUndefined()
  })

  it('tints the window surfaces, more for bold than soft', () => {
    const soft = themeVars({ accent: '#f258a8', tint: 'soft', look: 'wollo', dark: false })
    const bold = themeVars({ accent: '#f258a8', tint: 'bold', look: 'wollo', dark: false })
    expect(soft['--bg-solid']).not.toBe('#ffffff')
    expect(contrast(bold['--bg-solid'], '#ffffff')).toBeGreaterThan(contrast(soft['--bg-solid'], '#ffffff'))
  })

  it('falls back to violet for a broken saved colour', () => {
    expect(themeVars({ accent: 'nope', tint: 'none', look: 'fluent', dark: false })['--accent']).toBe('#6312f6')
  })
})
