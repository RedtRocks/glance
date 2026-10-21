#!/usr/bin/env node
/**
 * Turns the spreadsheet template boards into Glance's spreadsheet templates
 * (src/sheet/templates/).
 *
 *   node scripts/build-sheet-templates.mjs <boards folder> [Board ...]
 *
 * A sheet board is a <Name>.dc.html file with two <section aria-label="Sheet N, ...">
 * sheet tabs, each drawn on a real grid: column letters and row numbers give the column
 * widths and row heights, and every designed block sits on a cell or a merged range.
 * This reads each cell's text, number, font, fill, borders and alignment, the merges,
 * the frozen row and the tab names, and keeps drawings (banners, the gingham strip, a
 * jar) as pictures anchored over their cells. What makes the sheet live (formulas,
 * number formats, conditional formatting, drop-downs, tick boxes and charts) is in
 * scripts/sheet-templates/<Board>.json as sheet operations, applied when a template is
 * used, so Glance's own engine checks them. Which boards are used, in what order and
 * with what names, is in scripts/sheet-templates.config.json; with Board names on the
 * command line only those boards are rebuilt.
 *
 * The output is committed; don't edit it by hand. Dev tool only: it uses the Playwright
 * and Chromium installed globally (PLAYWRIGHT overrides where), and the fonts in
 * src/styles/fonts, so nothing is fetched from the network.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/sheet/templates')
const FONTS = join(ROOT, 'src/styles/fonts')
const OVERLAYS = join(ROOT, 'scripts/sheet-templates')
const PICTURE_SCALE = 2

const FONT_FILES = [
  ['Urbanist', 'normal', '100 900', 'urbanist.woff2'],
  ['Fraunces', 'normal', '100 900', 'fraunces.woff2'],
  ['Fraunces', 'italic', '100 900', 'fraunces-italic.woff2'],
  ['Bricolage Grotesque', 'normal', '200 800', 'bricolage-grotesque.woff2'],
  ['Space Grotesk', 'normal', '300 700', 'space-grotesk.woff2'],
  ['Caveat', 'normal', '400 700', 'caveat.woff2'],
  ['DM Serif Display', 'normal', '400', 'dm-serif-display.woff2'],
  ['DM Serif Display', 'italic', '400', 'dm-serif-display-italic.woff2']
]

const [dir, ...only] = process.argv.slice(2)
if (!dir || !existsSync(dir)) {
  console.error('Usage: node scripts/build-sheet-templates.mjs <boards folder> [Board ...]')
  process.exit(1)
}
const config = JSON.parse(readFileSync(join(ROOT, 'scripts/sheet-templates.config.json'), 'utf8'))
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright')

const fontCss = FONT_FILES.map(([family, style, weight, file]) =>
  `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}) format('woff2')}`).join('\n')

function boardHtml(file) {
  return readFileSync(file, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<\/?x-dc>|<\/?helmet>/g, '')
    .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, `<style>${fontCss}</style>`)
}

/**
 * Runs in the page: reads one sheet tab. Returns the grid, the cells and the pictures to
 * cut out (each marked on its element with data-pic so Node can screenshot it).
 */
