import { describe, expect, it } from 'vitest'
import { captureSession, parseSession, type SessionSource } from '../src/core/session'

const tab = (over: Partial<SessionSource>): SessionSource => ({ kind: 'pdf', path: 'C:\\a.pdf', page: 0, zoom: 'fit-width', active: false, ...over })

describe('session capture', () => {
  it('keeps file-backed tabs in order with page, zoom and the active tab', () => {
    const s = captureSession([
      tab({ path: 'C:\\a.pdf', page: 3, zoom: 1.5 }),
      tab({ kind: 'image', path: 'C:\\b.png', zoom: 'fit', active: true })
    ], 'windows')
    expect(s).toEqual({
      tabs: [
        { path: 'C:\\a.pdf', page: 3, zoom: 1.5 },
        { path: 'C:\\b.png', page: 0, zoom: 'fit' }
      ],
      active: 1
    })
  })
  it('skips unsaved documents and notices, reopens converted files from the original', () => {
    const s = captureSession([
      tab({ path: null, active: true }),
      tab({ kind: 'notice', path: 'C:\\x.heic' }),
      tab({ path: null, convertedFrom: 'C:\\art.eps' })
    ], 'windows')
    expect(s.tabs.map((t) => t.path)).toEqual(['C:\\art.eps'])
    expect(s.active).toBe(0)
  })
  it('collapses the same path in different case', () => {
    const s = captureSession([tab({ path: 'C:\\A.pdf' }), tab({ path: 'c:\\a.PDF', active: true })], 'windows')
    expect(s.tabs).toHaveLength(1)
  })
})

describe('session parse', () => {
  it('round-trips a captured session', () => {
    const s = captureSession([tab({ page: 2, zoom: 'fit-page', active: true })], 'windows')
    expect(parseSession(JSON.stringify(s))).toEqual(s)
  })
  it('rejects garbage and drops malformed tabs', () => {
    expect(parseSession(null)).toBeNull()
    expect(parseSession('{')).toBeNull()
    expect(parseSession('{"tabs":[]}')).toBeNull()
    const s = parseSession('{"tabs":[{"path":""},{"path":"C:\\\\a.pdf","page":-4,"zoom":-1},7],"active":9}')
    expect(s).toEqual({ tabs: [{ path: 'C:\\a.pdf', page: 0, zoom: 'fit' }], active: 0 })
  })
})
