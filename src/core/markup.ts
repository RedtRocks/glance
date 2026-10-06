/**
 * Markup (see CONTEXT.md): everything the user draws on a document.
 *
 * Geometry lives in unrotated PDF user space (points, y up), so it survives zooming
 * and page rotation, and maps 1:1 onto the PDF annotations it is saved as (ADR 0003).
 */

import { applyAffine, type Affine } from './image/transform'

export type Pt = [number, number]
/** [x1, y1, x2, y2], normalized so x1 <= x2 and y1 <= y2. */
export type Rect = [number, number, number, number]
/** RGB, each 0..1. */
export type Color = [number, number, number]

export interface Style {
  stroke: Color | null
  fill: Color | null
  width: number
  opacity: number
}

interface Base {
  id: string
  page: number
  style: Style
  /** Optional comment text shown in Highlights & Notes. */
  contents?: string
  created: number
}

export type ShapeKind = 'rect' | 'roundRect' | 'oval' | 'star' | 'bubble'

export type Markup =
  | (Base & { type: ShapeKind; rect: Rect })
  | (Base & { type: 'line' | 'arrow'; from: Pt; to: Pt })
  | (Base & { type: 'polygon'; points: Pt[]; closed: boolean })
  | (Base & { type: 'ink'; strokes: Pt[][] })
  | (Base & {
      type: 'text'
      rect: Rect
      text: string
      fontSize: number
      color: Color
      /** System font family; Helvetica when absent. */
      font?: string
      bold?: boolean
      italic?: boolean
      /** Set by AI edits to match the page: line spacing (a multiple of fontSize, default 1.2), */
      lineHeight?: number
      /** where the first baseline sits below the top (a multiple of fontSize; absent: classic layout), */
      ascent?: number
      /** and the text's left inset in points (default 4). */
      inset?: number
    })
  | (Base & { type: 'note'; at: Pt; text: string })
  /** Quads: [x1,y1 (top-left), x2,y2 (top-right), x3,y3 (bottom-left), x4,y4 (bottom-right)]. */
  | (Base & { type: 'highlight' | 'underline' | 'strike' | 'squiggly'; quads: number[][]; text?: string })
  /** `patch`: background filled in by an AI edit to hide what was there, not a signature. */
  | (Base & { type: 'signature'; rect: Rect; png: Uint8Array; patch?: boolean })
  /** Magnifying circle over an image (images only; flattened on save). */
  | (Base & { type: 'loupe'; rect: Rect; zoom: number })

export type MarkupType = Markup['type']

/** Info-dictionary key marking files that contain Glance markup (see core/annotations). */
export const MARKER_KEY = 'GlanceMarkup'

export interface Redaction {
  id: string
  page: number
  rect: Rect
}

let seq = 0
export function newId(prefix = 'glance'): string {
  seq = (seq + 1) % 1_000_000
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

export const COLORS = {
  red: [0.867, 0.184, 0.161] as Color,
  orange: [0.969, 0.573, 0.118] as Color,
  yellow: [1, 0.851, 0.2] as Color,
  green: [0.2, 0.678, 0.314] as Color,
  blue: [0.078, 0.451, 0.878] as Color,
  purple: [0.58, 0.29, 0.8] as Color,
  black: [0, 0, 0] as Color,
  white: [1, 1, 1] as Color
}

/** CSS font stack for a text box's family (Helvetica is the PDF standard font). */
export function fontStack(font?: string): string {
  return font ? `"${font.replace(/"/g, '')}", Helvetica, Arial, sans-serif` : 'Helvetica, Arial, sans-serif'
}

export type TextMarkup = Extract<Markup, { type: 'text' }>

/** How a text box lays out its lines, shared by the page view, image export and PDF save. */
export function textBoxLayout(m: TextMarkup): { inset: number; lineHeight: number; /** First baseline below the top, in points; null for the classic top-aligned layout. */ baseline: number | null; font: string } {
  return {
    inset: m.inset ?? 4,
    lineHeight: (m.lineHeight ?? 1.2) * m.fontSize,
    baseline: m.ascent === undefined ? null : m.ascent * m.fontSize,
    font: `${m.italic ? 'italic ' : ''}${m.bold ? 'bold ' : ''}${m.fontSize}px ${fontStack(m.font)}`
  }
}

export const DEFAULT_STYLE: Style = { stroke: COLORS.red, fill: null, width: 2, opacity: 1 }

export function normRect(a: Pt, b: Pt): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

export function rectUnion(rects: Rect[]): Rect {
  return rects.reduce<Rect>(
    (u, r) => [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])],
    [Infinity, Infinity, -Infinity, -Infinity]
  )
}