function extract(index) {
  const section = document.querySelectorAll('section[aria-label^="Sheet"]')[index]
  const S = section.getBoundingClientRect()
  const rel = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height }
  }
  const kids = [...section.children]
  const all = [...section.querySelectorAll('*')].filter((el) => !el.closest('svg') || el.tagName.toLowerCase() === 'svg')
  const textOf = (el) => (el.textContent ?? '').trim()
  const colorOf = (c) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c)
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.05)) return null
    const hex = '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')
    return { hex, alpha: m[4] === undefined ? 1 : Number(m[4]) }
  }
  const blend = (fg, bg) => {
    if (!fg) return null
    if (fg.alpha >= 0.99 || !bg) return fg.hex
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const a = p(fg.hex)
    const b = p(bg)
    return '#' + a.map((v, i) => Math.round(v * fg.alpha + b[i] * (1 - fg.alpha)).toString(16).padStart(2, '0')).join('')
  }

  // 1. Column letters and row numbers.
  const letters = all.filter((el) => el.tagName === 'DIV' && /^[A-Z]{0,3}$/.test(textOf(el)) && el.children.length === 0)
  const byTop = new Map()
  for (const el of letters) {
    const r = rel(el)
    if (r.h > 30 || r.w > 300 || r.y > 80) continue
    const k = Math.round(r.y)
    byTop.set(k, [...(byTop.get(k) ?? []), { el, r }])
  }
  let colRow = []
  for (const g of byTop.values()) if (g.filter((x) => textOf(x.el)).length > colRow.filter((x) => textOf(x.el)).length) colRow = g
  colRow.sort((a, b) => a.r.x - b.r.x)
  const cols = colRow.map((x) => ({ x: x.r.x, w: x.r.w, label: textOf(x.el) }))
  const headerBottom = Math.max(...colRow.map((x) => x.r.y + x.r.h))
  const X0 = cols[0].x
  const numbers = all.filter((el) => el.tagName === 'DIV' && /^\d*$/.test(textOf(el)) && el.children.length === 0).map((el) => ({ el, r: rel(el) })).filter((x) => x.r.x < 2 && x.r.w <= X0 + 1 && x.r.h < 120 && x.r.y >= headerBottom - 1)
  numbers.sort((a, b) => a.r.y - b.r.y)
  const rows = []
  for (const n of numbers) if (!rows.length || n.r.y >= rows[rows.length - 1].y + rows[rows.length - 1].h - 1) rows.push({ y: n.r.y, h: n.r.h, label: textOf(n.el) })
  // Rows taller than shown are cut by the tab strip; the board's own helpers give each row's full height via the grid lines, so take heights from consecutive tops.
  for (let i = 0; i < rows.length - 1; i++) rows[i].h = rows[i + 1].y - rows[i].y
  const Y0 = rows[0].y
  // 2. The tab strip at the bottom: tabs have rounded lower corners.
  const tabEls = all.filter((el) => {
    const r = rel(el)
    const cs = getComputedStyle(el)
    return r.y > S.height - 40 && textOf(el) && parseFloat(cs.borderBottomLeftRadius) >= 4 && el.children.length === 0
  })
  const tabs = tabEls.map((el) => {
    const cs = getComputedStyle(el)
    const c = colorOf(cs.borderBottomStyle !== 'none' && parseFloat(cs.borderBottomWidth) >= 2 ? cs.borderBottomColor : cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) >= 2 ? cs.borderTopColor : 'rgba(0,0,0,0)')
    return { name: textOf(el), active: Number(cs.fontWeight) >= 700, color: c?.hex ?? null, x: rel(el).x }
  }).sort((a, b) => a.x - b.x)
  const tabTop = Math.min(S.height - 30, ...tabEls.map((el) => rel(el).y))
  const gridBottom = tabTop
  const edgesX = [...cols.map((c) => c.x), cols[cols.length - 1].x + cols[cols.length - 1].w]
  const edgesY = [...rows.map((r) => r.y), rows[rows.length - 1].y + rows[rows.length - 1].h]
  const snap = (v, edges) => {
    let best = -1
    let d = 2.6
    edges.forEach((e, i) => {
      if (Math.abs(e - v) <= d) {
        d = Math.abs(e - v)
        best = i
      }
    })
    return best
  }
  const paperCs = getComputedStyle(section)
  const paper = colorOf(paperCs.backgroundColor)?.hex ?? '#ffffff'
  // The frozen-pane line: a 2px full-width bar.
  let frozen = 0
  for (const el of kids) {
    const r = rel(el)
    if (el.tagName === 'DIV' && r.h <= 2.5 && r.h >= 1.5 && r.w >= S.width - 2 && r.y > Y0) {
      const i = snap(r.y + 1, edgesY)
      if (i > 0) frozen = i
    }
  }
  // 3. Cells: absolutely placed divs whose edges sit on grid lines.
  const cells = []
  const pictures = []
  const floats = []
  const hdrSet = new Set([...colRow.map((x) => x.el), ...numbers.map((x) => x.el)])
  const inGrid = (r) => r.x >= X0 - 2 && r.y >= Y0 - 2 && r.y + r.h <= gridBottom + 2
  let picN = 0
  const markPic = (el, r, why) => {
    el.setAttribute('data-pic', String(picN))
    pictures.push({ n: picN++, rect: r, why })
  }
  // Text runs of a cell box: each text node with its font, grouped into lines.
  const runsOf = (box) => {
    const out = []
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!/\S/.test(t.data) || t.parentElement.closest('svg')) continue
      const el = t.parentElement
      const cs = getComputedStyle(el)
      const range = document.createRange()
      range.selectNodeContents(t)
      const rects = [...range.getClientRects()].filter((q) => q.width > 0.3)
      if (!rects.length) continue
      // Text hidden by a clipped parent doesn't count.
      const tt = cs.textTransform === 'uppercase' ? t.data.toUpperCase() : t.data
      let bgEl = el
      let bg = null
      while (bgEl && bgEl !== box.parentElement) {
        const c = colorOf(getComputedStyle(bgEl).backgroundColor)
        if (c) {
          bg = c
          break
        }
        bgEl = bgEl.parentElement
      }
      out.push({
        text: tt.replace(/\s+/g, ' '),
        top: rects[0].top - S.top,
        bottom: rects[0].bottom - S.top,
        left: rects[0].left - S.left,
        family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight),
        italic: cs.fontStyle === 'italic',
        underline: /underline/.test(cs.textDecorationLine),
        strike: /line-through/.test(cs.textDecorationLine),
        color: colorOf(cs.color),
        pill: bg && bgEl !== box ? { bg: bg.hex, el: bgEl.tagName } : null,
        wrap: /normal|pre-wrap/.test(cs.whiteSpace) && rects.length > 1
      })
    }
    return out
  }
  const borderOf = (cs, side) => {
    const w = parseFloat(cs[`border${side}Width`])
    const st = cs[`border${side}Style`]
    if (!w || st === 'none' || st === 'hidden') return null
    const c = colorOf(cs[`border${side}Color`])
    if (!c) return null
    const style = st === 'double' ? 'double' : st === 'dashed' ? 'dashed' : st === 'dotted' ? 'dotted' : w >= 3 ? 'thick' : w >= 2 ? 'medium' : 'thin'
    return { style, color: blend(c, [255, 255, 255].map(() => 0) && null) ?? c.hex }
  }
  for (const el of kids) {
    if (hdrSet.has(el)) continue
    const tag = el.tagName.toLowerCase()
    const r = rel(el)
    if (!inGrid(r) || r.w < 1 || r.h < 1) continue
    const cs = getComputedStyle(el)
    if (tag === 'svg') {
      // The full-size grid-line drawing isn't a picture.
      if (r.w >= S.width - 2 && r.h >= S.height - 60) continue
      markPic(el, r, 'svg')
      continue
    }
    if (tag !== 'div') continue
    // Selection outline and fill handle.
    if (cs.borderTopWidth === '2px' && cs.borderLeftWidth === '2px' && !textOf(el) && colorOf(cs.backgroundColor) === null) continue
    if (r.w <= 8 && r.h <= 8) continue
    const c1 = snap(r.x, edgesX)
    const c2 = snap(r.x + r.w, edgesX)
    const r1 = snap(r.y, edgesY)
    const r2 = snap(r.y + r.h, edgesY)
    const hasArt = cs.backgroundImage !== 'none' || [...el.querySelectorAll('svg')].some((s) => {
      const q = s.getBoundingClientRect()
      return q.width > 40 && q.height > 30
    })
    if (c1 < 0 || c2 <= c1 || r1 < 0 || r2 <= r1) {
      // Off the grid: text goes to the cell under its top-left, drawings become pictures.
      if (textOf(el)) floats.push({ rect: r, runs: runsOf(el) })
      if (hasArt || !textOf(el)) markPic(el, r, 'float')
      continue
    }
    if (cs.backgroundImage !== 'none') markPic(el, r, 'pattern')
    const fill = colorOf(cs.backgroundColor)
    const runs = runsOf(el)
    const justify = cs.display.includes('flex') ? (cs.flexDirection.startsWith('column') ? cs.alignItems : cs.justifyContent) : cs.textAlign
    const alignItems = cs.display.includes('flex') ? (cs.flexDirection.startsWith('column') ? cs.justifyContent : cs.alignItems) : 'center'
    const h = /end|right/.test(justify) ? 'right' : /center/.test(justify) ? 'center' : 'left'
    // Text pushed right with margin-left: auto counts as right-aligned when it's the only text.
    cells.push({
      c1, r1, c2: c2 - 1, r2: r2 - 1,
      fill: fill ? blend(fill, colorOf(paperCs.backgroundColor) ? [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16)) : [255, 255, 255]) : null,
      borders: { top: borderOf(cs, 'Top'), right: borderOf(cs, 'Right'), bottom: borderOf(cs, 'Bottom'), left: borderOf(cs, 'Left') },
      h,
      v: /start|flex-start|top/.test(alignItems) ? 'top' : /end|bottom/.test(alignItems) ? 'bottom' : 'middle',
      padLeft: parseFloat(cs.paddingLeft) || 0,
      runs,
      art: hasArt
    })
    // Bigger drawings inside a cell box are pictures too.
    for (const s of el.querySelectorAll('svg')) {
      const q = rel(s)
      if (q.w > 40 && q.h > 30) markPic(s, q, 'svg-in-cell')
    }
  }
  return {
    label: section.getAttribute('aria-label'),
    cols: cols.map((c) => Math.round(c.w)),
    colLabels: cols.map((c) => c.label),
    rows: rows.map((r) => Math.round(r.h)),
    X0, Y0, paper, frozen, tabs, cells, floats, pictures,
    edgesX, edgesY
  }
}

