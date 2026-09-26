import { describe, expect, it } from 'vitest'
import { DEFAULT_BATCH, isNoop, metadataOnly, outputExt, outputSize, targetPath } from '../src/core/image/batch'

const o = (patch: Partial<typeof DEFAULT_BATCH>) => ({ ...DEFAULT_BATCH, ...patch })

describe('batch planning', () => {
  it('keeps writable formats and converts the rest to JPEG (photos) or PNG', () => {
    expect(outputExt('C:\\a\\x.PNG', 'keep')).toBe('png')
    expect(outputExt('x.heic', 'keep')).toBe('jpg')
    expect(outputExt('x.cr3', 'keep')).toBe('jpg')
    expect(outputExt('x.psd', 'keep')).toBe('png')
    expect(outputExt('x.png', 'jpg')).toBe('jpg')
  })

  it('names outputs with a suffix, or replaces only when the extension stays', () => {
    expect(targetPath('C:\\p\\cat.jpg', o({}))).toBe('C:\\p\\cat (edited).jpg')
    expect(targetPath('C:\\p\\cat.jpg', o({ output: 'replace' }))).toBe('C:\\p\\cat.jpg')
    expect(targetPath('C:\\p\\cat.heic', o({ output: 'replace' }))).toBe('C:\\p\\cat.jpg')
    expect(targetPath('/p/cat.png', o({ format: 'webp' }))).toBe('/p/cat (edited).webp')
  })

  it('computes sizes after rotation and resizing', () => {
    expect(outputSize(4000, 3000, o({ rotate: 90 }))).toEqual([3000, 4000])
    expect(outputSize(4000, 3000, o({ resize: { mode: 'fit', width: 1920, height: 1080 } }))).toEqual([1440, 1080])
    expect(outputSize(4000, 3000, o({ resize: { mode: 'percent', percent: 25 } }))).toEqual([1000, 750])
    expect(outputSize(100, 50, o({ resize: { mode: 'fit', width: 1920, height: 1080 } }))).toEqual([100, 50]) // never enlarges
  })

  it('removing location alone is lossless (no re-encode)', () => {
    expect(metadataOnly(o({ removeLocation: true }), 'a.jpg')).toBe(true)
    expect(metadataOnly(o({ removeLocation: true, rotate: 90 }), 'a.jpg')).toBe(false)
    expect(metadataOnly(o({ format: 'png' }), 'a.jpg')).toBe(false)
    expect(isNoop(o({ output: 'replace' }), 'a.jpg')).toBe(true)
  })
})
