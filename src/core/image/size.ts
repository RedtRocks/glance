/** Adjust Size (Preview's Tools → Adjust Size): units, resolution and presets. */

export type Unit = 'px' | 'percent' | 'in' | 'cm' | 'mm' | 'pt'

export const FIT_PRESETS: [string, number, number][] = [
  ['320 × 240', 320, 240],
  ['640 × 480', 640, 480],
  ['800 × 600', 800, 600],
  ['1024 × 768', 1024, 768],
  ['1280 × 1024', 1280, 1024],
  ['1920 × 1080 (Full HD)', 1920, 1080],
  ['2560 × 1440', 2560, 1440],
  ['3840 × 2160 (4K)', 3840, 2160]
]

/** Pixels for a length in `unit` at `dpi`; `basePx` is the original size for percent. */
export function toPixels(value: number, unit: Unit, dpi: number, basePx: number): number {
  switch (unit) {
    case 'px':
      return value
    case 'percent':
      return (basePx * value) / 100
    case 'in':
      return value * dpi
    case 'cm':
      return (value / 2.54) * dpi
    case 'mm':
      return (value / 25.4) * dpi
    case 'pt':
      return (value / 72) * dpi
  }
}

export function fromPixels(px: number, unit: Unit, dpi: number, basePx: number): number {
  switch (unit) {
    case 'px':
      return px
    case 'percent':
      return (px / basePx) * 100
    case 'in':
      return px / dpi
    case 'cm':
      return (px / dpi) * 2.54
    case 'mm':
      return (px / dpi) * 25.4
    case 'pt':
      return (px / dpi) * 72
  }
}

/** Largest size that fits inside the box, keeping aspect ratio and never enlarging. */
export function fitInto(w: number, h: number, maxW: number, maxH: number): [number, number] {
  const s = Math.min(1, maxW / w, maxH / h)
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
}

/** The other dimension when scaling proportionally. */
export function proportional(changed: number, fromChanged: number, fromOther: number): number {
  return Math.max(1, Math.round((changed / fromChanged) * fromOther))
}

/** Approximate uncompressed size, the "Resulting size" line in Preview. */
export function describeBytes(w: number, h: number): string {
  const bytes = w * h * 4
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
