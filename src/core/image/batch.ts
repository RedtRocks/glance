/**
 * Batch editing of many images (Preview: select images in the sidebar, then
 * Tools → Rotate / Adjust Size / Export Selected Images). Pure planning helpers;
 * the pixel work happens in state/batch.ts.
 */
import { fitInto } from './size'
import { msg } from '../../i18n'

export type BatchFormat = 'keep' | 'png' | 'jpg' | 'webp' | 'tiff' | 'bmp'

export interface BatchOptions {
  rotate: 0 | 90 | 180 | 270
  flip: 'none' | 'horizontal' | 'vertical'
  resize: { mode: 'none' } | { mode: 'fit'; width: number; height: number } | { mode: 'percent'; percent: number }
  format: BatchFormat
  quality: number
  removeLocation: boolean
  /** Write next to the originals with a suffix, or replace them. */
  output: 'suffix' | 'replace'
  suffix: string
}

export const DEFAULT_BATCH: BatchOptions = {
  rotate: 0,
  flip: 'none',
  resize: { mode: 'none' },
  format: 'keep',
  quality: 90,
  removeLocation: false,
  output: 'suffix',
  /** Marked with msg(): translate with t() when starting a batch. */
  suffix: msg(' (edited)')
}

/** Formats Glance can write; others (HEIC, RAW, PSD…) become JPEG or PNG. */
const WRITABLE = ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp']
const PHOTO = ['heic', 'heif', 'avif', 'jxl', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw']

export function extOf(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
}

/** Output extension for a source file. */
export function outputExt(path: string, format: BatchFormat): string {
  if (format !== 'keep') return format
  const ext = extOf(path)
  if (WRITABLE.includes(ext)) return ext
  return PHOTO.includes(ext) ? 'jpg' : 'png'
}

/** Only metadata changes: the file can be rewritten without re-encoding pixels. */
export function metadataOnly(o: BatchOptions, path: string): boolean {
  return o.rotate === 0 && o.flip === 'none' && o.resize.mode === 'none' && outputExt(path, o.format) === extOf(path)
}

/** Where the result goes. Replacing only applies when the extension doesn't change. */
export function targetPath(path: string, o: BatchOptions): string {
  const ext = outputExt(path, o.format)
  const stem = path.replace(/\.[^.\\/]+$/, '')
  if (o.output === 'replace' && ext === extOf(path)) return path
  const suffix = o.output === 'replace' ? '' : o.suffix
  return `${stem}${suffix}.${ext}`
}

/** Final pixel size after rotation and resizing. */
export function outputSize(w: number, h: number, o: BatchOptions): [number, number] {
  const [rw, rh] = o.rotate % 180 ? [h, w] : [w, h]
  if (o.resize.mode === 'fit') return fitInto(rw, rh, o.resize.width, o.resize.height)
  if (o.resize.mode === 'percent') {
    const s = o.resize.percent / 100
    return [Math.max(1, Math.round(rw * s)), Math.max(1, Math.round(rh * s))]
  }
  return [rw, rh]
}

/** Nothing to do at all. */
export function isNoop(o: BatchOptions, path: string): boolean {
  return metadataOnly(o, path) && !o.removeLocation && o.output === 'replace'
}
