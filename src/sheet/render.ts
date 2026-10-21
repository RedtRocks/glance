/**
 * Draws a sheet on a canvas: fills, gridlines, conditional formatting, text (with
 * overflow into empty neighbours, wrapping and rich text), borders, tick boxes, filter
 * buttons, pictures and charts. The grid, the PNG and PDF exports and AI apps'
 * glance_sheet_render all draw through here, so they look the same.
 */
import { cellName, inRange, parseRange, type Range } from '../core/sheet/address'
import { CfEngine, type CfLook } from '../core/sheet/cf'
import { SheetLayout } from '../core/sheet/layout'
import { DEFAULT_FONT, isError, styleAt, type Cell, type Font, type Sheet, type Style, type Workbook, type IconSetName, type BorderSide } from '../core/sheet/model'
import { formatValue } from '../core/sheet/format'
import { chartData, drawChart, roundRect, type Ctx } from './charts'

export interface Pane {
  /** Where the pane sits on the canvas, in CSS pixels. */
  x: number
  y: number
  w: number
  h: number
  /** The sheet position (pixels at zoom 1) at the pane's top-left. */
  sx: number
  sy: number
}

export interface DrawInput {
  wb: Workbook
  sheet: Sheet
  layout: SheetLayout
  cf: CfEngine
  zoom: number
  /** Decoded pictures by media key. */
  pictures: Map<string, CanvasImageSource>
  /** Sheet background (cells with no fill). */
  paper?: string
  gridColor?: string
}