const css2pt = (px) => Math.round(px * 0.75 * 4) / 4

/** Turns what the page found into a workbook sheet (the shape of src/core/sheet/model.ts). */
function toSheet(x, name, families) {
  const cells = {}
  const merges = []
  const notes = []
  const name1 = (c, r) => `${colName(c)}${r + 1}`
  const fontOf = (run) => {
    const f = {}
    if (run.family && run.family !== 'Times New Roman') f.name = families.has(run.family) ? run.family : 'Urbanist'
    f.size = css2pt(run.size)
    if (run.weight >= 600) f.bold = true
    if (run.italic) f.italic = true
    if (run.underline) f.underline = true
    if (run.strike) f.strike = true
    if (run.color) f.color = run.color.hex
    return f
  }
  // Text placed off the grid (a title over a banner) goes into the cell under its top-left, so it
  // stays editable: into that cell's box when it has no text of its own, else into a new cell.
  const cellOf = (f) => ({
    c: x.edgesX.findIndex((e, i) => f.rect.x >= e - 1 && f.rect.x < (x.edgesX[i + 1] ?? Infinity)),
    r: x.edgesY.findIndex((e, i) => f.rect.y >= e - 1 && f.rect.y < (x.edgesY[i + 1] ?? Infinity))
  })
  const placed = new Set()
  for (const f of x.floats) {
    const { c, r } = cellOf(f)
    if (c < 0 || r < 0 || !f.runs.some((q) => q.text.trim())) continue
    const box = x.cells.find((b) => b.c1 <= c && c <= b.c2 && b.r1 <= r && r <= b.r2)
    if (box && box.runs.some((q) => q.text.trim()) && !box.floated) continue
    if (box) {
      box.runs = [...box.runs, ...f.runs]
      box.h = 'left'
      box.floated = true
    } else x.cells.push({ c1: c, r1: r, c2: c, r2: r, fill: null, borders: {}, h: 'left', v: 'middle', padLeft: 0, runs: f.runs, floated: true })
    placed.add(f)
  }
  x.floats = x.floats.filter((f) => !placed.has(f))
  for (const c of x.cells) {
    const key = name1(c.c1, c.r1)
    if (c.r2 > c.r1 || c.c2 > c.c1) merges.push(`${key}:${name1(c.c2, c.r2)}`)
    const style = {}
    if (c.fill && c.fill !== x.paper) style.fill = c.fill
    const border = {}
    for (const [k, b] of Object.entries(c.borders)) if (b) border[k] = b
    if (Object.keys(border).length) style.border = border
    // Formula captions (small italic text starting with =) are notes for the build, not content.
    const runs = c.runs.filter((r) => {
      if (/^=/.test(r.text.trim()) && r.size <= 10) {
        notes.push({ cell: key, hint: r.text.trim() })
        return false
      }
      return true
    })
    // Group runs into lines by their top.
    const lines = []
    for (const r of runs) {
      const last = lines[lines.length - 1]
      if (last && r.top < last.bottom - 2) {
        last.runs.push(r)
        last.bottom = Math.max(last.bottom, r.bottom)
      } else lines.push({ top: r.top, bottom: r.bottom, runs: [r] })
    }
    const prev = cells[key]
    if (!lines.length) {
      if (Object.keys(style).length) cells[key] = { ...prev, s: { ...prev?.s, ...style } }
      continue
    }
    const align = { v: c.v }
    if (c.h !== 'left') align.h = c.h
    // A lone value pushed right by margin-left: auto.
    if (c.h === 'left' && lines.length === 1 && lines[0].runs.length === 1 && lines[0].runs[0].left - (x.edgesX[c.c1]) > (x.edgesX[c.c2 + 1] - x.edgesX[c.c1]) * 0.45 && c.runs.length === 1) align.h = 'right'
    if (lines.length > 1 || runs.some((r) => r.wrap)) align.wrap = true
    if (c.padLeft >= 12 && align.h !== 'right' && align.h !== 'center') align.indent = Math.round((c.padLeft - 4) / 9)
    style.align = align
    const lead = lines.flatMap((l) => l.runs).reduce((a, b) => (b.size > a.size ? b : a))
    style.font = fontOf(lead)
    const text = lines.map((l) => l.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim()).join('\n')
    const cell = { s: style, shown: text }
    if (lines.length > 1 || new Set(runs.map((r) => JSON.stringify(fontOf(r)))).size > 1) {
      cell.v = text
      cell.rich = lines.flatMap((l, i) => {
        const parts = l.runs.map((r, j) => ({ text: (j === 0 ? r.text.replace(/^\s+/, '') : r.text).replace(/\s+/g, ' '), font: fontOf(r) }))
        if (parts.length) parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, '')
        if (i > 0 && parts.length) parts[0].text = '\n' + parts[0].text
        return parts.filter((p) => p.text)
      })
      // Where two runs touch without a space, keep them apart as the board showed.
    } else cell.v = text
    const pill = runs.find((r) => r.pill)
    if (pill) cell.pill = pill.pill.bg
    cells[key] = cell
  }
  // Text placed off the grid: into the cell under its top-left, if that cell is empty.
  for (const f of x.floats) {
    const c = x.edgesX.findIndex((e, i) => f.rect.x >= e - 1 && f.rect.x < (x.edgesX[i + 1] ?? Infinity))
    const r = x.edgesY.findIndex((e, i) => f.rect.y >= e - 1 && f.rect.y < (x.edgesY[i + 1] ?? Infinity))
    if (c < 0 || r < 0) continue
    notes.push({ cell: name1(c, r), float: f.runs.map((q) => q.text).join(' ').replace(/\s+/g, ' ').trim() })
  }
  return { cells, merges, notes }
}

