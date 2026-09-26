/**
 * What the Header, Footer & Watermark dialog configures, kept apart from the
 * pdf-lib code in stamps.ts so the dialog loads without it (ADR 0002).
 */
export type StampFont = 'Helvetica' | 'Times' | 'Courier'
export type Slot = 'left' | 'center' | 'right'

export interface TextWatermark {
  kind: 'text'
  text: string
  /** Points; 0 fits the text across the page. */
  size: number
  /** Counterclockwise, in degrees. */
  angle: number
  /** '#rrggbb'. */
  color: string
}
export interface ImageWatermark {
  kind: 'image'
  bytes: Uint8Array
  type: 'png' | 'jpg'
  /** Width as a fraction of the page width. */
  scale: number
}

export interface StampOptions {
  /** Left, center and right text of the header and footer; see `expandTokens`. */
  header: Record<Slot, string>
  footer: Record<Slot, string>
  font: StampFont
  /** Header and footer font size in points. */
  size: number
  /** '#rrggbb', for header and footer. */
  color: string
  /** Distance from the page edges in points. */
  margin: number
  watermark: TextWatermark | ImageWatermark | null
  /** Watermark opacity, 0–1. */
  opacity: number
  /** Pages to stamp, like "1-3, 5, 8-"; empty for all. */
  pages: string
  /** The number the first stamped page gets. */
  startNumber: number
}

export const DEFAULT_STAMPS: StampOptions = {
  header: { left: '', center: '', right: '' },
  footer: { left: '', center: 'Page {page} of {pages}', right: '' },
  font: 'Helvetica',
  size: 10,
  color: '#000000',
  margin: 28,
  watermark: null,
  opacity: 0.25,
  pages: '',
  startNumber: 1
}

export interface StampEnv {
  /** File name for {file}. */
  fileName: string
  /** Text for {date}. */
  date: string
  /** Loads a system font for text the standard PDF fonts can't encode. */
  loadFont?: (family: string) => Promise<Uint8Array | null>
}

/**
 * 0-based page indexes selected by `spec` ("1-3, 5, 8-", "-4"), in order, or null
 * when it can't be read. Empty selects every page.
 */
export function parsePageRange(spec: string, pageCount: number): number[] | null {
  const s = spec.trim()
  if (!s) return Array.from({ length: pageCount }, (_, i) => i)
  const picked = new Set<number>()
  for (const part of s.split(/[,;]/)) {
    const p = part.trim()
    if (!p) continue
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(p) ?? /^(\d+)()$/.exec(p)
    if (!m || (!m[1] && !m[2])) return null
    const single = !p.match(/[-–]/)
    const from = m[1] ? Number(m[1]) : 1
    const to = single ? from : m[2] ? Number(m[2]) : pageCount
    if (from < 1 || to < from) return null
    for (let n = from; n <= Math.min(to, pageCount); n++) picked.add(n - 1)
  }
  return [...picked].sort((a, b) => a - b)
}

/** Replaces {page}, {pages}, {date} and {file}. */
export function expandTokens(text: string, v: { page: number; pages: number; date: string; file: string }): string {
  return text.replace(/\{(page|pages|date|file)\}/gi, (_, k: string) => String(v[k.toLowerCase() as keyof typeof v]))
}

export function hasStamps(o: StampOptions): boolean {
  const wm = o.watermark
  return [...Object.values(o.header), ...Object.values(o.footer)].some((t) => t.trim()) || (wm?.kind === 'text' ? !!wm.text.trim() : !!wm)
}
