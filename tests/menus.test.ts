import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isMenuBarMenu, OVERFLOW_ITEMS, OVERFLOW_MENU } from '../src/core/menus'

describe('toolbar overflow menu', () => {
  it('is not closed by the menu bar when one of its items is pressed', () => {
    expect(isMenuBarMenu(OVERFLOW_MENU)).toBe(false)
    expect(isMenuBarMenu(null)).toBe(false)
  })
  it('still lets the menu bar close its own menus', () => {
    expect(isMenuBarMenu('File')).toBe(true)
    expect(isMenuBarMenu('View')).toBe(true)
  })
  it('lists only commands that exist', () => {
    const source = readFileSync(new URL('../src/state/commands.ts', import.meta.url), 'utf8')
    const ids = OVERFLOW_ITEMS.filter((id) => id !== '-')
    expect(ids).toContain('file.share')
    expect(ids).toContain('file.print')
    expect(ids).toContain('file.export')
    for (const id of ids) expect(source, id).toContain(`id: '${id}'`)
  })
})
