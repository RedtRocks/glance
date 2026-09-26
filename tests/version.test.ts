import { describe, expect, it } from 'vitest'
import { isNewer } from '../src/core/version'

describe('update versions', () => {
  it('compares numerically, with or without the v', () => {
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('v0.2.0', '0.3.0')).toBe(false)
    expect(isNewer('1.0', '0.99.99')).toBe(true)
  })
  it('treats a release as newer than its pre-release, never the reverse', () => {
    expect(isNewer('0.3.0', '0.3.0-beta.1')).toBe(true)
    expect(isNewer('0.3.0-beta.1', '0.3.0')).toBe(false)
  })
  it('ignores tags that are not versions', () => {
    expect(isNewer('nightly', '0.2.0')).toBe(false)
  })
})
