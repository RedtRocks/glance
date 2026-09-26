import { describe, expect, it } from 'vitest'
import { canRemoveLocation, combinedName, combineOrder } from '../src/core/explorer'

describe('Explorer verbs', () => {
  it('orders files the way Explorer sorts names', () => {
    expect(combineOrder(['C:\\s\\Scan 10.jpg', 'C:\\s\\scan 2.jpg', 'C:\\s\\Scan 1.pdf'])).toEqual([
      'C:\\s\\Scan 1.pdf',
      'C:\\s\\scan 2.jpg',
      'C:\\s\\Scan 10.jpg'
    ])
  })

  it('names the combined PDF after the first file', () => {
    expect(combinedName('C:\\s\\Scan 1.jpg')).toBe('Scan 1 (combined).pdf')
    expect(combinedName('C:\\s\\report.pdf')).toBe('report (combined).pdf')
  })

  it('knows which formats can lose their location', () => {
    expect(canRemoveLocation('a.JPG')).toBe(true)
    expect(canRemoveLocation('a.heic')).toBe(true)
    expect(canRemoveLocation('a.pdf')).toBe(false)
    expect(canRemoveLocation('a.gif')).toBe(false)
  })
})
