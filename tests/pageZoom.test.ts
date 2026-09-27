import { describe, expect, it } from 'vitest'
import { isPageZoomKey } from '../src/core/pageZoom'

const key = (key: string, code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = { ctrlKey: true }) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods
})

describe('page zoom keys', () => {
  it('catches the keys that zoom the whole webview', () => {
    expect(isPageZoomKey(key('=', 'Equal'))).toBe(true)
    expect(isPageZoomKey(key('+', 'Equal'))).toBe(true)
    expect(isPageZoomKey(key('-', 'Minus'))).toBe(true)
    expect(isPageZoomKey(key('0', 'Digit0'))).toBe(true)
    expect(isPageZoomKey(key('+', 'NumpadAdd'))).toBe(true)
  })

  it('leaves other shortcuts alone', () => {
    expect(isPageZoomKey(key('=', 'Equal', {}))).toBe(false)
    expect(isPageZoomKey(key('9', 'Digit9'))).toBe(false)
    expect(isPageZoomKey(key('0', 'Digit0', { ctrlKey: true, altKey: true }))).toBe(false)
  })
})