const FALLBACK = "'Segoe UI', Urbanist, Arial, sans-serif"
const FONT_ALIAS: Record<string, string> = { Calibri: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif", Arial: 'Arial, Helvetica, sans-serif', Aptos: "Aptos, 'Segoe UI', Arial, sans-serif" }

export function cssFont(f: Font | undefined, zoom = 1): string {
  const name = f?.name ?? DEFAULT_FONT.name
  const size = ((f?.size ?? DEFAULT_FONT.size) * 4) / 3
  const family = FONT_ALIAS[name] ?? `'${name}', ${FALLBACK}`
  return `${f?.italic ? 'italic ' : ''}${f?.bold ? 700 : 400} ${(size * zoom).toFixed(2)}px ${family}`
}

const PAD = 4

/** The visible rows or columns of a pane, as [first, last]. */
function span(l: SheetLayout, axis: 'r' | 'c', from: number, len: number): [number, number] {
  const a = axis === 'r' ? l.rowAt(from) : l.colAt(from)
  const b = axis === 'r' ? l.rowAt(from + len) : l.colAt(from + len)
  return [a, b]
}

export function drawPane(ctx: Ctx, o: DrawInput, p: Pane): void {
  const { layout: l, sheet: s, zoom } = o
  const [r1, r2] = span(l, 'r', p.sy, p.h / zoom)
  const [c1, c2] = span(l, 'c', p.sx, p.w / zoom)
  ctx.save()
  ctx.beginPath()
  ctx.rect(p.x, p.y, p.w, p.h)
  ctx.clip()
  ctx.translate(p.x - p.sx * zoom, p.y - p.sy * zoom)
  ctx.scale(zoom, zoom)
  const paper = o.paper ?? '#ffffff'
  ctx.fillStyle = paper
  ctx.fillRect(p.sx, p.sy, p.w / zoom, p.h / zoom)
  // Merged areas that reach into view, even when they start outside it.
  const merges = l.merges.filter((m) => m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1)
  const looks = new Map<string, CfLook | null>()
  const lookAt = (r: number, c: number) => {
    const k = cellName(r, c)
    if (!looks.has(k)) looks.set(k, s.cf.length ? o.cf.look(r, c) : null)
    return looks.get(k)!
  }
  // Gridlines.
  if (s.gridlines !== false) {
    ctx.strokeStyle = o.gridColor ?? '#e1e3e8'
    ctx.lineWidth = 1 / zoom
    ctx.beginPath()
    const yTop = l.y(r1)
    const yBot = l.y(r2 + 1)
    const xL = l.x(c1)
    const xR = l.x(c2 + 1)
    for (let c = c1; c <= c2 + 1; c++) {
      const x = Math.round(l.x(c) * zoom) / zoom - 0.5 / zoom
      ctx.moveTo(x, yTop)
      ctx.lineTo(x, yBot)
    }
    for (let r = r1; r <= r2 + 1; r++) {
      const y = Math.round(l.y(r) * zoom) / zoom - 0.5 / zoom
      ctx.moveTo(xL, y)
      ctx.lineTo(xR, y)
    }
    ctx.stroke()
  }
  // Fills: columns' and rows' own styles, then cells, then merged areas.
  const fillRect = (a: Range, color: string) => {
    const rc = l.rect(a)
    ctx.fillStyle = color
    ctx.fillRect(rc.x, rc.y, rc.w, rc.h)
  }
  for (let r = r1; r <= r2; r++) {
    if (!l.h(r)) continue
    for (let c = c1; c <= c2; c++) {
      if (l.mergeAt(r, c)) continue
      const st = styleAt(s, r, c)
      const look = lookAt(r, c)
      const fill = look?.style?.fill ?? look?.fill ?? st?.fill
      if (fill) fillRect({ r1: r, c1: c, r2: r, c2: c }, fill)
    }
  }
  for (const m of merges) {
    const st = styleAt(s, m.r1, m.c1)
    const look = lookAt(m.r1, m.c1)
    fillRect(m, look?.style?.fill ?? look?.fill ?? st?.fill ?? paper)
  }
  // Data bars, under the text.
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const bar = lookAt(r, c)?.bar
      if (!bar || l.hiddenByMerge(r, c)) continue
      const rc = l.rect(l.area(r, c))
      const bw = Math.max(1, (rc.w - 4) * bar.pct)
      const g = ctx.createLinearGradient(rc.x + 2, 0, rc.x + 2 + bw, 0)
      g.addColorStop(0, bar.color)
      g.addColorStop(1, bar.color + '40')
      ctx.fillStyle = g
      ctx.fillRect(rc.x + 2, rc.y + 3, bw, rc.h - 6)
      ctx.strokeStyle = bar.color
      ctx.lineWidth = 1 / zoom
      ctx.strokeRect(rc.x + 2.5, rc.y + 3.5, bw - 1, rc.h - 7)
    }
  // Text.
  const filled = (r: number, c: number) => {
    const cell = s.cells[cellName(r, c)]
    return !!cell && cell.v !== null && cell.v !== undefined && cell.v !== ''
  }
  const boxes = s.validations.filter((v) => v.type === 'checkbox').flatMap((v) => v.ref.split(/\s+/).map((x) => parseRange(x)).filter((x): x is Range => !!x))
  const drawCell = (r: number, c: number) => {
    const cell = s.cells[cellName(r, c)]
    if (!cell || cell.v === null || cell.v === undefined) return
    const area = l.area(r, c)
    const rc = l.rect(area)
    if (rc.w <= 0 || rc.h <= 0) return
    const look = lookAt(r, c)
    const st = mergeStyle(styleAt(s, r, c), look?.style)
    if (boxes.some((b) => inRange(b, r, c)) && typeof cell.v === 'boolean') return drawTick(ctx, rc, cell.v, st)
    if (look?.bar && !look.bar.showValue) return
    let iconW = 0
    if (look?.icon) {
      drawIcon(ctx, look.icon.set, look.icon.index, look.icon.count, rc.x + 3, rc.y + rc.h / 2, Math.min(14, rc.h - 4))
      iconW = 18
      if (!look.icon.showValue) return
    }
    drawText(ctx, cell, st, rc, area, l, iconW, filled, zoom)
  }
  // Text overflows to the left too, so draw a little beyond the view.
  for (let r = r1; r <= r2; r++) {
    if (!l.h(r)) continue
    for (let c = Math.max(0, c1 - 6); c <= c2; c++) if (!l.mergeAt(r, c)) drawCell(r, c)
  }
  for (const m of merges) drawCell(m.r1, m.c1)
  // Borders.
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      if (!l.h(r) || !l.w(c)) continue
      const st = styleAt(s, r, c)
      const area = l.area(r, c)
      const b = st?.border
      if (!b) continue
      const rc = l.rect({ r1: r, c1: c, r2: r, c2: c })
      if (b.top && r === area.r1) line(ctx, rc.x, rc.y, rc.x + rc.w, rc.y, b.top, zoom, 'h', 1)
      if (b.bottom && r === area.r2) line(ctx, rc.x, rc.y + rc.h, rc.x + rc.w, rc.y + rc.h, b.bottom, zoom, 'h', -1)
      if (b.left && c === area.c1) line(ctx, rc.x, rc.y, rc.x, rc.y + rc.h, b.left, zoom, 'v', 1)
      if (b.right && c === area.c2) line(ctx, rc.x + rc.w, rc.y, rc.x + rc.w, rc.y + rc.h, b.right, zoom, 'v', -1)
    }
  // Merged areas' borders come from their top-left cell's style in Glance and Excel alike.
  for (const m of merges) {
    const b = styleAt(s, m.r1, m.c1)?.border
    if (!b) continue
    const rc = l.rect(m)
    if (b.top) line(ctx, rc.x, rc.y, rc.x + rc.w, rc.y, b.top, zoom, 'h', 1)
    if (b.left) line(ctx, rc.x, rc.y, rc.x, rc.y + rc.h, b.left, zoom, 'v', 1)
    const br = styleAt(s, m.r2, m.c2)?.border
    if (br?.bottom ?? b.bottom) line(ctx, rc.x, rc.y + rc.h, rc.x + rc.w, rc.y + rc.h, (br?.bottom ?? b.bottom)!, zoom, 'h', -1)
    if (br?.right ?? b.right) line(ctx, rc.x + rc.w, rc.y, rc.x + rc.w, rc.y + rc.h, (br?.right ?? b.right)!, zoom, 'v', -1)
  }
  // Filter buttons on the filter's header row.
  if (s.filter) {
    const f = parseRange(s.filter.ref)
    if (f && f.r1 >= r1 && f.r1 <= r2)
      for (let c = Math.max(f.c1, c1); c <= Math.min(f.c2, c2); c++) {
        const rc = l.rect(l.area(f.r1, c))
        const on = !!s.filter.shown?.[c]
        const sz = Math.min(13, rc.h - 4)
        const bx = rc.x + rc.w - sz - 3
        const by = rc.y + (rc.h - sz) / 2
        ctx.fillStyle = on ? '#2f7d56' : '#ffffff'
        roundRect(ctx, bx, by, sz, sz, 2)
        ctx.fill()
        ctx.strokeStyle = on ? '#2f7d56' : 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 1 / zoom
        ctx.stroke()
        ctx.strokeStyle = on ? '#ffffff' : '#555a63'
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.moveTo(bx + sz * 0.28, by + sz * 0.42)
        ctx.lineTo(bx + sz / 2, by + sz * 0.64)
        ctx.lineTo(bx + sz * 0.72, by + sz * 0.42)
        ctx.stroke()
      }
  }
  // Pictures and charts, over the cells.
  const anchorRect = (a: Sheet['images'][number]['anchor']) => {
    const x1 = l.x(a.from.c) + (a.from.dx ?? 0)
    const y1 = l.y(a.from.r) + (a.from.dy ?? 0)
    const x2 = l.x(a.to.c) + (a.to.dx ?? 0)
    const y2 = l.y(a.to.r) + (a.to.dy ?? 0)
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
  const visible = (rc: { x: number; y: number; w: number; h: number }) => rc.x < p.sx + p.w / zoom && rc.x + rc.w > p.sx && rc.y < p.sy + p.h / zoom && rc.y + rc.h > p.sy
  for (const im of s.images) {
    const pic = o.pictures.get(im.media)
    const rc = anchorRect(im.anchor)
    if (!pic || !visible(rc)) continue
    ctx.drawImage(pic, rc.x, rc.y, rc.w, rc.h)
  }
  for (const ch of s.charts) {
    const rc = anchorRect(ch.anchor)
    if (!visible(rc) || rc.w < 20 || rc.h < 20) continue
    drawChart(ctx, ch, chartData(o.wb, s, ch), rc.x, rc.y, rc.w, rc.h)
  }
  ctx.restore()
}

