import { describe, expect, it } from 'vitest'
import { parsePageInput, showPageButtons, showPageNumberField } from '../src/core/pageControls'

describe('page controls are context aware', () => {
  it('hides everything for single-page documents and images', () => {
    expect(showPageButtons({ pageCount: 1, pageNumberThreshold: 2 })).toBe(false)
    expect(showPageNumberField({ pageCount: 1, pageNumberThreshold: 0 })).toBe(false)
  })
  it('shows only previous/next for a 2-page document by default', () => {
    expect(showPageButtons({ pageCount: 2, pageNumberThreshold: 2 })).toBe(true)
    expect(showPageNumberField({ pageCount: 2, pageNumberThreshold: 2 })).toBe(false)
  })
  it('adds the page number field for documents longer than the threshold', () => {
    expect(showPageNumberField({ pageCount: 3, pageNumberThreshold: 2 })).toBe(true)
    expect(showPageNumberField({ pageCount: 3, pageNumberThreshold: 10 })).toBe(false)
  })
  it('parses page input leniently and clamps', () => {
    expect(parsePageInput('5', 10)).toBe(4)
    expect(parsePageInput(' 12 / 40', 40)).toBe(11)
    expect(parsePageInput('999', 10)).toBe(9)
    expect(parsePageInput('0', 10)).toBe(0)
    expect(parsePageInput('abc', 10)).toBeNull()
  })
})
