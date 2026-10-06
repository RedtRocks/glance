import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { PageViewport } from 'pdfjs-dist'
import {
  bounds,
  fontStack,
  hitTest,
  newId,
  normRect,
  recognizeSketch,
  resize,
  translate,
  type Markup,
  type Pt,
  type Rect
} from '../../core/markup'
import type { MarkupHost } from '../../state/documents'
import {
  activeSignature,
  css,
  editingId,
  highlightColor,
  SHAPE_TOOLS,
  selectedId,
  setTool,
  signatureDialog,
  style,
  textStyle,
  tool,
  type Tool
} from '../../state/markupState'
import { RedactionMark, Shape, cssBox } from './Shape'
import { SelectionActions } from './SelectionActions'
import { t } from '../../i18n'

interface Props {
  doc: MarkupHost
  index: number
  vp: PageViewport
  /** Thumbnails render markup without interaction. */
  interactive?: boolean
}

type Drag =
  | { kind: 'move'; id: string; start: Pt; delta: Pt }
  | { kind: 'resize'; id: string; corner: 0 | 1 | 2 | 3; from: Rect; to: Rect }
  | { kind: 'endpoint'; id: string; end: 'from' | 'to'; at: Pt }

/** How far from markup a press still grabs it, in CSS pixels: a fingertip covers far more than a mouse pointer. */
const reach = (pointerType: string): number => (pointerType === 'mouse' ? 5 : 16)
const handleReach = (pointerType: string): number => (pointerType === 'mouse' ? 8 : 22)
/** Bigger handles where fingers do the grabbing. */
const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const DRAW_TOOLS = new Set<Tool>([...SHAPE_TOOLS, 'sketch', 'draw', 'text', 'note', 'signature', 'redact', 'loupe'])

