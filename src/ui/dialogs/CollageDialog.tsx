import { useEffect, useRef, useState } from 'preact/hooks'
import { layoutCollage, type CollageOptions } from '../../core/image/collage'
import { ImageDoc, docs } from '../../state/documents'
import { OPEN_FILTERS, openFiles } from '../../state/actions'
import { collageOpen, toast, withBusy } from '../../state/ui'
import * as platform from '../../platform'
import { Modal } from './Dialog'

const IMAGE_EXTS = OPEN_FILTERS[0].extensions.filter((e) => !['pdf', 'ai', 'ps', 'eps', 'epsf', 'xps', 'oxps', 'cbz'].includes(e))
type Background = 'white' | 'black' | 'transparent'

async function bitmap(path: string, max?: number): Promise<ImageBitmap> {
  const probe = await platform.probe(path)
  const res = await fetch(platform.imageUrl(probe, 0, max))
  return createImageBitmap(await res.blob(), { imageOrientation: 'from-image' })
}

function draw(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bitmaps: ImageBitmap[], o: CollageOptions, bg: Background, scale: number): void {
  const { placements, width, height } = layoutCollage(bitmaps.map((b) => ({ width: b.width, height: b.height })), o)
  g.canvas.width = Math.max(1, Math.round(width * scale))
  g.canvas.height = Math.max(1, Math.round(height * scale))
  if (bg !== 'transparent') {
    g.fillStyle = bg
    g.fillRect(0, 0, g.canvas.width, g.canvas.height)
  }
  g.imageSmoothingQuality = 'high'
  placements.forEach((p, k) => g.drawImage(bitmaps[k], p.sx, p.sy, p.sw, p.sh, p.x * scale, p.y * scale, p.w * scale, p.h * scale))
}

/** File → Create Collage: combine photos into one image. */
export function CollageDialog() {
  const [files, setFiles] = useState<string[]>(() =>
    docs.peek().flatMap((d) => (d instanceof ImageDoc && d.path.peek() && !d.path.peek()!.startsWith('browser:') ? [d.path.peek()!] : []))
  )
  const [layout, setLayout] = useState<'rows' | 'grid'>('rows')
  const [width, setWidth] = useState(3000)
  const [gap, setGap] = useState(16)
  const [columns, setColumns] = useState(0)
  const [bg, setBg] = useState<Background>('white')
  const [thumbs, setThumbs] = useState<ImageBitmap[]>([])
  const preview = useRef<HTMLCanvasElement>(null)
  const close = (): void => void (collageOpen.value = false)
  const options: CollageOptions = { layout, width, gap, columns }

  useEffect(() => {
    let alive = true
    void Promise.all(files.map((f) => bitmap(f, 480).catch(() => null))).then((b) => alive && setThumbs(b.filter((x): x is ImageBitmap => !!x)))
    return () => {
      alive = false
    }
  }, [files])
  useEffect(() => {
    const c = preview.current
    if (c && thumbs.length) draw(c.getContext('2d')!, thumbs, options, bg, 560 / width)
  }, [thumbs, layout, width, gap, columns, bg])

  const add = async (): Promise<void> => {
    const picked = await platform.openDialog({ multiple: true, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] })
    setFiles([...new Set([...files, ...picked])])
  }

  const save = async (): Promise<void> => {
    const format = bg === 'transparent' ? 'png' : 'jpg'
    const target = await platform.saveDialog(`Collage.${format}`, [
      { name: 'JPEG image', extensions: ['jpg'] },
      { name: 'PNG image', extensions: ['png'] }
    ])
    if (!target) return
    const fmt = /\.png$/i.test(target) ? 'png' : 'jpg'
    await withBusy('Creating collage…', async () => {
      const full = await Promise.all(files.map((f) => bitmap(f)))
      const c = new OffscreenCanvas(1, 1)
      const g = c.getContext('2d')!
      draw(g, full, options, bg, 1)
      const px = g.getImageData(0, 0, c.width, c.height)
      await platform.saveImage(target, fmt, c.width, c.height, px.data, 92)
      full.forEach((b) => b.close())
    })
    close()
    toast('Collage saved')
    if (platform.isTauri) await openFiles([target])
  }

  return (
    <Modal
      title="Create collage"
      wide
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={files.length < 2} onClick={() => void save()}>
            Save collage…
          </button>
        </>
      }
    >
      <div class="collage">
        <div class="collage-preview">{thumbs.length ? <canvas ref={preview} /> : <p class="muted">Add at least two images.</p>}</div>
        <div class="batch-options">
          <div class="batch-files-head">
            <span class="flyout-label">{files.length} {files.length === 1 ? 'image' : 'images'}</span>
            <button class="btn" onClick={() => void add()}>
              Add images…
            </button>
          </div>
          <label class="field">
            <span>Layout</span>
            <select value={layout} onChange={(e) => setLayout((e.target as HTMLSelectElement).value as 'rows' | 'grid')}>
              <option value="rows">Rows (whole photos)</option>
              <option value="grid">Grid (equal tiles)</option>
            </select>
          </label>
          {layout === 'grid' && (
            <label class="field">
              <span>Columns</span>
              <select value={columns} onChange={(e) => setColumns(Number((e.target as HTMLSelectElement).value))}>
                <option value={0}>Automatic</option>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label class="field">
            <span>Width</span>
            <select value={width} onChange={(e) => setWidth(Number((e.target as HTMLSelectElement).value))}>
              {[1080, 2000, 3000, 4000, 6000].map((w) => (
                <option key={w} value={w}>
                  {w} pixels
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Spacing</span>
            <select value={gap} onChange={(e) => setGap(Number((e.target as HTMLSelectElement).value))}>
              {[
                [0, 'None'],
                [8, 'Thin'],
                [16, 'Medium'],
                [40, 'Wide']
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Background</span>
            <select value={bg} onChange={(e) => setBg((e.target as HTMLSelectElement).value as Background)}>
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="transparent">Transparent (PNG)</option>
            </select>
          </label>
        </div>
      </div>
    </Modal>
  )
}
