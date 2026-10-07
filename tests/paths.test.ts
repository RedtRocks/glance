import { describe, expect, it } from 'vitest'
import { pathKey, samePath } from '../src/core/paths'
import { captureSession, type SessionSource } from '../src/core/session'

const tab = (path: string): SessionSource => ({ kind: 'pdf', path, page: 0, zoom: 'fit-width', active: false })

describe('path policy', () => {
  it('folds case and either separator on Windows', () => {
    expect(samePath('C:\\A\\b.pdf', 'c:/a/B.PDF', 'windows')).toBe(true)
    expect(pathKey('C:\\\\A//b.pdf/', 'windows')).toBe('c:/a/b.pdf')
  })

  it('preserves POSIX case and literal backslashes', () => {
    expect(samePath('/home/a.pdf', '/home/A.pdf', 'posix')).toBe(false)
    expect(pathKey('/home/a\\b.pdf', 'posix')).toBe('/home/a\\b.pdf')
    expect(samePath('/home/a\\b.pdf', '/home/a/b.pdf', 'posix')).toBe(false)
  })

  it('only collapses repeated POSIX slashes', () => {
    expect(pathKey('//home///a.pdf', 'posix')).toBe('/home/a.pdf')
    expect(samePath('/home//a.pdf', '/home/a.pdf', 'posix')).toBe(true)
    expect(samePath('/home/a.pdf', 'home/a.pdf', 'posix')).toBe(false)
    expect(pathKey('/home/a.pdf/', 'posix')).toBe('/home/a.pdf/')
  })

  it('deduplicates sessions using the supplied policy', () => {
    expect(captureSession([tab('C:\\A\\b.pdf'), tab('c:/a/B.PDF')], 'windows').tabs).toHaveLength(1)
    const paths = ['/home/a.pdf', '/home/A.pdf', '/home/a\\b.pdf', '/home/a/b.pdf']
    expect(captureSession(paths.map(tab), 'posix').tabs.map((t) => t.path)).toEqual(paths)
    expect(captureSession([tab('/home//a.pdf'), tab('/home/a.pdf')], 'posix').tabs).toHaveLength(1)
  })
})
