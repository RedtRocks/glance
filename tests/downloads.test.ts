import { describe, expect, it } from 'vitest'
import { countDownloads } from '../src/core/downloads'

describe('download counter', () => {
  it('adds up installers across releases, skipping drafts and checksums', () => {
    expect(
      countDownloads([
        { assets: [{ name: 'Glance_0.6.3_x64-setup.exe', download_count: 10 }, { name: 'SHA256SUMS.txt', download_count: 99 }] },
        { assets: [{ name: 'Glance_0.6.2_arm64-setup.exe', download_count: 5 }] },
        { draft: true, assets: [{ name: 'x.exe', download_count: 1000 }] },
        {}
      ])
    ).toBe(15)
  })
})