function base(page: number) {
  return { id: newId(), page, style: { ...style.peek() }, created: Date.now() }
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function sigAspect(png: Uint8Array): number {
  // PNG IHDR: width at 16, height at 20 (big-endian).
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const w = dv.getUint32(16)
  const h = dv.getUint32(20)
  return w && h ? h / w : 0.4
}

export function MarkupLayer({ doc, index, vp, interactive = true }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const all = doc.markup.value
  const items = useMemo(() => all.filter((m) => m.page === index), [all, index])
  const reds = doc.redactions.value.filter((r) => r.page === index)
  const current = tool.value
  const sel = selectedId.value
  const [draft, setDraft] = useState<Markup | null>(null)
  const [draftRedaction, setDraftRedaction] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const poly = useRef<Pt[]>([])
  const pattern = `hatch-${doc.id}-${index}`

  const toPdf = (clientX: number, clientY: number): Pt => {
    const r = host.current!.getBoundingClientRect()
    const [x, y] = vp.convertToPdfPoint(clientX - r.left, clientY - r.top)
    return [x, y]
  }
  const tol = 5 / vp.scale

  const commit = (label: string, next: Markup[]): void => doc.edit(label, { markup: next })
  const addMarkup = (m: Markup, label: string): void => {
    commit(label, [...doc.markup.peek(), m])
    selectedId.value = m.id
  }

  // ---------------- Select tool: grab markup, or let the text layer have the event.
  useEffect(() => {
    const page = host.current?.parentElement
    if (!interactive || !page || current !== 'select') return
    const ignored = (target: EventTarget | null): boolean =>
      !!(target as HTMLElement | null)?.closest?.('textarea, .markup-actions, .annotationLayer input, .annotationLayer select, .annotationLayer textarea')
    /** The handle or markup under a press, handles of the selected item first. */
    const grab = (cx: number, cy: number, pointerType: string): { handle: Drag } | { hit: Markup } | null => {
      const list = doc.markup.peek().filter((m) => m.page === index)
      const selected = list.find((m) => m.id === selectedId.peek())
      const handle = selected && handleAt(selected, cx, cy, handleReach(pointerType))
      if (handle) return { handle }
      const hit = markupAt(cx, cy, pointerType)
      return hit ? { hit } : null
    }
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || ignored(e.target)) return
      const pt = toPdf(e.clientX, e.clientY)
      const found = grab(e.clientX, e.clientY, e.pointerType)
      if (found && 'handle' in found) {
        e.preventDefault()
        e.stopPropagation()
        setDrag(found.handle)
        return
      }
      const hit = found?.hit
      if (!hit) {
        if (selectedId.peek()) selectedId.value = null
        return
      }
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      selectedId.value = hit.id
      if (e.detail >= 2 && (hit.type === 'text' || hit.type === 'note')) {
        editingId.value = hit.id
        return
      }
      setDrag({ kind: 'move', id: hit.id, start: pt, delta: [0, 0] })
    }
    // A finger on markup moves it; anywhere else it scrolls the document as usual.
    // Pointer events can't stop the browser panning, so the touch itself is cancelled.
    const onTouch = (e: TouchEvent): void => {
      const touch = e.touches[0]
      if (e.touches.length !== 1 || !e.cancelable || ignored(e.target)) return
      if (!grab(touch.clientX, touch.clientY, 'touch')) return
      e.preventDefault()
      // Nor is it a tap for the view's double-tap zoom.
      e.stopPropagation()
    }
    page.addEventListener('pointerdown', onDown, true)
    page.addEventListener('touchstart', onTouch, { capture: true, passive: false })
    return () => {
      page.removeEventListener('pointerdown', onDown, true)
      page.removeEventListener('touchstart', onTouch, true)
    }
  }, [current, vp, index, interactive])

  /** The topmost markup on this page under a point, allowing for the pointer's size. */
  function markupAt(cx: number, cy: number, pointerType: string): Markup | undefined {
    const pt = toPdf(cx, cy)
    const list = doc.markup.peek().filter((m) => m.page === index)
    return [...list].reverse().find((m) => hitTest(m, pt, reach(pointerType) / vp.scale))
  }

  function handleAt(m: Markup, cx: number, cy: number, radius = 8): Drag | null {
    const r = host.current!.getBoundingClientRect()
    const near = (p: Pt): boolean => {
      const [x, y] = vp.convertToViewportPoint(p[0], p[1])
      return Math.hypot(cx - r.left - x, cy - r.top - y) <= radius
    }
    if (m.type === 'line' || m.type === 'arrow') {
      if (near(m.to)) return { kind: 'endpoint', id: m.id, end: 'to', at: m.to }
      if (near(m.from)) return { kind: 'endpoint', id: m.id, end: 'from', at: m.from }
      return null
    }
    if (!resizable(m)) return null
    const b = bounds(m)
    const corners: Pt[] = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]
    const i = corners.findIndex(near)
    return i >= 0 ? { kind: 'resize', id: m.id, corner: i as 0 | 1 | 2 | 3, from: b, to: b } : null
  }

  // Drag tracking for move/resize (window-level so it survives leaving the page).
  // A layout effect, so a quick tap's pointerup can't arrive before it is listening.
  useLayoutEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent): void => {
      const pt = toPdf(e.clientX, e.clientY)
      setDrag((d) => {
        if (!d) return d
        if (d.kind === 'move') return { ...d, delta: [pt[0] - d.start[0], pt[1] - d.start[1]] }
        if (d.kind === 'endpoint') return { ...d, at: pt }
        const opposite: Pt = [[d.from[2], d.from[3]], [d.from[0], d.from[3]], [d.from[0], d.from[1]], [d.from[2], d.from[1]]][d.corner] as Pt
        return { ...d, to: normRect(opposite, pt) }
      })
    }
    const up = (): void => {
      setDrag((d) => {
        if (d) {
          const list = doc.markup.peek()
          const next = list.map((m) => (m.id === d.id ? applyDrag(m, d) : m))
          const changed = next.some((m, i) => m !== list[i] && JSON.stringify(bounds(m)) !== JSON.stringify(bounds(list[i])))
          if (changed) commit(d.kind === 'move' ? 'Move' : 'Resize', next)
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag?.kind, drag?.id])

  // ---------------- Drawing tools
  const drawing = interactive && (DRAW_TOOLS.has(current) || current === 'polygon')
  const onPointerDown = (e: PointerEvent): void => {
    if (!interactive || e.button !== 0 || !drawing) return
    e.preventDefault()
    const start = toPdf(e.clientX, e.clientY)
    const t = current

    if (t === 'polygon') {
      const pts = poly.current
      const first = pts[0]
      const closing = first && pts.length > 2 && Math.hypot(start[0] - first[0], start[1] - first[1]) < tol * 2
      if (e.detail >= 2 || closing) {
        if (pts.length >= 2) addMarkup({ ...base(index), type: 'polygon', points: [...pts], closed: !!closing || pts.length > 2 }, 'Add Polygon')
        poly.current = []
        setDraft(null)
        return
      }
      pts.push(start)
      setDraft({ ...base(index), type: 'polygon', points: [...pts, start], closed: false })
      return
    }
    if (t === 'text') {
      const fs = textStyle.peek()
      const m: Markup = { ...base(index), style: { ...style.peek(), stroke: null, fill: null }, type: 'text', rect: [start[0], start[1] - fs.fontSize * 3, start[0] + 220, start[1]], text: '', fontSize: fs.fontSize, color: fs.color, ...(fs.font ? { font: fs.font } : {}) }
      addMarkup(m, 'Add Text Box')
      setTool('select') // clears editing state, so start editing after
      editingId.value = m.id
      return
    }
    if (t === 'note') {
      const m: Markup = { ...base(index), style: { ...style.peek(), fill: highlightColor.peek() }, type: 'note', at: start, text: '' }
      addMarkup(m, 'Add Note')
      setTool('select')
      editingId.value = m.id
      return
    }
    if (t === 'signature') {
      const sig = activeSignature.peek()
      if (!sig) {
        signatureDialog.value = true
        return
      }
      const png = b64ToBytes(sig.png)
      const w = 150
      const h = w * sigAspect(png)
      addMarkup({ ...base(index), type: 'signature', rect: [start[0] - w / 2, start[1] - h / 2, start[0] + w / 2, start[1] + h / 2], png }, 'Add Signature')
      setTool('select')
      return
    }

    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const points: Pt[] = [start]
    const mk = (end: Pt): Markup | null => {
      switch (t) {
        case 'line':
        case 'arrow':
          return { ...base(index), type: t, from: start, to: end }
        case 'sketch':
        case 'draw':
          return { ...base(index), type: 'ink', strokes: [[...points]] }
        case 'redact':
          return null
        case 'loupe': {
          const r = Math.hypot(end[0] - start[0], end[1] - start[1])
          return { ...base(index), style: { ...style.peek(), stroke: [0.2, 0.2, 0.2], width: 3 }, type: 'loupe', rect: [start[0] - r, start[1] - r, start[0] + r, start[1] + r], zoom: 2 }
        }
        default:
          return { ...base(index), type: t as 'rect', rect: normRect(start, end) }
      }
    }
    const move = (ev: PointerEvent): void => {
      const pt = toPdf(ev.clientX, ev.clientY)
      if (t === 'redact') {
        setDraftRedaction(normRect(start, pt))
        return
      }
      if (t === 'sketch' || t === 'draw') points.push(pt)
      setDraft(mk(pt))
    }
    const up = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      const end = toPdf(ev.clientX, ev.clientY)
      setDraft(null)
      setDraftRedaction(null)
      const tiny = Math.hypot(end[0] - start[0], end[1] - start[1]) < 4 / vp.scale
      // A finger tapping existing markup picks it up rather than dropping a dot or a shape on it.
      const tapped = tiny && ev.pointerType !== 'mouse' ? markupAt(ev.clientX, ev.clientY, ev.pointerType) : undefined
      if (tapped) {
        setTool('select')
        selectedId.value = tapped.id
        return
      }
      if (t === 'redact') {
        if (!tiny) doc.edit('Mark for Redaction', { redactions: [...doc.redactions.peek(), { id: newId('redact'), page: index, rect: normRect(start, end) }] })
        return
      }
      if (t === 'sketch' || t === 'draw') {
        points.push(end)
        if (points.length < 2) return
        if (t === 'sketch') {
          const shape = recognizeSketch(points)
          if (shape) {
            addMarkup({ ...base(index), ...shape } as Markup, 'Sketch')
            return
          }
        }
        addMarkup({ ...base(index), type: 'ink', strokes: [points] }, t === 'sketch' ? 'Sketch' : 'Draw')
        return
      }
      // A plain click drops a default-sized shape, like Preview.
      const m = tiny && t === 'loupe'
        ? { ...base(index), style: { ...style.peek(), stroke: [0.2, 0.2, 0.2] as [number, number, number], width: 3 }, type: 'loupe' as const, rect: [start[0] - 60, start[1] - 60, start[0] + 60, start[1] + 60] as Rect, zoom: 2 }
        : tiny
        ? t === 'line' || t === 'arrow'
          ? { ...base(index), type: t, from: start, to: [start[0] + 100, start[1]] as Pt }
          : { ...base(index), type: t as 'rect', rect: [start[0] - 50, start[1] - 35, start[0] + 50, start[1] + 35] as Rect }
        : mk(end)
      if (m) {
        addMarkup(m as Markup, 'Add Shape')
        setTool('select')
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (current === 'polygon' && poly.current.length) {
      const pt = toPdf(e.clientX, e.clientY)
      setDraft({ ...base(index), type: 'polygon', points: [...poly.current, pt], closed: false })
    }
  }

  useEffect(() => {
    poly.current = []
    setDraft(null)
  }, [current])

  const shown = (m: Markup): Markup => (drag && drag.id === m.id ? applyDrag(m, drag) : m)
  const selected = items.find((m) => m.id === sel)
  const w = Math.round(vp.width)
  const h = Math.round(vp.height)

  const marks = items.filter((m) => m.type === 'highlight')
  return (
    <>
    {/* Highlights sit outside the overlay's stacking context so they multiply
        with the page itself and the text underneath stays readable. */}
    {marks.length > 0 && (
      <svg width={w} height={h} class="highlight-layer" aria-hidden="true">
        <g transform={`matrix(${vp.transform.join(' ')})`}>
          {marks.map((m) => (
            <Shape key={m.id} m={shown(m)} />
          ))}
        </g>
      </svg>
    )}
    <div
      ref={host}
      class={`markup-layer ${drawing ? 'drawing' : ''} tool-${current}`}
      style={{ width: w, height: h, pointerEvents: interactive && drawing ? 'auto' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <svg width={w} height={h} class="markup-svg" aria-hidden="true">
        <defs>
          <pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="rgba(196,43,28,0.12)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(196,43,28,0.55)" stroke-width="2" />
          </pattern>
        </defs>
        <g transform={`matrix(${vp.transform.join(' ')})`}>
          {items.map((m) => (m.type === 'highlight' ? null : <Shape key={m.id} m={shown(m)} />))}
          {reds.map((r) => (
            <RedactionMark key={r.id} r={r} pattern={pattern} />
          ))}
          {draftRedaction && <RedactionMark r={{ id: 'draft', page: index, rect: draftRedaction }} pattern={pattern} />}
          {draft && <Shape m={draft} />}
        </g>
        {interactive && selected && <Selection m={shown(selected)} vp={vp} big={coarse()} />}
      </svg>
      {interactive && selected && !drag && editingId.value !== selected.id && <SelectionActions doc={doc} m={selected} vp={vp} />}
      {items
        .filter((m): m is Extract<Markup, { type: 'text' }> => m.type === 'text')
        .map((m) => (
          <TextBox key={m.id} doc={doc} m={shown(m) as typeof m} vp={vp} editing={interactive && editingId.value === m.id} />
        ))}
      {interactive &&
        items
          .filter((m): m is Extract<Markup, { type: 'note' }> => m.type === 'note' && editingId.value === m.id)
          .map((m) => <NoteEditor key={m.id} doc={doc} m={m} vp={vp} />)}
    </div>
    </>
  )
}

function resizable(m: Markup): boolean {
  return !['note', 'highlight', 'underline', 'strike', 'squiggly'].includes(m.type)
}

function applyDrag(m: Markup, d: Drag): Markup {
  if (d.kind === 'move') return translate(m, d.delta[0], d.delta[1])
  if (d.kind === 'endpoint' && (m.type === 'line' || m.type === 'arrow')) return { ...m, [d.end]: d.at }
  if (d.kind === 'resize') return resize(m, d.from, d.to)
  return m
}

function Selection({ m, vp, big }: { m: Markup; vp: PageViewport; big: boolean }) {
  const r = big ? 8 : 4
  if (m.type === 'line' || m.type === 'arrow') {
    return (
      <g class="selection">
        {[m.from, m.to].map((p, i) => {
          const [x, y] = vp.convertToViewportPoint(p[0], p[1])
          return <circle key={i} class="handle" cx={x} cy={y} r={r + 1} />
        })}
      </g>
    )
  }
  const b = cssBox(vp, bounds(m))
  const pad = 4
  return (
    <g class="selection">
      <rect class="selection-box" x={b.left - pad} y={b.top - pad} width={b.right - b.left + pad * 2} height={b.bottom - b.top + pad * 2} />
      {resizable(m) &&
        (
          [
            [b.left - pad, b.top - pad],
            [b.right + pad, b.top - pad],
            [b.left - pad, b.bottom + pad],
            [b.right + pad, b.bottom + pad]
          ] as Pt[]
        ).map(([x, y], i) => <rect key={i} class="handle" x={x - r} y={y - r} width={r * 2} height={r * 2} rx={big ? r : 2} />)}
    </g>
  )
}

/** Text boxes are HTML so they wrap like the saved appearance; editing happens in place. */
function TextBox({ doc, m, vp, editing }: { doc: MarkupHost; m: Extract<Markup, { type: 'text' }>; vp: PageViewport; editing: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [x, y] = vp.convertToViewportPoint(m.rect[0], m.rect[3])
  const s = vp.scale
  const boxStyle = {
    left: x,
    top: y,
    width: (m.rect[2] - m.rect[0]) * s,
    height: (m.rect[3] - m.rect[1]) * s,
    transform: `rotate(${vp.rotation}deg)`,
    font: `${m.fontSize * s}px/1.2 ${fontStack(m.font)}`,
    padding: 4 * s,
    color: css(m.color)
  }
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  if (editing) {
    return (
      <textarea
        ref={ref}
        class="text-box editing"
        autoFocus
        style={boxStyle}
        placeholder={t('Type here')}
        defaultValue={m.text}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          e.stopPropagation()
        }}
        onBlur={(e) => {
          const text = (e.target as HTMLTextAreaElement).value
          editingId.value = null
          const list = doc.markup.peek()
          if (!text.trim()) doc.edit('Delete Text Box', { markup: list.filter((i) => i.id !== m.id) })
          else if (text !== m.text) doc.edit('Edit Text', { markup: list.map((i) => (i.id === m.id ? { ...m, text } : i)) })
        }}
      />
    )
  }
  return (
    <div class="text-box" style={boxStyle}>
      {m.text}
    </div>
  )
}

function NoteEditor({ doc, m, vp }: { doc: MarkupHost; m: Extract<Markup, { type: 'note' }>; vp: PageViewport }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [x, y] = vp.convertToViewportPoint(m.at[0], m.at[1])
  useEffect(() => ref.current?.focus(), [])
  return (
    <div class="note-editor" style={{ left: x + 26, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        autoFocus
        placeholder={t('Add a note')}
        defaultValue={m.text}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          e.stopPropagation()
        }}
        onBlur={(e) => {
          const text = (e.target as HTMLTextAreaElement).value
          editingId.value = null
          const list = doc.markup.peek()
          if (!text.trim() && !m.text) doc.edit('Delete Note', { markup: list.filter((i) => i.id !== m.id) })
          else if (text !== m.text) doc.edit('Edit Note', { markup: list.map((i) => (i.id === m.id ? { ...m, text } : i)) })
        }}
      />
    </div>
  )
}
