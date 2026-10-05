/**
 * HEIC and HEIF photos (iPhone pictures) in the browser version: libheif
 * (LGPL-3.0, via libheif-js) compiled to WebAssembly, loaded the first time one is
 * opened. The Windows app uses the system's HEIF codec instead.
 */

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: { data: Uint8ClampedArray } | null) => void): void
  free(): void
}
interface Libheif {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] }
}

let loading: Promise<Libheif> | null = null

function load(): Promise<Libheif> {
  // @ts-expect-error The package ships no types for its ES module build.
  loading ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(async (m) => {
    const factory = (m as { default: unknown }).default as () => Libheif | Promise<Libheif>
    return factory()
  })
  return loading
}

export const HEIF = ['heic', 'heif', 'hif']

/** The main picture in a HEIF file, turned the right way up, as RGBA. */
export async function decodeHeif(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const lib = await load()
  const images = new lib.HeifDecoder().decode(bytes)
  try {
    const image = images.find((i) => i.is_primary()) ?? images[0]
    if (!image) throw new Error('No picture found in this HEIF file')
    const width = image.get_width()
    const height = image.get_height()
    const result = await new Promise<{ data: Uint8ClampedArray } | null>((resolve) => image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, resolve))
    if (!result) throw new Error('This HEIF picture could not be decoded')
    return { width, height, rgba: result.data }
  } finally {
    for (const i of images) i.free()
  }
}

/**
 * A 32-bit BMP (BITMAPV4HEADER, so the alpha channel counts), top-down: the same
 * kind of file the WebAssembly decoders hand back.
 */
export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const header = 14 + 108
  const out = new Uint8Array(header + width * height * 4)
  const v = new DataView(out.buffer)
  out.set([0x42, 0x4d]) // "BM"
  v.setUint32(2, out.length, true)
  v.setUint32(10, header, true)
  v.setUint32(14, 108, true)
  v.setInt32(18, width, true)
  v.setInt32(22, -height, true) // negative: rows run top to bottom
  v.setUint16(26, 1, true)
  v.setUint16(28, 32, true)
  v.setUint32(30, 3, true) // BI_BITFIELDS
  v.setUint32(34, width * height * 4, true)
  v.setUint32(54, 0x00ff0000, true) // red
  v.setUint32(58, 0x0000ff00, true) // green
  v.setUint32(62, 0x000000ff, true) // blue
  v.setUint32(66, 0xff000000, true) // alpha
  v.setUint32(70, 0x73524742, true) // "sRGB"
  for (let i = 0, o = header; i < rgba.length; i += 4, o += 4) {
    out[o] = rgba[i + 2]
    out[o + 1] = rgba[i + 1]
    out[o + 2] = rgba[i]
    out[o + 3] = rgba[i + 3]
  }
  return out
}
