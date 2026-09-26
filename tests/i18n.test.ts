import { describe, expect, it } from 'vitest'
import { format, pseudoMessage, resolveLocale } from '../src/i18n/format'

describe('format', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('Exported {file}', { file: 'a.pdf' }, 'en')).toBe('Exported a.pdf')
    expect(format('Exported {file}', undefined, 'en')).toBe('Exported {file}')
  })

  it('localizes numbers', () => {
    expect(format('{n} bytes', { n: 1234567 }, 'de')).toBe('1.234.567 bytes')
  })

  it('picks plural forms by the language’s rules', () => {
    const m = '{count, plural, one {# page} other {# pages}}'
    expect(format(m, { count: 1 }, 'en')).toBe('1 page')
    expect(format(m, { count: 3 }, 'en')).toBe('3 pages')
    const pl = '{n, plural, one {# strona} few {# strony} many {# stron} other {# strony}}'
    expect(format(pl, { n: 2 }, 'pl')).toBe('2 strony')
    expect(format(pl, { n: 5 }, 'pl')).toBe('5 stron')
  })

  it('prefers exact matches and nests placeholders inside branches', () => {
    const m = 'Delete {n, plural, =0 {nothing} one {one page of {file}} other {# pages of {file}}}?'
    expect(format(m, { n: 0, file: 'x' }, 'en')).toBe('Delete nothing?')
    expect(format(m, { n: 1, file: 'x' }, 'en')).toBe('Delete one page of x?')
    expect(format(m, { n: 12, file: 'x' }, 'en')).toBe('Delete 12 pages of x?')
  })
})

describe('pseudoMessage', () => {
  it('accents the text but not the values, and lengthens it', () => {
    const out = pseudoMessage('Open {file}', { file: 'report.pdf' })
    expect(out.startsWith('[Öþéñ report.pdf')).toBe(true)
    expect(out.endsWith('··]')).toBe(true)
  })
})

describe('resolveLocale', () => {
  const available = ['en', 'de', 'pt-BR', 'zh-Hans']
  it('matches exactly, then by base language, then any regional variant', () => {
    expect(resolveLocale(['de'], available)).toBe('de')
    expect(resolveLocale(['de-AT'], available)).toBe('de')
    expect(resolveLocale(['pt-PT'], available)).toBe('pt-BR')
    expect(resolveLocale(['PT-br'], available)).toBe('pt-BR')
  })
  it('walks the preference list and falls back to English', () => {
    expect(resolveLocale(['ja', 'de-CH'], available)).toBe('de')
    expect(resolveLocale(['ja'], available)).toBe('en')
    expect(resolveLocale([], available)).toBe('en')
  })
})
