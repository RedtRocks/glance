import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEV_IDENTITY, extensions, msixManifest, msixVersion, parseSha256Sums, readTauriConf, wingetManifests } from '../scripts/packaging'

const conf = readTauriConf()
const SUMS = `39bbe6cca8d1848b22af6af8e75852562487abefeb079b5d9a0dd7083faac0fe  Glance-v0.3.0-windows-arm64-setup.exe
752637be8ba228166d49ff1a1735b7fc0abade161e9b2b9879105c1c1935e175  Glance-v0.3.0-windows-x64-setup.exe
`

describe('winget manifests', () => {
  it('reproduces the committed v0.3.0 manifests', () => {
    const dir = 'packaging/winget/manifests/r/RedtRocks/Glance/0.3.0'
    // Descriptions and file types follow tauri.conf.json, which moves on after a
    // release; the installer URLs and hashes are what must stay exact.
    const files = wingetManifests({ ...conf, version: '0.3.0' }, 'v0.3.0', parseSha256Sums(SUMS), '2026-09-26')
    expect(Object.keys(files).sort()).toEqual(readdirSync(dir).sort())
    const installer = readFileSync(`${dir}/RedtRocks.Glance.installer.yaml`, 'utf8')
    expect(installer).toContain('InstallerSha256: 752637BE8BA228166D49FF1A1735B7FC0ABADE161E9B2B9879105C1C1935E175')
    expect(installer).toContain('InstallerUrl: https://github.com/RedtRocks/glance/releases/download/v0.3.0/Glance-v0.3.0-windows-arm64-setup.exe')
  })

  it('fails without a checksum for every installer', () => {
    expect(() => wingetManifests(conf, 'v9.9.9', parseSha256Sums(SUMS), '2026-01-01')).toThrow(/no SHA-256/)
  })

  it('lists every file type once', () => {
    const exts = extensions(conf)
    expect(new Set(exts).size).toBe(exts.length)
    expect(exts).toContain('pdf')
    expect(exts).toContain('heic')
  })
})

describe('MSIX manifest', () => {
  it('uses a Store-compatible version', () => {
    expect(msixVersion('0.3.0')).toBe('0.3.0.0')
    expect(msixVersion('1.2')).toBe('1.2.0.0')
    expect(msixVersion('2.0.1-beta.1')).toBe('2.0.1.0')
  })

  it('associates every file type with unique names', () => {
    const xml = msixManifest(conf, 'arm64', DEV_IDENTITY)
    expect(xml).toContain('ProcessorArchitecture="arm64"')
    for (const ext of extensions(conf)) expect(xml).toContain(`<uap:FileType>.${ext}</uap:FileType>`)
    const names = [...xml.matchAll(/FileTypeAssociation Name="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z0-9][a-z0-9.-]*$/)
  })

  it('escapes the identity', () => {
    const xml = msixManifest(conf, 'x64', { name: 'A.B', publisher: 'CN=A & "B"', publisherDisplayName: '<C>' })
    expect(xml).toContain('Publisher="CN=A &amp; &quot;B&quot;"')
    expect(xml).toContain('<PublisherDisplayName>&lt;C&gt;</PublisherDisplayName>')
  })
})
