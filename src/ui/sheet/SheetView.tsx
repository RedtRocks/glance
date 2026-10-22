/**
 * The spreadsheet grid: a canvas drawn with the sheet renderer under a scrolling layer that
 * takes the pointer and keyboard. Frozen rows and columns stay put; every change goes
 * through sheet operations, so it can be undone and an AI app sees the same thing.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { SheetDoc, SheetSelection } from '../../state/sheetDoc'
import { t } from '../../i18n'
import { cellName, colName } from '../../core/sheet/address'
import { SheetLayout } from '../../core/sheet/layout'
import { CfEngine } from '../../core/sheet/cf'
import { formatValue } from '../../core/sheet/format'
import { getCell, plainText, styleAt, usedBounds, type Sheet, type Validation } from '../../core/sheet/model'
import { listChoices } from '../../core/sheet/validate'
import { todaySerial } from '../../core/sheet/recalc'
import { listValues } from '../../core/sheet/ops'
import { inRange, parseRange } from '../../core/sheet/address'
import { drawPane, cssFont } from '../../sheet/render'
import { decodePictures } from '../../sheet/picture'
import * as sheet from '../../state/sheet'
import { promptText } from '../../state/ui'
import { SheetToolbar } from './SheetToolbar'

const HW = 46
const HH = 22

const norm = (s: SheetSelection) => ({ r1: Math.min(s.r, s.r2), c1: Math.min(s.c, s.c2), r2: Math.max(s.r, s.r2), c2: Math.max(s.c, s.c2) })

/** The validation rule covering a cell, if any. */
function ruleAt(s: Sheet, r: number, c: number): Validation | undefined {
  return s.validations.find((v) => v.ref.split(/\s+/).some((x) => {
    const g = parseRange(x)
    return !!g && inRange(g, r, c)
  }))
}

/**
 * The picked cell's rule in a few words, under the formula bar. It says what
 * validationHint (core/ai/guide.ts) tells the AI, in the person’s language.
 */
function ruleLabel(v: Validation): string {
  const show = (n: number) => (v.type === 'date' ? formatValue(n, 'd mmm yyyy').text : String(n))
  const min = v.min !== undefined ? show(v.min) : undefined
  const max = v.max !== undefined ? show(v.max) : undefined
  switch (v.type) {
    case 'list':
      return v.source ? t('Pick one of the values in {range}', { range: v.source }) : t('Pick one of: {choices}', { choices: (v.values ?? []).join(', ') })
    case 'checkbox':
      return t('A tick box (TRUE or FALSE)')
    case 'textLength':
      return max !== undefined ? t('Text of at most {max} characters', { max }) : t('Text')
    case 'whole':
      return min !== undefined && max !== undefined ? t('A whole number from {min} to {max}', { min, max }) : min !== undefined ? t('A whole number of at least {min}', { min }) : max !== undefined ? t('A whole number of at most {max}', { max }) : t('A whole number')
    case 'date':
      return min !== undefined && max !== undefined ? t('A date from {min} to {max}', { min, max }) : min !== undefined ? t('A date of at least {min}', { min }) : max !== undefined ? t('A date of at most {max}', { max }) : t('A date')
    default:
      return min !== undefined && max !== undefined ? t('A number from {min} to {max}', { min, max }) : min !== undefined ? t('A number of at least {min}', { min }) : max !== undefined ? t('A number of at most {max}', { max }) : t('A number')
  }
}

