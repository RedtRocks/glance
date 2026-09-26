import type { PageViewport } from 'pdfjs-dist'
import { NOTE_SIZE, headPath, outlinePath, type Markup, type Redaction } from '../../core/markup'
import { css } from '../../state/markupState'

const urls = new WeakMap<Uint8Array, string>()
function pngUrl(png: Uint8Array): string {
  let u = urls.get(png)
  if (!u) {
    u = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
    urls.set(png, u)
  }
  return u
}

/** One markup item drawn in PDF space (inside a group carrying the viewport transform). */
export function Shape({ m }: { m: Markup }) {
  const s = m.style
  switch (m.type) {
    case 'text':
      // Text boxes are HTML (see TextBox) so they wrap like the saved appearance.
      return s.fill || s.stroke ? (
        <path d={outlinePath({ ...m, type: 'rect' })} fill={css(s.fill)} stroke={css(s.stroke)} stroke-width={s.width} opacity={s.opacity} />
      ) : null
    case 'note': {
      const [x, y] = m.at
      return (
        <g class="markup-note">
          <rect x={x} y={y - NOTE_SIZE} width={NOTE_SIZE} height={NOTE_SIZE} rx={2} fill={css(s.fill ?? [1, 0.85, 0.2])} stroke="rgb(153,115,0)" stroke-width={0.8} />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${x + 4} ${y - 6 - i * 4}H${x + NOTE_SIZE - 4}`} stroke="rgb(115,90,0)" stroke-width={1} />
          ))}
        </g>
      )
    }
    case 'signature': {
      const [x1, y1, x2, y2] = m.rect
      return (
        <image href={pngUrl(m.png)} x={x1} y={y1} width={x2 - x1} height={y2 - y1} preserveAspectRatio="none" transform={`matrix(1 0 0 -1 0 ${y1 + y2})`} />
      )
    }
    case 'highlight':
      return <path d={outlinePath(m)} fill={css(s.stroke ?? [1, 0.85, 0.2])} opacity={s.opacity} />
    default: {
      const closed = ['rect', 'roundRect', 'oval', 'star', 'bubble'].includes(m.type) || (m.type === 'polygon' && m.closed)
      return (
        <g opacity={s.opacity}>
          <path
            d={outlinePath(m)}
            fill={closed ? css(s.fill) : 'none'}
            stroke={css(s.stroke)}
            stroke-width={s.width}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {m.type === 'arrow' && <path d={headPath(m)} fill={css(s.stroke)} />}
        </g>
      )
    }
  }
}

export function RedactionMark({ r, pattern }: { r: Redaction; pattern: string }) {
  const [x1, y1, x2, y2] = r.rect
  return <rect class="redaction-mark" x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill={`url(#${pattern})`} stroke="#c42b1c" stroke-width={1} />
}

/** CSS-pixel box of a PDF rect under a viewport (handles rotation). */
export function cssBox(vp: PageViewport, [x1, y1, x2, y2]: [number, number, number, number]) {
  const pts = [
    vp.convertToViewportPoint(x1, y1),
    vp.convertToViewportPoint(x2, y1),
    vp.convertToViewportPoint(x1, y2),
    vp.convertToViewportPoint(x2, y2)
  ] as [number, number][]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}
