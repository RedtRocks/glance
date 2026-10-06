import { describe, expect, it } from 'vitest'
import { feedbackUrl, systemName } from '../src/core/feedback'

describe('feedback link', () => {
  it('opens a new issue on the Glance repo with the text filled in', () => {
    const url = new URL(feedbackUrl({ kind: 'problem', message: 'Crash on open\nsecond line', about: 'Glance 1.0 on Windows 10.0' }))
    expect(url.origin + url.pathname).toBe('https://github.com/RedtRocks/glance/issues/new')
    expect(url.searchParams.get('title')).toBe('Problem: Crash on open')
    expect(url.searchParams.get('body')).toBe('Crash on open\nsecond line\n\n---\nGlance 1.0 on Windows 10.0')
  })
  it('leaves the version out when asked', () => {
    const url = new URL(feedbackUrl({ kind: 'idea', message: 'Dark mode', about: null }))
    expect(url.searchParams.get('body')).toBe('Dark mode')
  })
  it('shortens long titles and bodies', () => {
    const url = new URL(feedbackUrl({ kind: 'other', message: 'x'.repeat(10000), about: null }))
    expect(url.searchParams.get('title')!.length).toBeLessThan(90)
    expect(url.searchParams.get('body')!.length).toBeLessThan(6100)
  })
  it('names the system', () => {
    expect(systemName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows 10.0')
    expect(systemName('curl')).toBeNull()
  })
})
