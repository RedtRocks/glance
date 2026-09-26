/** Runs a batch edit over image files (see core/image/batch.ts). */
import { signal } from '@preact/signals'
import { extOf, metadataOnly, outputExt, outputSize, targetPath, type BatchOptions } from '../core/image/batch'
import { flip, rotate90 } from '../core/image/transform'
import type { Raster } from '../core/image/raster'
import * as engine from '../image/engine'
import * as platform from '../platform'
import { t } from '../i18n'

export const batchOpen = signal(false)
export const batchProgress = signal<{ done: number; total: number; current: string } | null>(null)

async function decode(path: string): Promise<Raster> {
  const probe = await platform.probe(path)
  if (probe.kind !== 'image') throw new Error(t('not an image Glance can read'))
  const res = await fetch(platform.imageUrl(probe))
  if (!res.ok) throw new Error(await res.text())
  const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image', premultiplyAlpha: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return engine.fromCanvas(c)
}

async function processOne(path: string, o: BatchOptions): Promise<void> {
  const target = targetPath(path, o)
  if (metadataOnly(o, path)) {
    // No pixel changes: copy (or keep) the file as-is, then strip location in place.
    if (target !== path) await platform.writeFile(target, await platform.readFile(path))
    if (o.removeLocation) {
      const failed = await platform.removeLocation([target])
      if (failed.length) throw new Error(failed[0])
    }
    return
  }
  let r = await decode(path)
  if (o.rotate === 90) r = rotate90(r, true)
  else if (o.rotate === 270) r = rotate90(r, false)
  else if (o.rotate === 180) r = rotate90(rotate90(r, true), true)
  if (o.flip !== 'none') r = flip(r, o.flip)
  const [w, h] = outputSize(r.width, r.height, { ...o, rotate: 0 })
  if (w !== r.width || h !== r.height) r = await engine.resize(r, w, h)
  // Re-encoded files carry no EXIF, so location is gone too.
  await platform.saveImage(target, outputExt(path, o.format), r.width, r.height, r.data as Uint8ClampedArray, o.quality)
}

/** Processes the files one by one; returns a message per failed file. */
export async function runBatch(paths: string[], o: BatchOptions): Promise<string[]> {
  const failed: string[] = []
  for (const [i, path] of paths.entries()) {
    batchProgress.value = { done: i, total: paths.length, current: platform.baseName(path) }
    try {
      await processOne(path, o)
    } catch (e) {
      failed.push(`${platform.baseName(path)}: ${(e as Error).message ?? e}`)
    }
  }
  batchProgress.value = null
  return failed
}

export { extOf }
