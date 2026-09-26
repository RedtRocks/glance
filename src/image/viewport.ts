import type { PageViewport } from 'pdfjs-dist'

/**
 * A PDF.js-viewport lookalike for images, so the markup layer (written against PDF
 * space: y up) works unchanged: image pixel (x, py) ↔ markup point (x, H − py).
 */
export function imageViewport(W: number, H: number, scale: number): PageViewport {
  return {
    width: W * scale,
    height: H * scale,
    scale,
    rotation: 0,
    transform: [scale, 0, 0, -scale, 0, H * scale],
    convertToViewportPoint: (x: number, y: number) => [x * scale, (H - y) * scale],
    convertToPdfPoint: (x: number, y: number) => [x / scale, H - y / scale],
    clone: () => imageViewport(W, H, scale)
  } as unknown as PageViewport
}