/** What the formula bar and editor start from: the formula, or the value as typed. */
function entryText(s: Sheet, r: number, c: number): string {
  const cell = getCell(s, r, c)
  if (!cell) return ''
  if (cell.f) return cell.f.startsWith('=') ? cell.f : `=${cell.f}`
  if (typeof cell.v === 'number') {
    const fmt = styleAt(s, r, c)?.numFmt
    // Dates and percents edit the way they show; other numbers in full.
    if (fmt && /[dmy]|%/i.test(fmt.replace(/"[^"]*"/g, ''))) return formatValue(cell.v, fmt).text
    return String(cell.v)
  }
  return plainText(cell.v)
}

export function SheetView({ doc }: { doc: SheetDoc }) {
  const wb = doc.wb.value
  const s = doc.activeSheet.value
  const sel = doc.sel.value
  const zoom = doc.zoom.value
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [editing, setEditing] = useState<string | null>(null)
  const editor = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  const isEditing = editing !== null
  // Focus the in-cell editor as soon as it appears, so fast typing isn't lost to the grid.
  useLayoutEffect(() => {
    const el = editor.current
    if (isEditing) closed.current = false
    if (!isEditing || !el || document.activeElement !== scroller.current) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [isEditing])
  // A sheet that opens takes the keyboard, so typing goes straight into its first cell.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) scroller.current?.focus({ preventScroll: true })
  }, [doc])
  // Where a run of Tab entries started: Enter goes back to that column, as in Excel.
  const tabFrom = useRef<number | null>(null)
  // The editor was opened by typing over the cell (not F2 or a double-click): arrow keys enter it and move on, as in Excel.
  const typedIn = useRef(false)
  const [pictures, setPictures] = useState<Map<string, CanvasImageSource>>(new Map())
  const [list, setList] = useState<string[] | null>(null)
  const [, redraw] = useState(0)
  const layout = useMemo(() => new SheetLayout(s), [s])
  const cf = useMemo(() => new CfEngine(wb, s, { today: todaySerial() }), [wb, s])
  const fr = s.frozen?.rows ?? 0
  const fc = s.frozen?.cols ?? 0
  const fx = layout.x(fc)
  const fy = layout.y(fr)

  useEffect(() => {
    let live = true
    void decodePictures(s, doc.media).then((p) => live && setPictures(p))
    return () => {
      live = false
    }
  }, [s.images, doc.mediaVersion.value])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fonts the templates use arrive after the first draw.
  useEffect(() => {
    void document.fonts?.ready.then(() => redraw((n) => n + 1))
  }, [])

  // Sheet pixel <-> screen pixel, with frozen panes.
  const toSheetX = (px: number) => (px - HW < fx * zoom ? (px - HW) / zoom : fx + (px - HW - fx * zoom + scroll.x) / zoom)
  const toSheetY = (py: number) => (py - HH < fy * zoom ? (py - HH) / zoom : fy + (py - HH - fy * zoom + scroll.y) / zoom)
  const toScreenX = (x: number) => (x < fx ? HW + x * zoom : HW + fx * zoom + (x - fx) * zoom - scroll.x)
  const toScreenY = (y: number) => (y < fy ? HH + y * zoom : HH + fy * zoom + (y - fy) * zoom - scroll.y)
  const cellRect = (r1: number, c1: number, r2: number, c2: number) => {
    const x = toScreenX(layout.x(c1))
    const y = toScreenY(layout.y(r1))
    return { x, y, w: toScreenX(layout.x(c2 + 1)) - x, h: toScreenY(layout.y(r2 + 1)) - y }
  }

  const used = usedBounds(s)
  const totalW = layout.x(Math.max(used.cols + 20, 40))
  const totalH = layout.y(Math.max(used.rows + 60, 120))

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const css = getComputedStyle(cv)
    const chrome = css.getPropertyValue('--chrome').trim() || '#f3f3f3'
    const ink = css.getPropertyValue('--text-2').trim() || '#555'
    const accent = css.getPropertyValue('--accent').trim() || '#005fb8'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size.w, size.h)
    const input = { wb, sheet: s, layout, cf, zoom, pictures }
    const bodyW = Math.max(0, size.w - HW - fx * zoom)
    const bodyH = Math.max(0, size.h - HH - fy * zoom)
    if (fr && fc) drawPane(ctx, input, { x: HW, y: HH, w: fx * zoom, h: fy * zoom, sx: 0, sy: 0 })
    if (fr) drawPane(ctx, input, { x: HW + fx * zoom, y: HH, w: bodyW, h: fy * zoom, sx: fx + scroll.x / zoom, sy: 0 })
    if (fc) drawPane(ctx, input, { x: HW, y: HH + fy * zoom, w: fx * zoom, h: bodyH, sx: 0, sy: fy + scroll.y / zoom })
    drawPane(ctx, input, { x: HW + fx * zoom, y: HH + fy * zoom, w: bodyW, h: bodyH, sx: fx + scroll.x / zoom, sy: fy + scroll.y / zoom })
    // Headers: letters across, numbers down; the picked ones stand out.
    const n = norm(sel)
    ctx.fillStyle = chrome
    ctx.fillRect(0, 0, size.w, HH)
    ctx.fillRect(0, 0, HW, size.h)
    ctx.font = "12px 'Segoe UI', system-ui, sans-serif"
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.lineWidth = 1
    for (let c = layout.colAt(toSheetX(HW)), guard = 0; guard < 400; c++, guard++) {
      const x = toScreenX(layout.x(c))
      if (x > size.w) break
      if (c >= fc && x < HW + fx * zoom - 1 && c < fc + 400) continue
      const w = layout.w(c) * zoom
      if (w <= 0) continue
      if (c >= n.c1 && c <= n.c2) {
        ctx.fillStyle = 'rgba(0,95,184,0.14)'
        ctx.fillRect(x, 0, w, HH)
      }
      ctx.fillStyle = ink
      ctx.fillText(colName(c), x + w / 2, HH / 2 + 1)
      ctx.beginPath()
      ctx.moveTo(x + w - 0.5, 0)
      ctx.lineTo(x + w - 0.5, HH)
      ctx.stroke()
    }
    for (let r = layout.rowAt(toSheetY(HH)), guard = 0; guard < 400; r++, guard++) {
      const y = toScreenY(layout.y(r))
      if (y > size.h) break
      const h = layout.h(r) * zoom
      if (h <= 0) continue
      if (r >= n.r1 && r <= n.r2) {
        ctx.fillStyle = 'rgba(0,95,184,0.14)'
        ctx.fillRect(0, y, HW, h)
      }
      ctx.fillStyle = ink
      ctx.fillText(String(r + 1), HW / 2, y + h / 2 + 1)
      ctx.beginPath()
      ctx.moveTo(0, y + h - 0.5)
      ctx.lineTo(HW, y + h - 0.5)
      ctx.stroke()
    }
    // Frozen lines.
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    if (fr) ctx.fillRect(0, HH + fy * zoom - 1, size.w, 2)
    if (fc) ctx.fillRect(HW + fx * zoom - 1, 0, 2, size.h)
    // The selection: the range lightly filled, the active cell outlined.
    const area = layout.area(sel.r, sel.c)
    const big = n.r1 !== n.r2 || n.c1 !== n.c2
    const box = big ? cellRect(n.r1, n.c1, n.r2, n.c2) : cellRect(area.r1, area.c1, area.r2, area.c2)
    ctx.save()
    ctx.beginPath()
    ctx.rect(HW, HH, size.w - HW, size.h - HH)
    ctx.clip()
    if (big) {
      ctx.fillStyle = 'rgba(0,95,184,0.10)'
      ctx.fillRect(box.x, box.y, box.w, box.h)
    }
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2)
    ctx.restore()
  })

  // Keeps the active cell in view.
  const reveal = (r: number, c: number) => {
    const el = scroller.current
    if (!el) return
    if (c >= fc) {
      const x0 = (layout.x(c) - fx) * zoom
      const x1 = (layout.x(c + 1) - fx) * zoom
      const view = el.clientWidth - HW - fx * zoom
      if (x0 < el.scrollLeft) el.scrollLeft = x0
      else if (x1 > el.scrollLeft + view) el.scrollLeft = x1 - view
    }
    if (r >= fr) {
      const y0 = (layout.y(r) - fy) * zoom
      const y1 = (layout.y(r + 1) - fy) * zoom
      const view = el.clientHeight - HH - fy * zoom
      if (y0 < el.scrollTop) el.scrollTop = y0
      else if (y1 > el.scrollTop + view) el.scrollTop = y1 - view
    }
  }

  const select = (next: SheetSelection) => {
    doc.sel.value = next
    setList(null)
    reveal(next.r2, next.c2)
  }

  const commit = (text: string, move: 'down' | 'right' | 'up' | 'left' | 'none' = 'down', tab = false) => {
    const { r, c } = sel
    const ref = cellName(r, c)
    const before = entryText(s, r, c)
    // Moving focus blurs the editor, whose stale handler would commit the same edit again.
    closed.current = true
    setEditing(null)
    if (text !== before) {
      const op = text.startsWith('=') && text.length > 1 ? { op: 'set' as const, sheet: s.name, cell: ref, formula: text } : { op: 'set' as const, sheet: s.name, cell: ref, value: text }
      sheet.change(doc, t('Edit {cell}', { cell: ref }), [op])
    }
    const back = tabFrom.current
    tabFrom.current = tab && move === 'right' ? back ?? c : null
    if (move === 'down') select({ r: r + 1, c: back ?? c, r2: r + 1, c2: back ?? c })
    if (move === 'right') select({ r, c: c + 1, r2: r, c2: c + 1 })
    if (move === 'up') select({ r: Math.max(0, r - 1), c, r2: Math.max(0, r - 1), c2: c })
    if (move === 'left') select({ r, c: Math.max(0, c - 1), r2: r, c2: Math.max(0, c - 1) })
    scroller.current?.focus()
  }

  const cellAt = (e: { clientX: number; clientY: number }) => {
    const box = wrap.current!.getBoundingClientRect()
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    return { px, py, r: py < HH ? -1 : layout.rowAt(toSheetY(py)), c: px < HW ? -1 : layout.colAt(toSheetX(px)) }
  }

  const dragging = useRef(false)
  const onPointerDown = (e: PointerEvent) => {
    const { r, c } = cellAt(e)
    if (editing !== null) commit(editing, 'none')
    tabFrom.current = null
    if (r < 0 && c < 0) return select({ r: 0, c: 0, r2: 1_048_575, c2: 16_383 })
    if (r < 0) return select({ r: 0, c, r2: 1_048_575, c2: c })
    if (c < 0) return select({ r, c: 0, r2: r, c2: 16_383 })
    const a = layout.area(r, c)
    if (e.shiftKey) return select({ ...sel, r2: r, c2: c })
    // A tick box flips on click, like Excel's check boxes.
    const rule = ruleAt(s, a.r1, a.c1)
    if (rule?.type === 'checkbox' && sel.r === a.r1 && sel.c === a.c1) {
      const v = getCell(s, a.r1, a.c1)?.v
      sheet.change(doc, t('Tick {cell}', { cell: cellName(a.r1, a.c1) }), [{ op: 'set', sheet: s.name, cell: cellName(a.r1, a.c1), value: v !== true }])
      return
    }
    // The filter button in a header cell.
    if (s.filter) {
      const fref = parseRange(s.filter.ref)
      const rc = cellRect(a.r1, a.c1, a.r2, a.c2)
      if (fref && a.r1 === fref.r1 && c >= fref.c1 && c <= fref.c2 && cellAt(e).px > rc.x + rc.w - 18) return void openFilter(c)
    }
    select({ r: a.r1, c: a.c1, r2: a.r2, c2: a.c2 })
    dragging.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current) return
    const { r, c } = cellAt(e)
    if (r >= 0 && c >= 0 && (r !== sel.r2 || c !== sel.c2)) doc.sel.value = { ...doc.sel.peek(), r2: r, c2: c }
  }
  const onPointerUp = () => {
    dragging.current = false
  }

  const openFilter = async (c: number) => {
    const fref = parseRange(s.filter!.ref)!
    const values = new Set<string>()
    for (let r = fref.r1 + 1; r <= fref.r2; r++) values.add(plainText(getCell(s, r, c)?.v))
    const shown = s.filter?.shown?.[c]
    const answer = await promptText(t('Filter {column}', { column: colName(c) }), t('Show rows whose value is one of these, separated by commas; leave empty to show all. Values: {values}', { values: [...values].slice(0, 30).join(', ') }), { initial: shown?.join(', ') ?? '' })
    if (answer === null) return
    const pick = answer.split(',').map((x) => x.trim()).filter(Boolean)
    sheet.change(doc, t('Filter'), [{ op: 'filter', sheet: s.name, col: colName(c), values: pick.length ? pick : null }])
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing !== null) return
    const mod = e.ctrlKey || e.metaKey
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      e.stopPropagation()
      tabFrom.current = e.key === 'Tab' && !e.shiftKey ? tabFrom.current ?? sel.c : null
      if (e.shiftKey) return select({ ...sel, r2: Math.max(0, sel.r2 + dr), c2: Math.max(0, sel.c2 + dc) })
      const a = layout.area(sel.r, sel.c)
      const r = Math.max(0, dr > 0 ? a.r2 + 1 : dr < 0 ? sel.r - 1 : sel.r)
      const c = Math.max(0, dc > 0 ? a.c2 + 1 : dc < 0 ? sel.c - 1 : sel.c)
      const b = layout.area(r, c)
      select({ r: b.r1, c: b.c1, r2: b.r1, c2: b.c1 })
    }
    // Ctrl+arrows jump to the edge of the data, Home to column A and Ctrl+Home to A1, as in Excel.
    const jump = (r: number, c: number) => {
      e.preventDefault()
      e.stopPropagation()
      tabFrom.current = null
      if (e.shiftKey) return select({ ...sel, r2: r, c2: c })
      select({ r, c, r2: r, c2: c })
    }
    const filled = (r: number, c: number) => r >= 0 && c >= 0 && plainText(getCell(s, r, c)?.v) !== ''
    const edge = (dr: number, dc: number) => {
      const lastR = Math.max(used.rows, sel.r2)
      const lastC = Math.max(used.cols, sel.c2)
      let r = sel.r2
      let c = sel.c2
      const inside = (y: number, x: number) => y >= 0 && x >= 0 && y <= lastR && x <= lastC
      if (filled(r, c) && filled(r + dr, c + dc)) {
        while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) (r += dr), (c += dc)
      } else {
        do (r += dr), (c += dc)
        while (inside(r, c) && !filled(r, c))
        if (!inside(r, c)) (r = dr > 0 ? lastR : dr < 0 ? 0 : r - dr), (c = dc > 0 ? lastC : dc < 0 ? 0 : c - dc)
      }
      return jump(Math.max(0, r), Math.max(0, c))
    }
    if (mod && e.key === 'ArrowDown') return edge(1, 0)
    if (mod && e.key === 'ArrowUp') return edge(-1, 0)
    if (mod && e.key === 'ArrowRight') return edge(0, 1)
    if (mod && e.key === 'ArrowLeft') return edge(0, -1)
    if (mod && e.key === 'Home') return jump(0, 0)
    if (mod && e.key === 'End') return jump(Math.max(0, used.rows), Math.max(0, used.cols))
    if (e.key === 'Home') return jump(sel.r2, 0)
    if (e.key === 'ArrowDown') return move(1, 0)
    if (e.key === 'ArrowUp') return move(-1, 0)
    if (e.key === 'ArrowRight') return move(0, 1)
    if (e.key === 'ArrowLeft') return move(0, -1)
    if (e.key === 'Tab') return move(0, e.shiftKey ? -1 : 1)
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      typedIn.current = false
      return setEditing(entryText(s, sel.r, sel.c))
    }
    if (e.key === 'F2') {
      typedIn.current = false
      return void setEditing(entryText(s, sel.r, sel.c))
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      return sheet.clearSelection(doc)
    }
    if (e.key === ' ' && ruleAt(s, sel.r, sel.c)?.type === 'checkbox') {
      e.preventDefault()
      e.stopPropagation()
      const v = getCell(s, sel.r, sel.c)?.v
      return void sheet.change(doc, t('Tick {cell}', { cell: cellName(sel.r, sel.c) }), [{ op: 'set', sheet: s.name, cell: cellName(sel.r, sel.c), value: v !== true }])
    }
    // The app's shortcuts don't see keys the grid takes, so undo and redo are handled here.
    if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault()
      e.stopPropagation()
      return void (e.key === 'y' || e.shiftKey ? doc.redo() : doc.undo())
    }
    if (mod && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault()
      e.stopPropagation()
      const st = sheet.selectionStyle(doc)
      return sheet.formatSelection(doc, e.key === 'b' ? t('Bold') : t('Italic'), e.key === 'b' ? { bold: !st?.font?.bold } : { italic: !st?.font?.italic })
    }
    if (mod && e.key === 'c') return void copy(e)
    if (mod && e.key === 'v') return
    if (mod && e.key === 'x') {
      copy(e)
      return sheet.clearSelection(doc)
    }
    if (mod && e.key === 'a') {
      e.preventDefault()
      e.stopPropagation()
      return select({ r: 0, c: 0, r2: Math.max(0, used.rows), c2: Math.max(0, used.cols) })
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.stopPropagation()
      e.preventDefault()
      typedIn.current = true
      setEditing((now) => (now === null ? e.key : now + e.key))
    }
  }

  const copy = (e: KeyboardEvent) => {
    const n = norm(sel)
    const rows: string[] = []
    for (let r = n.r1; r <= Math.min(n.r2, n.r1 + 2000); r++) {
      const cols: string[] = []
      for (let c = n.c1; c <= Math.min(n.c2, n.c1 + 200); c++) cols.push(formatValue(getCell(s, r, c)?.v, styleAt(s, r, c)?.numFmt).text)
      rows.push(cols.join('\t'))
    }
    e.preventDefault()
    void navigator.clipboard?.writeText(rows.join('\n')).catch(() => undefined)
  }

  const onPaste = (e: ClipboardEvent) => {
    if (editing !== null) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const values = text.replace(/\r?\n$/, '').split(/\r?\n/).map((l) => l.split('\t'))
    const end = cellName(sel.r + values.length - 1, sel.c + Math.max(...values.map((v) => v.length)) - 1)
    const width = Math.max(...values.map((v) => v.length))
    sheet.change(doc, t('Paste'), [{ op: 'set', sheet: s.name, range: `${cellName(sel.r, sel.c)}:${end}`, values: values.map((v) => [...v, ...Array(width - v.length).fill('')]) }])
  }

  // The picked cell's guide: its drop-down, its rule and its prompt.
  const rule = ruleAt(s, sel.r, sel.c)
  const choices = rule?.type === 'list' ? listChoices(rule, (r) => listValues(wb.sheets, s, r)) : null
  const activeRect = (() => {
    const a = layout.area(sel.r, sel.c)
    return cellRect(a.r1, a.c1, a.r2, a.c2)
  })()
  const st = styleAt(s, sel.r, sel.c)
  const ref = norm(sel).r1 === norm(sel).r2 && norm(sel).c1 === norm(sel).c2 ? cellName(sel.r, sel.c) : sheet.selectionRange(sel)

  return (
    <div class="sheet-view">
      <SheetToolbar doc={doc} />
      <div class="sheet-bar">
        <input
          class="sheet-name-box"
          aria-label={t('Cell')}
          value={ref}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const g = parseRange((e.currentTarget as HTMLInputElement).value.trim().toUpperCase())
            if (g) select({ r: g.r1, c: g.c1, r2: g.r2, c2: g.c2 })
            scroller.current?.focus()
          }}
        />
        {/* i18n-ignore: the usual symbol for a formula */}
        <span class="sheet-fx" aria-hidden="true">fx</span>
        <input
          class="sheet-formula"
          aria-label={t('Formula bar')}
          value={editing ?? entryText(s, sel.r, sel.c)}
          onFocus={() => editing === null && setEditing(entryText(s, sel.r, sel.c))}
          onInput={(e) => setEditing((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(editing ?? '', 'down')
            if (e.key === 'Escape') {
              closed.current = true
              setEditing(null)
              scroller.current?.focus()
            }
          }}
        />
      </div>
      {rule && (rule.prompt || rule.type !== 'checkbox') && <div class="sheet-hint">{rule.prompt ?? ruleLabel(rule)}</div>}
      <div class="sheet-grid" ref={wrap}>
        <canvas ref={canvas} class="sheet-canvas" style={{ width: `${size.w}px`, height: `${size.h}px` }} />
        <div
          class="sheet-scroll"
          ref={scroller}
          tabIndex={0}
          aria-label={t('Sheet {name}', { name: s.name })}
          onScroll={(e) => setScroll({ x: (e.currentTarget as HTMLElement).scrollLeft, y: (e.currentTarget as HTMLElement).scrollTop })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDblClick={(e) => {
            const { r, c } = cellAt(e)
            if (r >= 0 && c >= 0) {
              typedIn.current = false
              setEditing(entryText(s, sel.r, sel.c))
            }
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onWheel={(e) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            doc.zoom.value = Math.min(4, Math.max(0.25, Math.round((zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) * 100) / 100))
          }}
        >
          <div style={{ width: `${HW + totalW * zoom}px`, height: `${HH + totalH * zoom}px` }} />
        </div>
        {choices && editing === null && (
          <button
            class="sheet-dropdown"
            style={{ left: `${activeRect.x + activeRect.w}px`, top: `${activeRect.y}px`, height: `${activeRect.h}px` }}
            aria-label={t('Choices')}
            onClick={() => setList(list ? null : choices)}
          >
            ▾
          </button>
        )}
        {list && (
          <div class="sheet-list" role="listbox" style={{ left: `${activeRect.x}px`, top: `${activeRect.y + activeRect.h}px`, minWidth: `${activeRect.w}px` }}>
            {list.map((v) => (
              <button
                key={v}
                role="option"
                onClick={() => {
                  setList(null)
                  sheet.change(doc, t('Edit {cell}', { cell: cellName(sel.r, sel.c) }), [{ op: 'set', sheet: s.name, cell: cellName(sel.r, sel.c), value: v }])
                  scroller.current?.focus()
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        {editing !== null && (
          <input
            ref={editor}
            class="sheet-editor"
            style={{ left: `${activeRect.x}px`, top: `${activeRect.y}px`, minWidth: `${activeRect.w}px`, height: `${activeRect.h}px`, font: cssFont(st?.font, zoom) }}
            value={editing}
            onInput={(e) => setEditing((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              const arrows: Record<string, 'down' | 'up' | 'left' | 'right'> = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(editing, e.shiftKey ? 'up' : 'down')
              } else if (e.key === 'Tab') {
                e.preventDefault()
                commit(editing, e.shiftKey ? 'left' : 'right', !e.shiftKey)
              } else if (typedIn.current && arrows[e.key] && !e.shiftKey) {
                e.preventDefault()
                commit(editing, arrows[e.key])
              } else if (e.key === 'Escape') {
                closed.current = true
                setEditing(null)
                scroller.current?.focus()
              }
            }}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLElement | null)?.closest?.('.sheet-bar')) return
              if (editing !== null && !closed.current) commit(editing, 'none')
            }}
          />
        )}
      </div>
      <div class="sheet-tabs" role="tablist">
        {wb.sheets.map((x, i) =>
          x.hidden ? null : (
            <button
              key={x.name}
              role="tab"
              aria-selected={i === (wb.active ?? 0)}
              class={i === (wb.active ?? 0) ? 'sheet-tab active' : 'sheet-tab'}
              style={x.tabColor ? { borderBottomColor: x.tabColor } : undefined}
              onClick={() => sheet.activateSheet(doc, x.name)}
              onDblClick={async () => {
                const name = await promptText(t('Rename Sheet'), t('Sheet name'), { initial: x.name, ok: t('Rename') })
                if (name != null) sheet.renameSheet(doc, name)
              }}
            >
              {x.name}
            </button>
          )
        )}
        <button class="sheet-tab add" aria-label={t('Add Sheet')} title={t('Add Sheet')} onClick={() => sheet.addSheet(doc)}>
          +
        </button>
      </div>
    </div>
  )
}
