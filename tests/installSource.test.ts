import { describe, expect, it } from 'vitest'
import { installSource } from '../src/core/installSource'

describe('install source', () => {
  it('counts the Windows installer, .deb and .rpm as GitHub', () => {
    expect(installSource(false, false)).toBe('GitHub')
  })

  it('counts a Flatpak as Flatpak', () => {
    expect(installSource(false, true)).toBe('Flatpak')
  })

  it('lets the Microsoft Store package win over every other signal', () => {
    expect(installSource(true, false)).toBe('Microsoft Store')
    expect(installSource(true, true)).toBe('Microsoft Store')
  })
})
