/**
 * The colour wheel in Settings → Customise (after Zen Browser's): up to three dots on a hue
 * wheel pick the window's colours. Around the wheel is hue, from the centre out is
 * saturation. Extra dots can follow the first one by a colour harmony or move freely.
 */

import { contrast, mix } from './theme'

export const MAX_DOTS = 3

export type Harmony = 'complementary' | 'analogous' | 'triadic' | 'split' | 'free'

/** Hue offsets from the first dot, by harmony (the first entries are used for two dots). */
const OFFSETS: Record<Exclude<Harmony, 'free'>, number[]> = {
  complementary: [180, 180],
  analogous: [40, -40],
  triadic: [120, 240],
  split: [150, 210]
}

/** The harmonies a set of `count` dots can cycle through. */
export function harmoniesFor(count: number): Harmony[] {
  if (count < 2) return ['free']
  return count === 2 ? ['complementary', 'analogous', 'free'] : ['triadic', 'split', 'analogous', 'free']
}

/** A point on the wheel: hue in degrees clockwise from the top, saturation 0 (centre) to 1 (rim). */
export interface Dot {
  hue: number
  sat: number
}

/** Lightness of every colour on the wheel; light enough to read on in both themes once mixed. */
const WHEEL_LIGHTNESS = 0.55

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

export function dotColour(dot: Dot): string {
  return hslToHex(((dot.hue % 360) + 360) % 360, Math.min(1, Math.max(0, dot.sat)), WHEEL_LIGHTNESS)
}

/** Where a colour sits on the wheel (its lightness is dropped). */
export function dotFor(hex: string): Dot {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { hue: 0, sat: 0 }
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { hue: 0, sat: 0 }
  const l = (max + min) / 2
  const sat = d / (1 - Math.abs(2 * l - 1))
  const hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return { hue: Math.round((hue + 360) % 360), sat: Math.min(1, sat) }
}

/** The dot under a point on a wheel `size` px across; points past the rim snap to it. */
export function dotAt(x: number, y: number, size: number): Dot {
  const r = size / 2
  const dx = x - r
  const dy = y - r
  const sat = Math.min(1, Math.hypot(dx, dy) / r)
  const hue = sat === 0 ? 0 : (Math.atan2(dx, -dy) * 180) / Math.PI
  return { hue: Math.round((hue + 360) % 360), sat }
}

/** Where to draw a dot on a wheel `size` px across. */
export function pointOf(dot: Dot, size: number): { x: number; y: number } {
  const r = size / 2
  const a = (dot.hue * Math.PI) / 180
  return { x: r + Math.sin(a) * dot.sat * r, y: r - Math.cos(a) * dot.sat * r }
}

/** Places the other dots around the first by `harmony`; 'free' leaves them where they are. */
export function harmonise(dots: Dot[], harmony: Harmony): Dot[] {
  if (harmony === 'free' || dots.length < 2) return dots
  const [first] = dots
  return dots.map((d, i) => (i === 0 ? d : { hue: (first.hue + OFFSETS[harmony][i - 1] + 360) % 360, sat: first.sat }))
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const [r, g, b] = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [0, 0, 0]
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`
}

/** What the window colours are painted over, and its muted text, the faintest that must stay readable. */
export interface Backdrop {
  bg: string
  muted: string
}

/** Muted text needs 4.5:1 (WCAG AA); a little headroom covers grain and overlapping layers. */
const MIN_CONTRAST = 5

/**
 * The most of `colour` (up to `alpha`) that can be laid over `base` while its muted text,
 * and so every brighter text and icon, keeps enough contrast.
 */
export function safeAlpha(colour: string, alpha: number, base: Backdrop): number {
  let a = alpha
  while (a > 0 && contrast(mix(base.bg, colour, a), base.muted) < MIN_CONTRAST) a = Math.round((a - 0.02) * 100) / 100
  return Math.max(0, a)
}

/**
 * The window backdrop for `colours` at `strength` (0 to 1): one colour is a soft wash,
 * two run corner to corner, three meet from the corners. Empty when there is nothing to
 * paint. With a `base`, each colour is held back as far as its text needs.
 */
export function windowGradient(colours: string[], strength: number, base?: Backdrop): string {
  const a = Math.min(1, Math.max(0, strength)) * 0.85
  if (!colours.length || a === 0) return ''
  const c = colours.slice(0, MAX_DOTS).map((hex) => rgba(hex, base ? safeAlpha(hex, a, base) : a))
  if (c.length === 1) return `linear-gradient(${c[0]}, ${c[0]})`
  if (c.length === 2) return `linear-gradient(135deg, ${c[0]} 0%, ${c[1]} 100%)`
  return [
    `radial-gradient(circle at 0% 0%, ${c[0]} 0%, transparent 70%)`,
    `radial-gradient(circle at 100% 0%, ${c[1]} 0%, transparent 75%)`,
    `linear-gradient(0deg, ${c[2]} 0%, transparent 85%)`
  ].join(', ')
}

/** A tile of film grain at `amount` (0 to 1), as a CSS image; empty for none. */
export function grainImage(amount: number): string {
  const o = Math.round(Math.min(1, Math.max(0, amount)) * 0.25 * 1000) / 1000
  if (o === 0) return ''
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1 0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)' opacity='${o}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Gradient presets shown under the wheel (the Wollo palette, mixed). */
export const GRADIENT_PRESETS = [
  { id: 'dusk', colours: ['#6312f6', '#f258a8', '#f47933'] },
  { id: 'lagoon', colours: ['#7182e7', '#1f9d55', '#005fb8'] },
  { id: 'sunrise', colours: ['#f8d32c', '#f47933', '#f258a8'] },
  { id: 'aurora', colours: ['#1f9d55', '#7182e7', '#6312f6'] }
] as const
