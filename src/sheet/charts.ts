/**
 * Glance's charts, drawn live from the cells they read: column, bar, line, area, pie and
 * doughnut, with a legend, value labels, a target line and a doughnut's centre words.
 * The same drawing makes the picture placed in saved .xlsx files for Excel.
 */
import { cellName, cellsOf, parseRange, splitSheet } from '../core/sheet/address'
import { findSheet, isError, type Chart, type Sheet, type Value, type Workbook } from '../core/sheet/model'
import { formatValue } from '../core/sheet/format'

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const PALETTE = ['#4f7cac', '#e2694f', '#e3a92f', '#3a9a92', '#8a5a83', '#8fb59a', '#d46f97', '#5a6d98', '#4f93ba', '#a87b4f']

export interface ChartData {
  categories: string[]
  series: { name: string; values: number[]; color?: string; fmt?: string }[]
}

/** The cells a chart reads, as numbers and labels. */
export function chartData(wb: Workbook, home: Sheet, ch: Chart): ChartData {
  const read = (ref: string): { v: Value; fmt?: string }[] => {
    const { sheet, ref: inner } = splitSheet(ref)
    const s = sheet ? findSheet(wb, sheet) : home
    const r = parseRange(inner)
    if (!s || !r) return []
    const out: { v: Value; fmt?: string }[] = []
    for (const a of cellsOf(r, Math.min(r.r2, r.r1 + 500), Math.min(r.c2, r.c1 + 500))) {
      const c = s.cells[cellName(a.r, a.c)]
      if (s.filterHidden?.has(a.r)) continue
      out.push({ v: c?.v ?? null, fmt: c?.s?.numFmt })
    }
    return out
  }
  const series = ch.series.map((se, i) => {
    const cells = read(se.values)
    return { name: se.name ?? `Series ${i + 1}`, values: cells.map((c) => (typeof c.v === 'number' ? c.v : 0)), color: se.color, fmt: cells.find((c) => c.fmt)?.fmt }
  })
  const n = Math.max(0, ...series.map((s) => s.values.length))
  const cats = ch.categories ? read(ch.categories).map((c) => (isError(c.v) ? '' : formatValue(c.v, c.fmt).text)) : []
  return { categories: Array.from({ length: n }, (_, i) => cats[i] ?? String(i + 1)), series }
}

