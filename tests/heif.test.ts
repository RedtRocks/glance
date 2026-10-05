import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeHeif, encodeBmp } from '../src/platform/heif'

describe('HEIF in the browser version', () => {
  it('decodes the main picture', async () => {
    const { width, height, rgba } = await decodeHeif(new Uint8Array(readFileSync('tests/images/coffee.heic')))
    expect([width, height, rgba.length]).toEqual([48, 32, 48 * 32 * 4])
    expect(rgba[3]).toBe(255)
  })

  it('writes a top-down 32-bit BMP', () => {
    const bmp = encodeBmp(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]))
    const v = new DataView(bmp.buffer)
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM')
    expect([v.getUint32(2, true), v.getInt32(22, true), v.getUint16(28, true)]).toEqual([bmp.length, -1, 32])
    expect([...bmp.subarray(122)]).toEqual([0, 0, 255, 255, 255, 0, 0, 128])
  })
})
