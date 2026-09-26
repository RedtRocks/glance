/**
 * Reduce File Size (Preview's Quartz filter): recompresses large images inside a
 * PDF. Pixel work is injected (the app uses OffscreenCanvas), so this module only
 * finds the images, hands them over and swaps in smaller streams when they win.
 */
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from '@cantoo/pdf-lib'
import { collectGarbage } from './gc'

export interface SourceImage {
  /** 'jpeg': DCT bytes as stored; 'rgb'/'gray': raw 8-bit samples. */
  kind: 'jpeg' | 'rgb' | 'gray'
  width: number
  height: number
  data: Uint8Array
}

export interface Recompressed {
  jpeg: Uint8Array
  width: number
  height: number
  gray: boolean
}

export type Recompress = (img: SourceImage, maxSide: number, quality: number) => Promise<Recompressed | null>

export interface ReduceOptions {
  /** Longest image side after reduction, in pixels. */
  maxSide: number
  /** JPEG quality 0..1. */
  quality: number
}

export const REDUCE_PRESETS: Record<'smaller' | 'balanced' | 'quality', ReduceOptions> = {
  smaller: { maxSide: 1200, quality: 0.6 },
  balanced: { maxSide: 2000, quality: 0.75 },
  quality: { maxSide: 3000, quality: 0.85 }
}

const N = (s: string) => PDFName.of(s)

export async function reduceFileSize(bytes: Uint8Array, o: ReduceOptions, recompress: Recompress): Promise<{ bytes: Uint8Array; images: number; before: number; after: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  let images = 0
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype'))?.toString() !== '/Image') continue
    const d = obj.dict
    // Masks, stencils, indexed/ICC/CMYK colour and 16-bit images stay as they are.
    if (d.has(N('SMask')) || d.has(N('Mask')) || d.get(N('ImageMask'))?.toString() === 'true') continue
    const bpc = (d.get(N('BitsPerComponent')) as PDFNumber | undefined)?.asNumber()
    const cs = d.get(N('ColorSpace'))?.toString()
    if (bpc !== 8 || (cs !== '/DeviceRGB' && cs !== '/DeviceGray')) continue
    const width = (d.get(N('Width')) as PDFNumber).asNumber()
    const height = (d.get(N('Height')) as PDFNumber).asNumber()
    const filter = d.get(N('Filter'))?.toString()
    let src: SourceImage
    if (filter === '/DCTDecode') src = { kind: 'jpeg', width, height, data: obj.contents }
    else if (!filter || filter === '/FlateDecode') {
      if (d.has(N('DecodeParms')) && filter === '/FlateDecode' && d.get(N('DecodeParms'))?.toString().includes('Predictor')) continue
      const data = filter ? decodePDFRawStream(obj).decode() : obj.contents
      src = { kind: cs === '/DeviceGray' ? 'gray' : 'rgb', width, height, data }
    } else continue
    const out = await recompress(src, o.maxSide, o.quality)
    // Keep the original unless the new stream is meaningfully smaller.
    if (!out || out.jpeg.length > obj.contents.length * 0.9) continue
    const next = doc.context.stream(out.jpeg, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: out.width,
      Height: out.height,
      ColorSpace: out.gray ? 'DeviceGray' : 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode'
    })
    doc.context.assign(ref as PDFRef, next)
    images++
  }
  collectGarbage(doc)
  const out = await doc.save({ useObjectStreams: true })
  return { bytes: out, images, before: bytes.length, after: out.length }
}
