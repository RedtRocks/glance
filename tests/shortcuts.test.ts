import { describe, expect, it } from 'vitest'
import { comboFromEvent, findConflicts, normalizeCombo } from '../src/core/shortcuts'

const ev = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('shortcuts', () => {
  it('normalizes modifier order and aliases', () => {
    expect(normalizeCombo('shift+ctrl+g')).toBe('Ctrl+Shift+G')
    expect(normalizeCombo('CmdOrCtrl+Plus')).toBe('Ctrl+=')
    expect(normalizeCombo('Ctrl++')).toBe('Ctrl+=')
    expect(normalizeCombo('Del')).toBe('Delete')
  })
  it('uses physical keys so Shift and layouts do not change the combo', () => {
    expect(comboFromEvent(ev('G', 'KeyG', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+G')
    expect(comboFromEvent(ev('@', 'Digit2', { shiftKey: true }))).toBe('Shift+2')
    expect(comboFromEvent(ev('+', 'Equal', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+=')
    expect(comboFromEvent(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull()
  })
  it('reports conflicting bindings', () => {
    expect(findConflicts({ a: ['Ctrl+S'], b: ['Ctrl+S', 'F2'], c: ['F3'] })).toEqual([['Ctrl+S', ['a', 'b']]])
  })
})

describe('display', () => {
  it('spells out plus and minus like Windows menus', async () => {
    const { displayCombo } = await import('../src/core/shortcuts')
    expect(displayCombo('Ctrl+=')).toBe('Ctrl+Plus')
    expect(displayCombo('Ctrl+-')).toBe('Ctrl+Minus')
    expect(displayCombo('Ctrl+Up')).toBe('Ctrl+↑')
  })
})
