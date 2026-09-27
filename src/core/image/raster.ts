/** An RGBA pixel buffer (straight alpha), the unit every image operation works on. */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function raster(width: number, height: number, data?: Uint8ClampedArray): Raster {
  return { width, height, data: data ?? new Uint8ClampedArray(width * height * 4) }
}

export function clone(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) }
}

export interface IRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The pixel box a redaction covers, grown outward to whole pixels so no partly covered
 * edge pixel keeps a blend of what was underneath. `rect` is [x1, y1, x2, y2] with y up
 * (markup space); `height` is the image height.
 */
export function redactionBox(rect: readonly [number, number, number, number], width: number, height: number): IRect | null {
  const x = Math.max(0, Math.floor(Math.min(rect[0], rect[2])))
  const y = Math.max(0, Math.floor(height - Math.max(rect[1], rect[3])))
  const right = Math.min(width, Math.ceil(Math.max(rect[0], rect[2])))
  const bottom = Math.min(height, Math.ceil(height - Math.min(rect[1], rect[3])))
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

/** Paints each rect opaque black into a copy of `r`: redactions burned into the pixels. */
export function burnRedactions(r: Raster, rects: readonly (readonly [number, number, number, number])[]): Raster {
  const out = clone(r)
  for (const rect of rects) {
    const box = redactionBox(rect, r.width, r.height)
    if (!box) continue
    for (let yy = box.y; yy < box.y + box.height; yy++) {
      const row = yy * r.width
      for (let xx = box.x; xx < box.x + box.width; xx++) out.data.set([0, 0, 0, 255], (row + xx) * 4)
    }
  }
  return out
}
