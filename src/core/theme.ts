/**
 * Theme colours chosen in Settings → Design: the accent colour and how much of it tints
 * the window (as Arc and Zen do). Pure colour maths; App.tsx writes the result onto <html>.
 */

export type Look = 'fluent' | 'wollo'
export type Tint = 'none' | 'soft' | 'bold'

/** The Wollo palette, from the website. */
export const ACCENT_PRESETS = [
  { id: 'violet', hex: '#6312f6' },
  { id: 'periwinkle', hex: '#7182e7' },
  { id: 'pink', hex: '#f258a8' },
  { id: 'orange', hex: '#f47933' },
  { id: 'yellow', hex: '#f8d32c' },
  { id: 'green', hex: '#1f9d55' },
  { id: 'blue', hex: '#005fb8' },
  { id: 'ink', hex: '#0a0a0a' }
] as const

export const DEFAULT_ACCENT = '#6312f6'

type Rgb = [number, number, number]

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

/** `amount` of `b` mixed into `a` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const x = parseHex(a) ?? [0, 0, 0]
  const y = parseHex(b) ?? [0, 0, 0]
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as Rgb)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0]
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on `bg`. */
export function textOn(bg: string): string {
  return contrast(bg, '#ffffff') >= contrast(bg, '#0a0a0a') ? '#ffffff' : '#0a0a0a'
}

/**
 * The accent as shown on a background: lightened in dark mode (or darkened in light mode)
 * until it stands out at least 3:1, the contrast WCAG asks of controls.
 */
export function readableAccent(hex: string, bg: string): string {
  const toward = luminance(bg) < 0.5 ? '#ffffff' : '#000000'
  let out = hex
  for (let step = 1; contrast(out, bg) < 3 && step <= 10; step++) out = mix(hex, toward, step * 0.08)
  return out
}

/** Window surfaces before tinting, per look and light/dark (mirrors app.css and web.css). */
const SURFACES: Record<Look, Record<'light' | 'dark', Record<string, string>>> = {
  wollo: {
    light: { '--bg-solid': '#ffffff', '--chrome': '#ffffff', '--subtle': '#f9f9f9', '--layer': '#f9f9f9', '--canvas': '#f2f2f4', '--infobar-info-bg': '#f9f9f9' },
    dark: { '--bg-solid': '#0e0d12', '--chrome': '#0e0d12', '--subtle': '#1a1920', '--layer': '#1a1920', '--canvas': '#16151b', '--infobar-info-bg': '#1a1920' }
  },
  fluent: {
    light: { '--bg-solid': '#f3f3f3', '--chrome': '#f3f3f3', '--canvas': '#e8e8e8' },
    dark: { '--bg-solid': '#202020', '--chrome': '#202020', '--canvas': '#1a1a1a' }
  }
}

const TINT_AMOUNT: Record<Tint, { light: number; dark: number }> = {
  none: { light: 0, dark: 0 },
  soft: { light: 0.06, dark: 0.08 },
  bold: { light: 0.14, dark: 0.16 }
}

/** CSS custom properties for the chosen accent and tint. */
export function themeVars(opts: { accent: string; tint: Tint; look: Look; dark: boolean }): Record<string, string> {
  const mode = opts.dark ? 'dark' : 'light'
  const base = SURFACES[opts.look][mode]
  const raw = parseHex(opts.accent) ? opts.accent : DEFAULT_ACCENT
  const accent = readableAccent(raw, base['--bg-solid'])
  const vars: Record<string, string> = {
    '--accent': accent,
    '--accent-hover': mix(accent, opts.dark ? '#ffffff' : '#000000', 0.12),
    '--on-accent': textOn(accent),
    '--violet': accent,
    '--selection': `${accent}2e`
  }
  const amount = TINT_AMOUNT[opts.tint][mode]
  if (amount > 0) for (const [name, value] of Object.entries(base)) vars[name] = mix(value, raw, amount)
  return vars
}
