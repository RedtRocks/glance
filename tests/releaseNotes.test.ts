import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { releaseBody, versionNotes } from '../scripts/release-notes'

const changelog = `# Changelog

## New in 0.2.0

- **Two.** Second.

## New in 0.1.0

First.
`

const assets = (tag: string) => [
  `dist-release/Glance-${tag}-windows-x64-setup.exe`,
  `dist-release/Glance-${tag}-windows-arm64-setup.exe`,
  `dist-release/Glance-${tag}-linux-amd64.deb`,
  `dist-release/Glance-${tag}-linux-x86_64.rpm`,
  'dist-release/SHA256SUMS.txt'
]

describe('release notes', () => {
  it('takes one version from the changelog', () => {
    expect(versionNotes(changelog, '0.2.0')).toBe('- **Two.** Second.')
    expect(versionNotes(changelog, 'v0.1.0')).toBe('First.')
    expect(versionNotes(changelog.replace(/\n/g, '\r\n'), '0.1.0')).toBe('First.')
    expect(versionNotes(changelog, '0.3.0')).toBeNull()
  })

  it('shows only its own version, with links to the attached files', () => {
    const body = releaseBody(changelog, 'v0.2.0', assets('v0.2.0'))!
    expect(body).toContain('## New in 0.2.0\n\n- **Two.** Second.')
    expect(body).not.toContain('0.1.0')
    expect(body).toContain('(https://github.com/RedtRocks/glance/releases/download/v0.2.0/Glance-v0.2.0-windows-arm64-setup.exe)')
    expect(body).toContain('| **Fedora 42+** | [Download .rpm](https://github.com/RedtRocks/glance/releases/download/v0.2.0/Glance-v0.2.0-linux-x86_64.rpm) | – |')
    expect(body).toContain('blob/main/CHANGELOG.md')
    expect(body.indexOf('| **Windows')).toBeLessThan(body.indexOf('## New in'))
  })

  it('leaves out platforms the release has no files for', () => {
    const body = releaseBody(changelog, 'v0.1.0', ['Glance-v0.1.0-windows-x64-setup.exe', 'SHA256SUMS.txt'])!
    expect(body).toContain('**Windows 10 and 11**')
    expect(body).not.toMatch(/Ubuntu|Fedora|sudo/)
  })

  it('has a section for the current app version', () => {
    const real = readFileSync('CHANGELOG.md', 'utf8')
    const version = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version
    expect(versionNotes(real, version)).toBeTruthy()
    expect(real).not.toMatch(/^## (Download|Install|Privacy)/m)
  })
})