export interface ChartStyle {
  font: string
  ink: string
  muted: string
  grid: string
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

const short = (n: number, fmt?: string) => {
  if (fmt) return formatValue(n, fmt).text
  if (Math.abs(n) >= 1e6) return `${+(n / 1e6).toFixed(1)}m`
  if (Math.abs(n) >= 1e4) return `${+(n / 1e3).toFixed(1)}k`
  return String(+n.toFixed(2))
}

/** Draws `ch` into the rectangle (x, y, w, h). */
export function drawChart(ctx: Ctx, ch: Chart, data: ChartData, x: number, y: number, w: number, h: number, look: Partial<ChartStyle> = {}): void {
  const st: ChartStyle = { font: ch.font ?? look.font ?? 'Urbanist, Arial, sans-serif', ink: ch.ink ?? look.ink ?? '#22343a', muted: look.muted ?? '#7d838e', grid: look.grid ?? 'rgba(0,0,0,0.08)' }
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  if (ch.bg) {
    ctx.fillStyle = ch.bg
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6)
    ctx.fill()
  }
  const font = (size: number, weight = 400) => `${weight} ${size}px ${st.font}`
  let top = y + 10
  if (ch.title) {
    ctx.fillStyle = st.ink
    ctx.font = font(13, 700)
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(ch.title, x + 12, top)
    top += 24
  }
  const colorAt = (i: number) => ch.colors?.[i] ?? PALETTE[i % PALETTE.length]
  const body = { x: x + 10, y: top, w: w - 20, h: y + h - top - 10 }
  if (ch.type === 'pie' || ch.type === 'doughnut') {
    const vals = data.series[0]?.values ?? []
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0)
    const legend = ch.legend !== 'none'
    const rows = Math.ceil(vals.length / 2)
    const legendH = legend ? rows * 16 + 6 : 0
    const side = ch.legend === 'right'
    const R = Math.max(10, Math.min(side ? body.w * 0.55 : body.w, body.h - (side ? 0 : legendH)) / 2 - 4)
    const cx = side ? body.x + R + 4 : body.x + body.w / 2
    const cy = body.y + R + 2
    let a = -Math.PI / 2
    const hole = ch.type === 'doughnut' ? R * 0.6 : 0
    vals.forEach((v, i) => {
      if (v <= 0 || !total) return
      const b = a + (v / total) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * hole, cy + Math.sin(a) * hole)
      ctx.arc(cx, cy, R, a, b)
      if (hole) ctx.arc(cx, cy, hole, b, a, true)
      else ctx.lineTo(cx, cy)
      ctx.closePath()
      ctx.fillStyle = colorAt(i)
      ctx.fill()
      ctx.strokeStyle = ch.bg ?? '#ffffff'
      ctx.lineWidth = 1.5
      ctx.stroke()
      a = b
    })
    if (hole && ch.centre) {
      ctx.fillStyle = st.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const [first, ...rest] = ch.centre.split('\n')
      ctx.font = font(Math.max(11, Math.round(hole * 0.42)), 700)
      ctx.fillText(first, cx, rest.length ? cy - 6 : cy)
      if (rest.length) {
        ctx.font = font(Math.max(9, Math.round(hole * 0.2)))
        ctx.fillStyle = st.muted
        ctx.fillText(rest.join(' '), cx, cy + hole * 0.3)
      }
    }
    if (legend) {
      ctx.textBaseline = 'middle'
      const colW = side ? body.w - R * 2 - 16 : body.w / 2
      vals.forEach((v, i) => {
        const lx = side ? cx + R + 14 : body.x + (i % 2) * colW
        const ly = side ? body.y + 8 + i * 16 : cy + R + 14 + Math.floor(i / 2) * 16
        ctx.fillStyle = colorAt(i)
        roundRect(ctx, lx, ly - 4, 8, 8, 2)
        ctx.fill()
        ctx.fillStyle = st.muted
        ctx.textAlign = 'left'
        ctx.font = font(10)
        ctx.fillText(data.categories[i] ?? '', lx + 12, ly, colW - 48)
        ctx.fillStyle = st.ink
        ctx.textAlign = 'right'
        ctx.font = font(10, 700)
        ctx.fillText(total ? `${Math.round((v / total) * 100)}%` : '', lx + colW - 8, ly)
      })
    }
    ctx.restore()
    return
  }
  // Axes charts.
  const n = data.categories.length
  const stacked = !!ch.stacked
  const all = data.series.flatMap((s) => s.values)
  const sums = data.categories.map((_, i) => data.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0))
  const top0 = Math.max(stacked ? Math.max(0, ...sums) : Math.max(0, ...all), ch.target?.value ?? 0)
  const max = niceMax(top0 * 1.05)
  const min = Math.min(0, ...all)
  const fmt = data.series[0]?.fmt
  const legendH = data.series.length > 1 && ch.legend !== 'none' ? 18 : 0
  const horizontal = ch.type === 'bar'
  ctx.font = font(10)
  const labelW = horizontal ? Math.min(body.w * 0.35, Math.max(20, ...data.categories.map((c) => ctx.measureText(c).width)) + 8) : Math.max(...[0, max / 2, max].map((v) => ctx.measureText(short(v, fmt)).width)) + 8
  const plot = horizontal ? { x: body.x + labelW, y: body.y + legendH, w: body.w - labelW - 6, h: body.h - legendH - 16 } : { x: body.x + labelW, y: body.y + legendH + 4, w: body.w - labelW - 4, h: body.h - legendH - 22 }
  const scale = (v: number) => (v - min) / (max - min)
  // Grid and value axis.
  ctx.strokeStyle = st.grid
  ctx.lineWidth = 1
  ctx.fillStyle = st.muted
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4
    if (horizontal) {
      const gx = Math.round(plot.x + scale(v) * plot.w) + 0.5
      ctx.beginPath()
      ctx.moveTo(gx, plot.y)
      ctx.lineTo(gx, plot.y + plot.h)
      ctx.stroke()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(short(v, fmt), gx, plot.y + plot.h + 3)
    } else {
      const gy = Math.round(plot.y + plot.h - scale(v) * plot.h) + 0.5
      ctx.beginPath()
      ctx.moveTo(plot.x, gy)
      ctx.lineTo(plot.x + plot.w, gy)
      ctx.stroke()
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(short(v, fmt), plot.x - 5, gy)
    }
  }
  const slot = (horizontal ? plot.h : plot.w) / Math.max(1, n)
  const seriesColor = (si: number) => data.series[si].color ?? (data.series.length === 1 && ch.colors?.length ? undefined : colorAt(si))
  if (ch.type === 'column' || ch.type === 'bar') {
    const groups = stacked ? 1 : data.series.length
    const bw = Math.max(2, (slot * 0.64) / groups)
    data.categories.forEach((cat, i) => {
      let acc = 0
      data.series.forEach((s, si) => {
        const v = s.values[i] ?? 0
        const from = stacked ? acc : 0
        const to = from + v
        acc = to
        const color = seriesColor(si) ?? ch.colors?.[i % (ch.colors?.length ?? 1)] ?? colorAt(i)
        ctx.fillStyle = color
        const off = stacked ? 0 : si * bw
        if (horizontal) {
          const by = plot.y + i * slot + (slot - bw * groups) / 2 + off
          const x1 = plot.x + scale(Math.min(from, to)) * plot.w
          const x2 = plot.x + scale(Math.max(from, to)) * plot.w
          roundRect(ctx, x1, by, Math.max(1, x2 - x1), bw, 2)
          ctx.fill()
          if (ch.labels && v) label(ctx, short(v, fmt), x2 + 4, by + bw / 2, 'left', font(9.5, 700), st.ink)
        } else {
          const bx = plot.x + i * slot + (slot - bw * groups) / 2 + off
          const y1 = plot.y + plot.h - scale(Math.max(from, to)) * plot.h
          const y2 = plot.y + plot.h - scale(Math.min(from, to)) * plot.h
          roundRect(ctx, bx, y1, bw, Math.max(1, y2 - y1), 2)
          ctx.fill()
          if (ch.labels && v) label(ctx, short(v, fmt), bx + bw / 2, y1 - 7, 'center', font(9.5, 700), st.ink)
        }
      })
      ctx.fillStyle = st.muted
      ctx.font = font(10)
      if (horizontal) label(ctx, cat, plot.x - 6, plot.y + i * slot + slot / 2, 'right', font(10), st.muted, labelW - 8)
      else if (n <= 16 || i % Math.ceil(n / 12) === 0) label(ctx, cat, plot.x + i * slot + slot / 2, plot.y + plot.h + 10, 'center', font(10), st.muted, slot * Math.ceil(n / 12) - 2)
    })
  } else {
    data.series.forEach((s, si) => {
      const color = s.color ?? colorAt(si)
      const pts = s.values.map((v, i) => [plot.x + i * slot + slot / 2, plot.y + plot.h - scale(v) * plot.h] as const)
      if (!pts.length) return
      if (ch.type === 'area') {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], plot.y + plot.h)
        for (const [px, py] of pts) ctx.lineTo(px, py)
        ctx.lineTo(pts[pts.length - 1][0], plot.y + plot.h)
        ctx.closePath()
        ctx.globalAlpha = 0.25
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.beginPath()
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()
      for (const [px, py] of pts) {
        ctx.beginPath()
        ctx.arc(px, py, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      }
      if (ch.labels) s.values.forEach((v, i) => label(ctx, short(v, fmt), pts[i][0], pts[i][1] - 9, 'center', font(9.5, 700), st.ink))
    })
    data.categories.forEach((cat, i) => {
      if (n <= 16 || i % Math.ceil(n / 12) === 0) label(ctx, cat, plot.x + i * slot + slot / 2, plot.y + plot.h + 10, 'center', font(10), st.muted, slot * Math.ceil(n / 12) - 2)
    })
  }
  if (ch.target) {
    const t = ch.target
    ctx.strokeStyle = t.color ?? st.ink
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1.2
    ctx.beginPath()
    if (horizontal) {
      const tx = plot.x + scale(t.value) * plot.w
      ctx.moveTo(tx, plot.y)
      ctx.lineTo(tx, plot.y + plot.h)
    } else {
      const ty = plot.y + plot.h - scale(t.value) * plot.h
      ctx.moveTo(plot.x, ty)
      ctx.lineTo(plot.x + plot.w, ty)
      if (t.label) label(ctx, t.label, plot.x + plot.w - 2, ty - 7, 'right', font(9.5, 700), t.color ?? st.ink)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (legendH) {
    let lx = body.x + labelW
    data.series.forEach((s, si) => {
      ctx.fillStyle = s.color ?? colorAt(si)
      roundRect(ctx, lx, body.y + 3, 8, 8, 2)
      ctx.fill()
      ctx.font = font(10)
      ctx.fillStyle = st.muted
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.name, lx + 12, body.y + 7)
      lx += 24 + ctx.measureText(s.name).width
    })
  }
  ctx.restore()
}

function label(ctx: Ctx, text: string, x: number, y: number, align: CanvasTextAlign, font: string, color: string, max?: number): void {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (max !== undefined && max > 0) ctx.fillText(text, x, y, max)
  else ctx.fillText(text, x, y)
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