function pointsRect(points: Pt[]): Rect {
  return rectUnion(points.map(([x, y]) => [x, y, x, y] as Rect))
}

function quadRect(q: number[]): Rect {
  const xs = [q[0], q[2], q[4], q[6]]
  const ys = [q[1], q[3], q[5], q[7]]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export const NOTE_SIZE = 20

export function arrowHeadSize(width: number): number {
  return Math.max(8, width * 4)
}

/** Geometric bounds (without stroke padding). */
export function bounds(m: Markup): Rect {
  switch (m.type) {
    case 'line':
    case 'arrow':
      return normRect(m.from, m.to)
    case 'polygon':
      return pointsRect(m.points)
    case 'ink':
      return pointsRect(m.strokes.flat())
    case 'note':
      return [m.at[0], m.at[1] - NOTE_SIZE, m.at[0] + NOTE_SIZE, m.at[1]]
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strike':
      return rectUnion(m.quads.map(quadRect))
    default:
      return m.rect
  }
}

/** Bounds including stroke width and arrowheads: the annotation /Rect and appearance BBox. */
export function paintBounds(m: Markup): Rect {
  const b = bounds(m)
  let pad = (m.style.width || 0) / 2 + 1
  if (m.type === 'arrow') pad += arrowHeadSize(m.style.width)
  if (m.type === 'bubble') pad += 0
  const r: Rect = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]
  if (m.type === 'bubble') r[1] -= (b[3] - b[1]) * 0.3 // tail
  return r
}

// ---------------------------------------------------------------------------
// Geometry as SVG path data in PDF space. Used verbatim by the on-screen overlay
// (inside a group carrying the viewport transform) and by the appearance streams.

const K = 0.5522847498 // cubic Bézier circle constant
const f = (n: number): string => (Math.round(n * 100) / 100).toString()

