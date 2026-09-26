/** Canvas-based JPEG recompression for Reduce File Size (see core/reduce.ts). */
import type { Recompress } from '../core/reduce'

export const canvasRecompress: Recompress = async (img, maxSide, quality) => {
  let bitmap: ImageBitmap
  if (img.kind === 'jpeg') {
    bitmap = await createImageBitmap(new Blob([img.data as BlobPart], { type: 'image/jpeg' }))
  } else {
    const n = img.width * img.height
    const expected = n * (img.kind === 'gray' ? 1 : 3)
    if (img.data.length < expected) return null
    const rgba = new Uint8ClampedArray(n * 4)
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (img.kind === 'gray') rgba[j] = rgba[j + 1] = rgba[j + 2] = img.data[i]
      else {
        rgba[j] = img.data[i * 3]
        rgba[j + 1] = img.data[i * 3 + 1]
        rgba[j + 2] = img.data[i * 3 + 2]
      }
      rgba[j + 3] = 255
    }
    bitmap = await createImageBitmap(new ImageData(rgba, img.width, img.height))
  }
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * s))
  const h = Math.max(1, Math.round(bitmap.height * s))
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality })
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: w, height: h, gray: false }
}
