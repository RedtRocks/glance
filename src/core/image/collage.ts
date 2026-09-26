/**
 * Collage layouts. "Rows" keeps every photo whole (justified rows, like photo
 * galleries); "Grid" gives every photo the same cell and crops to fill it.
 */
export interface Size {
  width: number
  height: number
}

export interface Placement {
  /** Destination in the collage. */
  x: number
  y: number
  w: number
  h: number
  /** Source crop (grid layout); the whole image for rows. */
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface CollageOptions {
  layout: 'rows' | 'grid'
  /** Output width in pixels. */
  width: number
  /** Space between photos and around the edge, in pixels. */
  gap: number
  /** Grid only: columns (0 = automatic). */
  columns?: number
  /** Rows only: preferred row height relative to the width (0.2 = a fifth). */
  rowHeight?: number
}

/** Justified rows: fill each row to the full width, scaling heights to fit. */
function rows(sizes: Size[], o: CollageOptions): { placements: Placement[]; height: number } {
  const inner = o.width - 2 * o.gap
  const target = Math.max(40, o.width * (o.rowHeight ?? 0.28))
  const placements: Placement[] = []
  let y = o.gap
  let i = 0
  while (i < sizes.length) {
    // Grow the row until it would be shorter than the target height.
    let j = i
    let aspect = 0
    while (j < sizes.length) {
      aspect += sizes[j].width / sizes[j].height
      j++
      const h = (inner - o.gap * (j - i - 1)) / aspect
      if (h <= target) break
    }
    const last = j >= sizes.length
    let h = (inner - o.gap * (j - i - 1)) / aspect
    // Don't blow up a short last row to full width.
    if (last && h > target * 1.4) h = target
    let x = o.gap
    for (let k = i; k < j; k++) {
      const w = (sizes[k].width / sizes[k].height) * h
      placements.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), sx: 0, sy: 0, sw: sizes[k].width, sh: sizes[k].height })
      x += w + o.gap
    }
    y += h + o.gap
    i = j
  }
  return { placements, height: Math.round(y) }
}

/** Uniform grid; photos are cropped around their centre to fill their cell. */
function grid(sizes: Size[], o: CollageOptions): { placements: Placement[]; height: number } {
  const n = sizes.length
  const cols = o.columns && o.columns > 0 ? o.columns : Math.max(1, Math.round(Math.sqrt(n * 1.33)))
  const rowsN = Math.ceil(n / cols)
  const cell = (o.width - o.gap * (cols + 1)) / cols
  const cellH = cell * 0.75
  const placements = sizes.map((s, k) => {
    const cx = k % cols
    const cy = Math.floor(k / cols)
    const scale = Math.max(cell / s.width, cellH / s.height)
    const sw = cell / scale
    const sh = cellH / scale
    return {
      x: Math.round(o.gap + cx * (cell + o.gap)),
      y: Math.round(o.gap + cy * (cellH + o.gap)),
      w: Math.round(cell),
      h: Math.round(cellH),
      sx: (s.width - sw) / 2,
      sy: (s.height - sh) / 2,
      sw,
      sh
    }
  })
  return { placements, height: Math.round(o.gap + rowsN * (cellH + o.gap)) }
}

export function layoutCollage(sizes: Size[], o: CollageOptions): { placements: Placement[]; width: number; height: number } {
  if (!sizes.length) return { placements: [], width: o.width, height: 0 }
  const r = o.layout === 'grid' ? grid(sizes, o) : rows(sizes, o)
  return { ...r, width: o.width }
}
