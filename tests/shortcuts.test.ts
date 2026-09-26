import { readFileSync } from 'node:fs'
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

describe('tool shortcuts', () => {
  it('reads bracket keys by position', () => {
    expect(comboFromEvent(ev('[', 'BracketLeft'))).toBe('[')
    expect(comboFromEvent(ev('}', 'BracketRight', { shiftKey: true }))).toBe('Shift+]')
  })
  it('lets commands for different kinds of file share a key', () => {
    const scope = (id: string) => (id.startsWith('model.') ? 'model' : id.startsWith('tools.') ? 'page' : '')
    expect(findConflicts({ 'model.autoRotate': ['T'], 'tools.text': ['T'] }, scope)).toEqual([])
    expect(findConflicts({ 'tools.a': ['T'], 'tools.b': ['T'] }, scope)).toEqual([['T', ['tools.a', 'tools.b']]])
    expect(findConflicts({ 'model.a': ['T'], 'tools.b': ['T'], 'view.c': ['T'] }, scope)).toEqual([['T', ['model.a', 'tools.b', 'view.c']]])
  })
  it('steps through a tool group on repeated presses', async () => {
    const { cycleTool } = await import('../src/core/shortcuts')
    expect(cycleTool(['selectRect', 'selectEllipse'], 'select')).toBe('selectRect')
    expect(cycleTool(['selectRect', 'selectEllipse'], 'selectRect')).toBe('selectEllipse')
    expect(cycleTool(['selectRect', 'selectEllipse'], 'selectEllipse')).toBe('selectRect')
    expect(cycleTool(['text'], 'text')).toBe('text')
  })
  it('steps line widths with [ and ]', async () => {
    const { stepWidth } = await import('../src/core/shortcuts')
    const widths = [0.5, 1, 2, 3]
    expect(stepWidth(widths, 1, 1)).toBe(2)
    expect(stepWidth(widths, 1, -1)).toBe(0.5)
    expect(stepWidth(widths, 3, 1)).toBe(3)
    expect(stepWidth(widths, 1.5, -1)).toBe(1)
  })
  it('ships industry-standard single keys without conflicts', () => {
    // The command registry pulls in the PDF engine, so read its default keys from source.
    const source = readFileSync(new URL('../src/state/commands.ts', import.meta.url), 'utf8')
    const map: Record<string, string[]> = {}
    for (const m of source.matchAll(/id: '([^']+)'[^\n]*?keys: \[((?:'[^']*'(?:, )?)*)\]/g)) {
      map[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map((k) => normalizeCombo(k[1]))
    }
    const expected: Record<string, string> = {
      'tools.select': 'V', 'tools.hand': 'H', 'tools.zoom': 'Z', 'tools.marquee': 'M', 'tools.lasso': 'L', 'tools.instantAlpha': 'W',
      'tools.brush': 'B', 'tools.shapes': 'U', 'tools.rectangle': 'R', 'tools.oval': 'O', 'tools.text': 'T', 'tools.note': 'S',
      'tools.crop': 'C', 'tools.thinner': '[', 'tools.thicker': ']', 'view.zoomToFit': 'Shift+1', 'view.actualSize': 'Shift+0'
    }
    for (const [id, key] of Object.entries(expected)) expect(map[id], id).toContain(key)
    const scope = (id: string) => (id.startsWith('model.') ? 'model' : id.startsWith('tools.') ? 'page' : '')
    expect(findConflicts(map, scope)).toEqual([])
  })
})
