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