function ellipsePath([x1, y1, x2, y2]: Rect): string {
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const rx = (x2 - x1) / 2
  const ry = (y2 - y1) / 2
  const ox = rx * K
  const oy = ry * K
  return [
    `M${f(cx + rx)} ${f(cy)}`,
    `C${f(cx + rx)} ${f(cy + oy)} ${f(cx + ox)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
    `C${f(cx - ox)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + oy)} ${f(cx - rx)} ${f(cy)}`,
    `C${f(cx - rx)} ${f(cy - oy)} ${f(cx - ox)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}`,
    `C${f(cx + ox)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - oy)} ${f(cx + rx)} ${f(cy)}Z`
  ].join('')
}

function roundRectPath([x1, y1, x2, y2]: Rect, radius?: number): string {
  const r = Math.min(radius ?? Math.min(x2 - x1, y2 - y1) * 0.18, (x2 - x1) / 2, (y2 - y1) / 2)
  const o = r * (1 - K)
  return [
    `M${f(x1 + r)} ${f(y1)}H${f(x2 - r)}`,
    `C${f(x2 - o)} ${f(y1)} ${f(x2)} ${f(y1 + o)} ${f(x2)} ${f(y1 + r)}`,
    `V${f(y2 - r)}`,
    `C${f(x2)} ${f(y2 - o)} ${f(x2 - o)} ${f(y2)} ${f(x2 - r)} ${f(y2)}`,
    `H${f(x1 + r)}`,
    `C${f(x1 + o)} ${f(y2)} ${f(x1)} ${f(y2 - o)} ${f(x1)} ${f(y2 - r)}`,
    `V${f(y1 + r)}`,
    `C${f(x1)} ${f(y1 + o)} ${f(x1 + o)} ${f(y1)} ${f(x1 + r)} ${f(y1)}Z`
  ].join('')
}

export function starPoints([x1, y1, x2, y2]: Rect, points = 5, inner = 0.42): Pt[] {
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const rx = (x2 - x1) / 2
  const ry = (y2 - y1) / 2
  const out: Pt[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points
    const k = i % 2 ? inner : 1
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
  }
  return out
}

function polyPath(points: Pt[], closed: boolean): string {
  if (!points.length) return ''
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (closed ? 'Z' : '')
}

/** Smooth freehand stroke: quadratic curves through midpoints. */
function strokePath(points: Pt[]): string {
  if (points.length < 3) return polyPath(points.length === 1 ? [points[0], points[0]] : points, false)
  let d = `M${f(points[0][0])} ${f(points[0][1])}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`
  }
  const last = points[points.length - 1]
  return d + `L${f(last[0])} ${f(last[1])}`
}

function bubblePath([x1, y1, x2, y2]: Rect): string {
  const w = x2 - x1
  const h = y2 - y1
  const r = Math.min(w, h) * 0.25
  const o = r * (1 - K)
  const tailX = x1 + w * 0.22
  const tailW = w * 0.14
  const tailY = y1 - h * 0.3
  return [
    `M${f(x1 + r)} ${f(y1)}`,
    `H${f(tailX)}L${f(tailX - w * 0.08)} ${f(tailY)}L${f(tailX + tailW)} ${f(y1)}`,
    `H${f(x2 - r)}`,
    `C${f(x2 - o)} ${f(y1)} ${f(x2)} ${f(y1 + o)} ${f(x2)} ${f(y1 + r)}`,
    `V${f(y2 - r)}`,
    `C${f(x2)} ${f(y2 - o)} ${f(x2 - o)} ${f(y2)} ${f(x2 - r)} ${f(y2)}`,
    `H${f(x1 + r)}`,
    `C${f(x1 + o)} ${f(y2)} ${f(x1)} ${f(y2 - o)} ${f(x1)} ${f(y2 - r)}`,
    `V${f(y1 + r)}`,
    `C${f(x1)} ${f(y1 + o)} ${f(x1 + o)} ${f(y1)} ${f(x1 + r)} ${f(y1)}Z`
  ].join('')
}

export function arrowHead(from: Pt, to: Pt, width: number): Pt[] {
  const size = arrowHeadSize(width)
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0])
  const spread = Math.PI / 7
  return [
    to,
    [to[0] - size * Math.cos(ang - spread), to[1] - size * Math.sin(ang - spread)],
    [to[0] - size * Math.cos(ang + spread), to[1] - size * Math.sin(ang + spread)]
  ]
}

/** Stroked/filled outline of a markup; empty for image- and text-only types. */
export function outlinePath(m: Markup): string {
  switch (m.type) {
    case 'rect':
      return polyPath([[m.rect[0], m.rect[1]], [m.rect[2], m.rect[1]], [m.rect[2], m.rect[3]], [m.rect[0], m.rect[3]]], true)
    case 'roundRect':
      return roundRectPath(m.rect)
    case 'oval':
    case 'loupe':
      return ellipsePath(m.rect)
    case 'star':
      return polyPath(starPoints(m.rect), true)
    case 'bubble':
      return bubblePath(m.rect)
    case 'line':
      return polyPath([m.from, m.to], false)
    case 'arrow': {
      // Stop the shaft inside the head so thick lines don't poke through the tip.
      const head = arrowHead(m.from, m.to, m.style.width)
      const base: Pt = [(head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2]
      return polyPath([m.from, base], false)
    }
    case 'polygon':
      return polyPath(m.points, m.closed)
    case 'ink':
      return m.strokes.map(strokePath).join('')
    case 'underline':
      return m.quads.map((q) => polyPath([[q[4], q[5] + 0.5], [q[6], q[7] + 0.5]], false)).join('')
    case 'squiggly':
      return m.quads.map((q) => squigglePath([q[4], q[5]], [q[6], q[7]], Math.hypot(q[0] - q[4], q[1] - q[5]))).join('')
    case 'strike':
      return m.quads
        .map((q) => polyPath([[q[4], (q[5] + q[1]) / 2], [q[6], (q[7] + q[3]) / 2]], false))
        .join('')
    case 'highlight':
      return m.quads.map((q) => polyPath([[q[4], q[5]], [q[6], q[7]], [q[2], q[3]], [q[0], q[1]]], true)).join('')
    default:
      return ''
  }
}

/** Zig-zag just under a text baseline, sized from the line height (PDF /Squiggly). */
function squigglePath(a: Pt, b: Pt, height: number): string {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!len) return ''
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  const amp = Math.max(0.8, height * 0.07)
  const step = Math.max(1.5, height * 0.18)
  const pts: Pt[] = []
  for (let t = 0, i = 0; t <= len + 1e-6; t = Math.min(len, t + step), i++) {
    const off = (i % 2 ? -amp : amp) - amp // stay below the baseline
    pts.push([a[0] + ux * t - uy * off, a[1] + uy * t + ux * off])
    if (t === len) break
  }
  return polyPath(pts, false)
}

/** Filled arrowhead (arrows only). */
export function headPath(m: Markup): string {
  return m.type === 'arrow' ? polyPath(arrowHead(m.from, m.to, m.style.width), true) : ''
}

// ---------------------------------------------------------------------------
// Editing

export function translate(m: Markup, dx: number, dy: number): Markup {
  const p = ([x, y]: Pt): Pt => [x + dx, y + dy]
  const r = (q: Rect): Rect => [q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy]
  switch (m.type) {
    case 'line':
    case 'arrow':
      return { ...m, from: p(m.from), to: p(m.to) }
    case 'polygon':
      return { ...m, points: m.points.map(p) }
    case 'ink':
      return { ...m, strokes: m.strokes.map((s) => s.map(p)) }
    case 'note':
      return { ...m, at: p(m.at) }
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strike':
      return { ...m, quads: m.quads.map((q) => q.map((v, i) => v + (i % 2 ? dy : dx))) }
    default:
      return { ...m, rect: r(m.rect) }
  }
}

/** Maps a markup's geometry from one bounding box to another (resize handles). */
export function resize(m: Markup, from: Rect, to: Rect): Markup {
  const sx = (to[2] - to[0]) / Math.max(1e-6, from[2] - from[0])
  const sy = (to[3] - to[1]) / Math.max(1e-6, from[3] - from[1])
  const p = ([x, y]: Pt): Pt => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy]
  switch (m.type) {
    case 'line':
    case 'arrow':
      return { ...m, from: p(m.from), to: p(m.to) }
    case 'polygon':
      return { ...m, points: m.points.map(p) }
    case 'ink':
      return { ...m, strokes: m.strokes.map((s) => s.map(p)) }
    case 'note':
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strike':
      return m // fixed-size / text-bound markup doesn't resize
    default: {
      const a = p([m.rect[0], m.rect[1]])
      const b = p([m.rect[2], m.rect[3]])
      return { ...m, rect: normRect(a, b) }
    }
  }
}

function distToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Hit test in PDF space with a tolerance in points. */
export function hitTest(m: Markup, pt: Pt, tol: number): boolean {
  const b = bounds(m)
  const inBox = pt[0] >= b[0] - tol && pt[0] <= b[2] + tol && pt[1] >= b[1] - tol && pt[1] <= b[3] + tol
  if (!inBox) return false
  const t = tol + m.style.width / 2
  switch (m.type) {
    case 'line':
    case 'arrow':
      return distToSegment(pt, m.from, m.to) <= t
    case 'ink':
      return m.strokes.some((s) => s.some((q, i) => i > 0 && distToSegment(pt, s[i - 1], q) <= t) || (s.length === 1 && Math.hypot(pt[0] - s[0][0], pt[1] - s[0][1]) <= t))
    case 'polygon': {
      const pts = m.closed ? [...m.points, m.points[0]] : m.points
      return pts.some((q, i) => i > 0 && distToSegment(pt, pts[i - 1], q) <= t)
    }
    case 'rect':
    case 'roundRect':
    case 'oval':
    case 'star':
    case 'bubble':
      if (m.style.fill) return true
      // Unfilled shapes are only grabbable near their outline, so text beneath stays selectable.
      return !(pt[0] > b[0] + t && pt[0] < b[2] - t && pt[1] > b[1] + t && pt[1] < b[3] - t)
    default:
      return true
  }
}

// ---------------------------------------------------------------------------
// Keeping markup attached to the right page through page operations.

/** Maps old page index → new page index (null = page deleted). */
export type PageMap = (oldIndex: number) => number | null

export function remapPages<T extends { page: number }>(items: T[], map: PageMap): T[] {
  const out: T[] = []
  for (const it of items) {
    const p = map(it.page)
    if (p !== null) out.push(p === it.page ? it : { ...it, page: p })
  }
  return out
}

export const pageMaps = {
  /** order[i] = old index of new page i */
  reorder(order: number[]): PageMap {
    const inv = new Map(order.map((old, i) => [old, i]))
    return (p) => inv.get(p) ?? null
  },
  delete(deleted: number[]): PageMap {
    const gone = new Set(deleted)
    const sorted = [...gone].sort((a, b) => a - b)
    return (p) => (gone.has(p) ? null : p - sorted.filter((d) => d < p).length)
  },
  insert(at: number, count: number): PageMap {
    return (p) => (p >= at ? p + count : p)
  }
}

// ---------------------------------------------------------------------------
// Sketch: Preview turns rough drawings into clean shapes.

export type Recognized =
  | { type: 'line'; from: Pt; to: Pt }
  | { type: 'rect' | 'oval'; rect: Rect }
  | null

export function recognizeSketch(stroke: Pt[]): Recognized {
  if (stroke.length < 4) return null
  const b = pointsRect(stroke)
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  const diag = Math.hypot(w, h)
  if (diag < 8) return null
  const first = stroke[0]
  const last = stroke[stroke.length - 1]
  const gap = Math.hypot(last[0] - first[0], last[1] - first[1])

  if (gap > diag * 0.35) {
    // Open stroke: a line if every point hugs the chord.
    const len = Math.hypot(last[0] - first[0], last[1] - first[1])
    const maxDev = Math.max(...stroke.map((q) => distToSegment(q, first, last)))
    return maxDev < Math.max(3, len * 0.06) ? { type: 'line', from: first, to: last } : null
  }

  // Closed stroke: compare against an ellipse and a rectangle inscribed in the bounds.
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  const rx = w / 2 || 1
  const ry = h / 2 || 1
  const ellipseErr =
    stroke.reduce((s, [x, y]) => s + Math.abs(Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) - 1), 0) / stroke.length
  const edgeTol = Math.min(w, h) * 0.12 + 2
  const nearEdge =
    stroke.filter(([x, y]) => Math.min(Math.abs(x - b[0]), Math.abs(x - b[2]), Math.abs(y - b[1]), Math.abs(y - b[3])) <= edgeTol)
      .length / stroke.length
  // Rectangles hug the box edges and have corners (far from the ellipse); ovals don't.
  const corners = stroke.filter(([x, y]) => Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) > 1.2).length / stroke.length
  if (nearEdge > 0.85 && corners > 0.08) return { type: 'rect', rect: b }
  if (ellipseErr < 0.12) return { type: 'oval', rect: b }
  return null
}

// ---------------------------------------------------------------------------
// Image transforms (rotate, flip, straighten, crop, resize) carry markup along

/**
 * Converts an image pixel-space map (y down, see core/image/transform) into the
 * equivalent map on markup space (y up), given the image heights before and after.
 */
export function markupAffine([a, b, c, d, e, f]: Affine, hIn: number, hOut: number): Affine {
  return [a, -b, -c, d, c * hIn + e, hOut - d * hIn - f]
}

const EPS = 1e-9

/** True when the map keeps axis-aligned rectangles axis-aligned (90° turns, flips, scaling). */
function axisAligned([a, b, c, d]: Affine): boolean {
  return (Math.abs(b) < EPS && Math.abs(c) < EPS) || (Math.abs(a) < EPS && Math.abs(d) < EPS)
}

function mapRect(t: Affine, r: Rect): Rect {
  const corners: Pt[] = [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[0], r[3]],
    [r[2], r[3]]
  ]
  return rectUnion(corners.map(([x, y]) => applyAffine(t, x, y)).map(([x, y]) => [x, y, x, y] as Rect))
}

/**
 * Moves one markup through an image transform (in markup space). Points map exactly.
 * Boxes map exactly under 90° turns, flips and scaling; under any other angle a box
 * can't tilt, so it follows its center and stays upright. Text boxes and signatures
 * always stay upright and keep their proportions, so text stays readable.
 */
export function transformMarkup(m: Markup, t: Affine): Markup {
  const p = ([x, y]: Pt): Pt => applyAffine(t, x, y)
  const s = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2]))
  const style = { ...m.style, width: m.style.width * s }
  const upright = (r: Rect): Rect => {
    const [cx, cy] = p([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2])
    const hw = ((r[2] - r[0]) * s) / 2
    const hh = ((r[3] - r[1]) * s) / 2
    return [cx - hw, cy - hh, cx + hw, cy + hh]
  }
  switch (m.type) {
    case 'line':
    case 'arrow':
      return { ...m, style, from: p(m.from), to: p(m.to) }
    case 'polygon':
      return { ...m, style, points: m.points.map(p) }
    case 'ink':
      return { ...m, style, strokes: m.strokes.map((st) => st.map(p)) }
    case 'note':
      return { ...m, at: p(m.at) }
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strike':
      return { ...m, style, quads: m.quads.map((q) => q.flatMap((_, i) => (i % 2 ? [] : p([q[i], q[i + 1]])))) }
    case 'text':
      return { ...m, style, rect: upright(m.rect), fontSize: m.fontSize * s }
    case 'signature':
      return { ...m, style, rect: upright(m.rect) }
    default:
      return { ...m, style, rect: axisAligned(t) ? mapRect(t, m.rect) : upright(m.rect) }
  }
}

/**
 * Carries markup and redactions through an image transform given in pixel space.
 * Redactions always grow to cover their whole rotated area, so nothing they hid
 * becomes visible; items that end up entirely outside the new image are dropped.
 */
export function transformForImage(
  markup: Markup[],
  redactions: Redaction[],
  pixelMap: Affine,
  before: { width: number; height: number },
  after: { width: number; height: number }
): { markup: Markup[]; redactions: Redaction[] } {
  const t = markupAffine(pixelMap, before.height, after.height)
  const inside = (r: Rect): boolean => r[2] > 0 && r[3] > 0 && r[0] < after.width && r[1] < after.height
  const pad = axisAligned(t) ? 0 : 1
  return {
    markup: markup.map((m) => transformMarkup(m, t)).filter((m) => inside(paintBounds(m))),
    redactions: redactions
      .map((r) => {
        const b = mapRect(t, r.rect)
        return { ...r, rect: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] as Rect }
      })
      .filter((r) => inside(r.rect))
  }
}
