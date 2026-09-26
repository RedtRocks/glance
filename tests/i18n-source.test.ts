import { describe, expect, it } from 'vitest'
import { catalogCodes, readCatalog, scan } from '../scripts/i18n.mjs'
import { placeholders } from '../src/i18n/format'

const { messages, dynamic, hardcoded } = scan()
const places = (list: { file: string; line: number; text: string }[]) => list.map((p) => `${p.file}:${p.line}  ${p.text}`)

describe('UI text goes through t()', () => {
  // New UI text: wrap it in t('…') from src/i18n (see README → Contributing → Translations).
  it('has no hardcoded English', () => {
    expect(places(hardcoded)).toEqual([])
  })

  // t() and msg() need a plain string so `npm run i18n` can extract it; use {placeholders}.
  it('passes plain strings to t() and msg()', () => {
    expect(places(dynamic)).toEqual([])
  })
})

describe.each(catalogCodes())('catalog %s', (code) => {
  const catalog = readCatalog(code)
  it('keeps each message’s placeholders', () => {
    const wrong = Object.entries(catalog).filter(([en, tr]) => tr && placeholders(en).join() !== placeholders(tr).join())
    expect(wrong).toEqual([])
  })
  it('has no messages the app no longer uses (run npm run i18n -- ' + code + ')', () => {
    expect(Object.keys(catalog).filter((m) => !messages.has(m))).toEqual([])
  })
})
