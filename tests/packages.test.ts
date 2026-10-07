import { describe, expect, it } from 'vitest'
import { linuxInstallCommand } from '../src/core/packages'

describe('Linux install command', () => {
  it('uses apt on Ubuntu', () => {
    expect(linuxInstallCommand('ghostscript', 'ID=ubuntu\nID_LIKE=debian')).toBe('sudo apt install ghostscript')
  })

  it('uses apt on Ubuntu and Debian derivatives', () => {
    expect(linuxInstallCommand('ghostscript', 'ID=linuxmint\nID_LIKE="ubuntu debian"')).toBe('sudo apt install ghostscript')
  })

  it('uses apt on Debian', () => {
    expect(linuxInstallCommand('ghostscript', 'ID=debian')).toBe('sudo apt install ghostscript')
  })

  it('uses dnf on Fedora', () => {
    expect(linuxInstallCommand('ghostscript', 'ID=fedora')).toBe('sudo dnf install ghostscript')
  })

  it('uses dnf on RHEL', () => {
    expect(linuxInstallCommand('ghostscript', 'ID="rhel"\nID_LIKE="fedora"')).toBe('sudo dnf install ghostscript')
  })

  it('defaults to dnf without distribution information', () => {
    expect(linuxInstallCommand('ghostscript', '')).toBe('sudo dnf install ghostscript')
  })

  it('matches distribution tokens exactly', () => {
    expect(linuxInstallCommand('ghostscript', 'ID=ubuntu-core')).toBe('sudo dnf install ghostscript')
  })
})
