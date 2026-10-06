import { describe, expect, it } from 'vitest'
import { isPageReloadKey, isPageZoomKey } from '../src/core/pageZoom'

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

describe('page reload keys', () => {
  it('catches F5 and Ctrl+R, which would throw away open documents', () => {
    expect(isPageReloadKey(key('F5', 'F5', {}))).toBe(true)
    expect(isPageReloadKey(key('F5', 'F5', { ctrlKey: true }))).toBe(true)
    expect(isPageReloadKey(key('r', 'KeyR'))).toBe(true)
    expect(isPageReloadKey(key('R', 'KeyR', { ctrlKey: true }))).toBe(true)
  })
  it('leaves other keys alone', () => {
    expect(isPageReloadKey(key('r', 'KeyR', {}))).toBe(false)
    expect(isPageReloadKey(key('F4', 'F4', {}))).toBe(false)
    expect(isPageReloadKey(key('r', 'KeyR', { ctrlKey: true, altKey: true }))).toBe(false)
  })
})