function mergeStyle(a: Style | undefined, b: Style | undefined): Style | undefined {
  if (!b) return a
  return { ...a, ...b, font: { ...a?.font, ...b.font } }
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, b: BorderSide, zoom: number, dir: 'h' | 'v', inward: 1 | -1): void {
  const w = { hair: 0.5, thin: 1, dashed: 1, dotted: 1, medium: 2, thick: 3, double: 3 }[b.style] ?? 1
  ctx.strokeStyle = b.color ?? '#000000'
  ctx.setLineDash(b.style === 'dashed' ? [3, 2] : b.style === 'dotted' ? [1, 1.5] : [])
  const off = (v: number) => Math.round(v * zoom) / zoom - (w % 2 ? 0.5 / zoom : 0)
  if (b.style === 'double') {
    ctx.lineWidth = 1 / zoom
    for (const d of [0, 2 * inward]) {
      ctx.beginPath()
      if (dir === 'h') {
        ctx.moveTo(x1, off(y1) + d - inward)
        ctx.lineTo(x2, off(y2) + d - inward)
      } else {
        ctx.moveTo(off(x1) + d - inward, y1)
        ctx.lineTo(off(x2) + d - inward, y2)
      }
      ctx.stroke()
    }
    return
  }
  ctx.lineWidth = w
  ctx.beginPath()
  if (dir === 'h') {
    ctx.moveTo(x1, off(y1))
    ctx.lineTo(x2, off(y2))
  } else {
    ctx.moveTo(off(x1), y1)
    ctx.lineTo(off(x2), y2)
  }
  ctx.stroke()
  ctx.setLineDash([])
}

