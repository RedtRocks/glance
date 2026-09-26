/**
 * Keyboard shortcuts. Windows conventions first; Preview's ⌘ shortcuts map to Ctrl
 * and ⌘⌥ combos map to Ctrl+Shift, never Ctrl+Alt (that is AltGr on many European
 * keyboards). Users can rebind any command.
 */

export type Combo = string // canonical form, e.g. "Ctrl+Shift+G"

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift'] as const

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  '+': '=',
  Plus: '=',
  Minus: '-',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

function normalizeKey(key: string): string {
  const k = KEY_ALIASES[key] ?? key
  return k.length === 1 ? k.toUpperCase() : k
}

export function normalizeCombo(combo: string): Combo {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  // "Ctrl++" splits into ["Ctrl"], so recover a trailing plus.
  if (combo.endsWith('++')) parts.push('=')
  const mods = new Set<string>()
  let key = ''
  for (const p of parts) {
    const lower = p.toLowerCase()
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'cmdorctrl') mods.add('Ctrl')
    else if (lower === 'alt' || lower === 'option') mods.add('Alt')
    else if (lower === 'shift') mods.add('Shift')
    else key = normalizeKey(p)
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+')
}

/** Canonical combo for a keyboard event, or null for bare modifier presses. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): Combo | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  // Use the physical key for letters/digits so Shift or layouts don't change the combo.
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (e.code === 'Equal' || e.code === 'NumpadAdd') key = '='
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') key = '-'
  else if (e.code === 'Backquote') key = '`'
  else if (e.code === 'Backslash') key = '\\'
  else key = normalizeKey(e.key)
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return [...mods, key].join('+')
}

/** Human-readable form for menus and tooltips. */
export function displayCombo(combo: Combo): string {
  return combo.replace('Up', '↑').replace('Down', '↓').replace('=', '+')
}

/** Finds commands whose bindings collide, for the rebinding screen. */
export function findConflicts(bindings: Record<string, Combo[]>): Array<[Combo, string[]]> {
  const byCombo = new Map<Combo, string[]>()
  for (const [id, combos] of Object.entries(bindings)) {
    for (const c of combos) byCombo.set(c, [...(byCombo.get(c) ?? []), id])
  }
  return [...byCombo.entries()].filter(([, ids]) => ids.length > 1)
}