function colName(c) {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
const page = await browser.newPage({ viewport: { width: 2080, height: 938 }, deviceScaleFactor: PICTURE_SCALE })
const families = new Set(FONT_FILES.map((f) => f[0]))
mkdirSync(OUT, { recursive: true })
const index = []
for (const entry of config.boards) {
  index.push(entry)
  if (only.length && !only.includes(entry.board)) continue
  const file = join(dir, `${entry.board}.dc.html`)
  if (!existsSync(file)) throw new Error(`no board ${file}`)
  await page.setContent(boardHtml(file), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const count = await page.evaluate(() => document.querySelectorAll('section[aria-label^="Sheet"]').length)
  const overlayFile = join(OVERLAYS, `${entry.board}.json`)
  const overlay = existsSync(overlayFile) ? JSON.parse(readFileSync(overlayFile, 'utf8')) : {}
  const sheets = []
  const media = {}
  const report = []
  for (let i = 0; i < count; i++) {
    const x = await page.evaluate(extract, i)
    const floatTops = x.floats.filter((f) => f.runs.some((q) => q.text.trim())).map((f) => f.rect)
    const active = x.tabs.find((t) => t.active) ?? x.tabs[i]
    const name = (overlay.names?.[i]) ?? active?.name ?? `Sheet${i + 1}`
    const sheet = toSheet(x, name, families)
    const cols = {}
    x.cols.forEach((w, c) => (cols[c] = { size: w, s: { fill: x.paper } }))
    const rows = {}
    x.rows.forEach((h, r) => (rows[r] = { size: h }))
    const drop = new Set((overlay.sheets?.[name]?.dropPictures ?? []).map(String))
    const images = []
    for (const pic of x.pictures) {
      // Which cells the picture covers, to anchor it (with pixel offsets) and to name it.
      const at = (v, edges) => {
        let i = edges.findIndex((e, j) => v >= e - 0.5 && v < (edges[j + 1] ?? Infinity) - 0.5)
        if (i < 0) i = v < edges[0] ? 0 : edges.length - 1
        return { i, d: Math.max(0, Math.round(v - edges[i])) }
      }
      const a = at(pic.rect.x, x.edgesX)
      const b = at(pic.rect.y, x.edgesY)
      const c = at(pic.rect.x + pic.rect.w, x.edgesX)
      const d = at(pic.rect.y + pic.rect.h, x.edgesY)
      const range = `${colName(a.i)}${b.i + 1}:${colName(c.d ? c.i : Math.max(a.i, c.i - 1))}${(d.d ? d.i : Math.max(b.i, d.i - 1)) + 1}`
      const id = `${entry.id}-${i + 1}-${pic.n}`
      report.push(`  picture ${pic.n} (${pic.why}) ${range} ${Math.round(pic.rect.w)}x${Math.round(pic.rect.h)}${drop.has(String(pic.n)) || drop.has(range) ? ' dropped' : ''}`)
      // A band drawn behind floating text is the text's backdrop: pictures sit over cells in Glance
      // and Excel alike, so it would hide the text, now in cells. The cells' fill shows instead.
      const band = pic.rect.w >= 2 * pic.rect.h
      const textIn = () => {
        for (let r = b.i; r <= d.i; r++) for (let cc = a.i; cc <= c.i; cc++) if (String(sheet.cells[`${colName(cc)}${r + 1}`]?.v ?? '').trim()) return true
        return false
      }
      const backdrop = band && ((pic.why === 'svg' && floatTops.some((f) => f.x >= pic.rect.x && f.x < pic.rect.x + pic.rect.w && f.y >= pic.rect.y && f.y < pic.rect.y + pic.rect.h)) || (pic.why === 'svg-in-cell' && textIn()))
      if (backdrop) report[report.length - 1] += ' dropped (behind text)'
      if (backdrop || drop.has(String(pic.n)) || drop.has(range)) continue
      const png = await shoot(page, i, pic.n)
      media[`media/${id}.png`] = png.toString('base64')
      images.push({ id: `picture${images.length + 1}`, media: `media/${id}.png`, anchor: { from: { r: b.i, c: a.i, dx: a.d, dy: b.d }, to: { r: d.i, c: c.i, dx: c.d, dy: d.d } } })
    }
    const tabColor = active?.color ?? undefined
    sheets.push({
      name,
      cells: sheet.cells,
      cols,
      rows,
      merges: sheet.merges,
      ...(x.frozen ? { frozen: { rows: x.frozen, cols: 0 } } : {}),
      cf: [],
      validations: [],
      images,
      charts: [],
      ...(tabColor ? { tabColor } : {}),
      gridlines: true
    })
    report.unshift(`${entry.board} sheet ${i + 1} "${name}": ${x.cols.length} cols, ${x.rows.length} rows, ${Object.keys(sheet.cells).length} cells, frozen ${x.frozen}, tabs ${x.tabs.map((t) => t.name).join('/')}`)
    for (const n of sheet.notes) report.push(`  ${n.cell}: ${n.hint ? 'formula ' + n.hint : 'floating text "' + n.float + '"'}`)
    sheets[sheets.length - 1].tabs = x.tabs.map((t) => ({ name: t.name, color: t.color }))
  }
  // Tabs the board names but doesn't draw become empty sheets; the overlay fills them.
  const tabs = sheets.flatMap((s) => s.tabs)
  for (const s of sheets) delete s.tabs
  for (const t of tabs) if (!sheets.some((s) => s.name === t.name) && !(overlay.skipTabs ?? []).includes(t.name)) {
    const at = tabs.findIndex((x) => x.name === t.name)
    sheets.splice(Math.min(at, sheets.length), 0, { name: t.name, cells: {}, cols: {}, rows: {}, merges: [], cf: [], validations: [], images: [], charts: [], ...(t.color ? { tabColor: t.color } : {}) })
  }
  const spec = { id: entry.id, sheets, ops: overlay.ops ?? [], today: overlay.today ?? null, checks: overlay.checks ?? {} }
  writeSpec(entry, spec, media)
  // What was found, for whoever writes the board's overlay (set SHEET_REPORT to a folder).
  if (process.env.SHEET_REPORT) writeFileSync(join(process.env.SHEET_REPORT, `${entry.board}.txt`), report.join('\n') + '\n')
  console.log(report[0], `(${Object.keys(media).length} pictures)`)
}
await browser.close()
writeIndex(index)

/** Screenshots one picture on its own, on a clear background. */
async function shoot(page, sheetIndex, n) {
  await page.evaluate(({ sheetIndex, n }) => {
    const section = document.querySelectorAll('section[aria-label^="Sheet"]')[sheetIndex]
    const target = section.querySelector(`[data-pic="${n}"]`)
    const keep = new Set()
    for (let el = target; el; el = el.parentElement) keep.add(el)
    const style = document.createElement('style')
    style.id = 'pic-only'
    style.textContent = 'body, body > div, section { background: transparent !important; box-shadow: none !important }'
    document.head.append(style)
    for (const el of document.querySelectorAll('section *, section')) {
      if (keep.has(el) || target.contains(el)) continue
      el.setAttribute('data-hid', el.style.visibility)
      el.style.visibility = 'hidden'
    }
    for (const el of keep) if (el !== target && el.tagName === 'DIV') {
      el.setAttribute('data-bg', el.style.background ?? '')
      el.style.setProperty('background', 'transparent', 'important')
      el.style.setProperty('border-color', 'transparent', 'important')
      el.style.setProperty('color', 'transparent', 'important')
    }
    // Text inside the picture's own box isn't part of the drawing.
    for (const t of target.querySelectorAll('*')) if (!t.closest('svg') && t.childNodes.length && [...t.childNodes].some((c) => c.nodeType === 3 && /\S/.test(c.data))) t.style.setProperty('color', 'transparent', 'important')
  }, { sheetIndex, n })
  const el = await page.$(`section[aria-label^="Sheet"] >> nth=${sheetIndex}`)
  const target = await el.$(`[data-pic="${n}"]`)
  const png = await target.screenshot({ omitBackground: true })
  await page.evaluate(({ sheetIndex }) => {
    document.getElementById('pic-only')?.remove()
    for (const el of document.querySelectorAll('[data-hid]')) {
      el.style.visibility = el.getAttribute('data-hid')
      el.removeAttribute('data-hid')
    }
    for (const el of document.querySelectorAll('[data-bg]')) {
      el.style.removeProperty('background')
      el.style.removeProperty('border-color')
      el.style.removeProperty('color')
      el.removeAttribute('data-bg')
    }
    for (const t of document.querySelectorAll('section *')) t.style.removeProperty('color')
    void sheetIndex
  }, { sheetIndex })
  return png
}

/** Text a person reads in the template, marked for translation: every text cell and rich run. */
function writeSpec(entry, spec, media) {
  const lines = []
  lines.push(`// Generated by scripts/build-sheet-templates.mjs from the ${entry.board} board and scripts/sheet-templates/${entry.board}.json. Don't edit by hand: change those and run the script again.`)
  lines.push(`import type { SheetTemplate } from '../../core/sheet/template'`)
  lines.push('// i18n-ignore: sample data; templateWorkbook() passes its text through the translator when the template is used')
  lines.push(`const template: SheetTemplate = ${JSON.stringify(spec)}`)
  lines.push('')
  lines.push('export default template')
  writeFileSync(join(OUT, `${entry.id}.ts`), lines.join('\n') + '\n')
  // Pictures in their own module, so the gallery can show a template without them.
  const art = [`// Generated by scripts/build-sheet-templates.mjs: the ${entry.board} board's pictures as PNG, base64. Don't edit by hand.`, `const media: Record<string, string> = ${JSON.stringify(media, null, 0).replace(/","/g, '",\n  "')}`, '', 'export default media', '']
  writeFileSync(join(OUT, `${entry.id}.art.ts`), art.join('\n'))
}

function writeIndex(boards) {
  const lines = [
    `// Generated by scripts/build-sheet-templates.mjs from scripts/sheet-templates.config.json. Don't edit by hand.`,
    `import { msg } from '../../i18n'`,
    `import type { SheetTemplate, SheetTemplateInfo } from '../../core/sheet/template'`,
    '',
    '/** The spreadsheet templates, in the order the start screen shows them. */',
    'export const SHEET_TEMPLATES: SheetTemplateInfo[] = [',
    boards.map((b) => `  { id: ${JSON.stringify(b.id)}, name: msg(${JSON.stringify(b.name)}), blurb: msg(${JSON.stringify(b.blurb)}), purpose: ${JSON.stringify(b.purpose)}, look: msg(${JSON.stringify(b.look)}), fonts: ${JSON.stringify(b.fonts ?? [])}, sheets: ${JSON.stringify(b.sheets ?? [])} }`).join(',\n'),
    ']',
    '',
    "/** Each template's workbook, loaded only when it's used or previewed. */",
    'export const SHEET_TEMPLATE_LOADERS: Record<string, () => Promise<SheetTemplate>> = {',
    boards.map((b) => `  ${JSON.stringify(b.id)}: () => import('./${b.id}').then((m) => m.default)`).join(',\n'),
    '}',
    '',
    "/** Each template's pictures (banners and drawings), as base64 PNG by media key. */",
    'export const SHEET_TEMPLATE_ART: Record<string, () => Promise<Record<string, string>>> = {',
    boards.map((b) => `  ${JSON.stringify(b.id)}: () => import('./${b.id}.art').then((m) => m.default)`).join(',\n'),
    '}',
    ''
  ]
  writeFileSync(join(OUT, 'index.ts'), lines.join('\n'))
  // Templates no longer in the config.
  for (const f of readdirSync(OUT)) {
    const id = f.replace(/(\.art)?\.ts$/, '')
    if (f !== 'index.ts' && f.endsWith('.ts') && !boards.some((b) => b.id === id)) unlinkSync(join(OUT, f))
  }
}