function drawTick(ctx: Ctx, rc: { x: number; y: number; w: number; h: number }, on: boolean, st: Style | undefined): void {
  const sz = Math.min(14, rc.h - 4, rc.w - 4)
  const h = st?.align?.h ?? 'center'
  const x = h === 'left' ? rc.x + PAD : h === 'right' ? rc.x + rc.w - PAD - sz : rc.x + (rc.w - sz) / 2
  const y = rc.y + (rc.h - sz) / 2
  const color = st?.font?.color ?? '#2f7d56'
  if (on) {
    ctx.fillStyle = color
    roundRect(ctx, x, y, sz, sz, sz * 0.25)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x + sz * 0.26, y + sz * 0.52)
    ctx.lineTo(x + sz * 0.44, y + sz * 0.7)
    ctx.lineTo(x + sz * 0.76, y + sz * 0.32)
    ctx.stroke()
    ctx.lineCap = 'butt'
  } else {
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.3
    roundRect(ctx, x + 0.65, y + 0.65, sz - 1.3, sz - 1.3, sz * 0.25)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

const ICON_COLORS = { red: '#d9534f', amber: '#f0ad4e', green: '#3c9d5d', grey: '#9aa0aa', gold: '#f0b429' }

export function drawIcon(ctx: Ctx, set: IconSetName, index: number, count: number, x: number, cy: number, size: number): void {
  const t = count > 1 ? index / (count - 1) : 1
  const color = t >= 0.99 ? ICON_COLORS.green : t <= 0.01 ? ICON_COLORS.red : ICON_COLORS.amber
  const r = size / 2
  const cx = x + r
  ctx.save()
  if (set === '3Arrows' || set === '4Arrows' || set === '5Arrows') {
    // Up for the top band, sideways in the middle, down for the bottom.
    ctx.translate(cx, cy)
    ctx.rotate((1 - t) * Math.PI)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.lineTo(r * 0.8, 0)
    ctx.lineTo(r * 0.3, 0)
    ctx.lineTo(r * 0.3, r)
    ctx.lineTo(-r * 0.3, r)
    ctx.lineTo(-r * 0.3, 0)
    ctx.lineTo(-r * 0.8, 0)
    ctx.closePath()
    ctx.fill()
  } else if (set === '3Stars') {
    ctx.fillStyle = index === 0 ? '#ffffff' : ICON_COLORS.gold
    ctx.strokeStyle = ICON_COLORS.gold
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const rr = i % 2 ? r * 0.42 : r
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    }
    ctx.closePath()
    if (index === 1) {
      ctx.save()
      ctx.clip()
      ctx.fillRect(cx - r, cy - r, r, size)
      ctx.restore()
      ctx.stroke()
    } else {
      ctx.fill()
      ctx.stroke()
    }
  } else if (set === '4Rating' || set === '5Rating') {
    const bars = count - 1
    for (let i = 0; i < bars; i++) {
      const bh = ((i + 1) / bars) * size
      ctx.fillStyle = i < index ? '#4f7cac' : '#d3d7de'
      ctx.fillRect(x + i * (size / bars), cy + r - bh, size / bars - 1, bh)
    }
  } else if (set === '3Flags') {
    ctx.fillStyle = color
    ctx.fillRect(x + 2, cy - r, 1.4, size)
    ctx.beginPath()
    ctx.moveTo(x + 3.4, cy - r)
    ctx.lineTo(x + size, cy - r * 0.5)
    ctx.lineTo(x + 3.4, cy)
    ctx.fill()
  } else {
    // Traffic lights and symbols: a disc, with a mark for the symbol sets.
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    if (set === '3Symbols' || set === '3Symbols2') {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      if (t >= 0.99) {
        ctx.moveTo(cx - r * 0.45, cy)
        ctx.lineTo(cx - r * 0.1, cy + r * 0.35)
        ctx.lineTo(cx + r * 0.45, cy - r * 0.35)
      } else if (t <= 0.01) {
        ctx.moveTo(cx - r * 0.35, cy - r * 0.35)
        ctx.lineTo(cx + r * 0.35, cy + r * 0.35)
        ctx.moveTo(cx + r * 0.35, cy - r * 0.35)
        ctx.lineTo(cx - r * 0.35, cy + r * 0.35)
      } else {
        ctx.moveTo(cx, cy - r * 0.45)
        ctx.lineTo(cx, cy + r * 0.1)
        ctx.moveTo(cx, cy + r * 0.42)
        ctx.lineTo(cx, cy + r * 0.44)
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

interface Line {
  runs: { text: string; font: string; color: string; underline?: boolean; strike?: boolean }[]
  width: number
  height: number
}

function drawText(ctx: Ctx, cell: Cell, st: Style | undefined, rc: { x: number; y: number; w: number; h: number }, area: Range, l: SheetLayout, iconW: number, filled: (r: number, c: number) => boolean, zoom: number): void {
  const v = cell.v!
  const fmt = formatValue(v, st?.numFmt)
  const isNum = typeof v === 'number'
  const align = st?.align?.h ?? (isNum ? 'right' : typeof v === 'boolean' || isError(v) ? 'center' : 'left')
  const valign = st?.align?.v ?? 'bottom'
  const wrap = !!st?.align?.wrap
  const indent = (st?.align?.indent ?? 0) * 9
  const baseFont = st?.font
  const color = fmt.color ?? baseFont?.color ?? DEFAULT_FONT.color
  // Runs: rich text keeps each run's font; others take the cell's.
  const runs = cell.rich?.length && !cell.f ? cell.rich.map((r) => ({ text: r.text, f: { ...baseFont, ...r.font } })) : [{ text: fmt.text, f: baseFont ?? {} }]
  const lineH = (f: Font) => (((f.size ?? DEFAULT_FONT.size) * 4) / 3) * 1.22
  const avail = rc.w - PAD * 2 - indent - iconW
  // Split into lines on newlines, and on width when wrapping.
  const lines: Line[] = [{ runs: [], width: 0, height: 0 }]
  for (const run of runs) {
    const font = cssFont(run.f)
    ctx.font = font
    const parts = run.text.split('\n')
    parts.forEach((part, pi) => {
      if (pi > 0) lines.push({ runs: [], width: 0, height: 0 })
      const words = wrap ? part.split(/(?<=\s)/) : [part]
      for (const word of words) {
        let cur = lines[lines.length - 1]
        const w = ctx.measureText(word).width
        if (wrap && cur.width > 0 && cur.width + w > avail) {
          cur = { runs: [], width: 0, height: 0 }
          lines.push(cur)
        }
        const last = cur.runs[cur.runs.length - 1]
        const c = run.f.color ?? color
        if (last && last.font === font && last.color === c) last.text += word
        else cur.runs.push({ text: word, font, color: c, underline: run.f.underline, strike: run.f.strike })
        cur.width += w
        cur.height = Math.max(cur.height, lineH(run.f))
      }
    })
  }
  for (const ln of lines) if (!ln.height) ln.height = lineH(baseFont ?? {})
  const total = lines.reduce((a, b) => a + b.height, 0)
  // Clip: the cell, or for one-line text, also the empty cells it runs into.
  let clipX = rc.x
  let clipW = rc.w
  const width = Math.max(...lines.map((x) => x.width))
  if (!wrap && lines.length === 1 && !isNum && area.r1 === area.r2 && width > avail) {
    const row = area.r1
    if (align === 'left' || align === 'center') {
      let c = area.c2 + 1
      let need = width - avail
      while (need > 0 && c < area.c2 + 30 && !filled(row, c) && !l.mergeAt(row, c)) {
        clipW += l.w(c)
        need -= l.w(c)
        c++
      }
    }
    if (align === 'right' || align === 'center') {
      let c = area.c1 - 1
      let need = width - avail
      while (need > 0 && c >= 0 && !filled(row, c) && !l.mergeAt(row, c)) {
        clipX -= l.w(c)
        clipW += l.w(c)
        need -= l.w(c)
        c--
      }
    }
  }
  if (isNum && !wrap && width > avail + 1 && lines.length === 1) {
    // Numbers that don't fit show as ### like Excel.
    ctx.font = lines[0].runs[0]?.font ?? cssFont(baseFont)
    const hash = Math.max(1, Math.floor(avail / Math.max(1, ctx.measureText('#').width)))
    lines[0].runs = [{ ...lines[0].runs[0], text: '#'.repeat(hash) }]
    lines[0].width = ctx.measureText('#'.repeat(hash)).width
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(clipX, rc.y, clipW, rc.h)
  ctx.clip()
  let y = valign === 'top' ? rc.y + 2 : valign === 'middle' ? rc.y + (rc.h - total) / 2 : rc.y + rc.h - total - 2
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  for (const ln of lines) {
    const x0 = rc.x + PAD + iconW + indent
    let x = align === 'right' ? rc.x + rc.w - PAD - indent - ln.width : align === 'center' ? rc.x + iconW + (rc.w - iconW - ln.width) / 2 : x0
    const base = y + ln.height * 0.78
    for (const run of ln.runs) {
      ctx.font = run.font
      ctx.fillStyle = run.color
      ctx.fillText(run.text, x, base)
      const w = ctx.measureText(run.text).width
      if (run.underline || run.strike) {
        ctx.fillRect(x, run.underline ? base + 1.5 : base - ln.height * 0.28, w, Math.max(1, 1 / zoom))
      }
      x += w
    }
    y += ln.height
  }
  ctx.restore()
}
