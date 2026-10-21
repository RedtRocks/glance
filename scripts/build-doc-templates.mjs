#!/usr/bin/env node
/**
 * Turns the designed document boards into Glance's document looks (src/doc/designs/).
 *
 *   node scripts/build-doc-templates.mjs <boards folder> [Board ...]
 *
 * A board is a <Name>.dc.html file with three <section aria-label="Page N, ..."> A4 pages
 * (595 by 842), drawn with inline styles and inline SVG. Each page becomes a design:
 *
 * - A fixed page keeps its drawing as art and turns its text into editable text boxes,
 *   as decks' designed slides do (template-extract.mjs). Rows of three or more cells that
 *   line up become real tables, so rows can be added and totals worked out again.
 * - A flowing page (flow in the config) keeps its frame (art, running header, footer) and
 *   turns the parts from the start text to the end text into blocks: headings,
 *   paragraphs with bold and italic runs, lists, quotes, callouts, tables, columns and the
 *   template's drawings. The styles they use (fonts, sizes, colours, spacing) become the
 *   look's styles, so new text in any amount flows onto as many pages as it needs.
 *
 * Which boards are used, their names and each page's role are in
 * scripts/doc-templates.config.json; with Board names on the command line only those are
 * rebuilt. The output is committed; don't edit it by hand. Dev tool only: it uses the
 * Playwright and Chromium installed globally (PLAYWRIGHT and CHROMIUM override where they
 * are), and the fonts in src/styles/fonts, so nothing is fetched from the network.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILIES, boardHtml, extract, nameSlots } from './template-extract.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/doc/designs')
const PURPOSES = ['School', 'Work', 'Events', 'Personal', 'Clubs']
const PAGE = 'section[aria-label^="Page"]'

const [dir, ...only] = process.argv.slice(2)
if (!dir || !existsSync(dir)) {
  console.error('Usage: node scripts/build-doc-templates.mjs <boards folder> [Board ...]')
  process.exit(1)
}
const config = JSON.parse(readFileSync(join(ROOT, 'scripts/doc-templates.config.json'), 'utf8'))
const canvas = existsSync(join(dir, 'canvas.json')) ? JSON.parse(readFileSync(join(dir, 'canvas.json'), 'utf8')) : { boards: {} }

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright')

/**
 * Runs in the page before extract(): marks the flowing parts and the tables with
 * data-g-skip so extract leaves them out of the art and the text boxes, and returns what
 * they hold.
 */
function collect({ index, selector, flow, charts, prefix }) {
  const section = document.querySelectorAll(selector)[index]
  const S = section.getBoundingClientRect()
  const cs = (el) => getComputedStyle(el)
  const R = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height, r: r.right - S.left, b: r.bottom - S.top }
  }
  const round = (n) => Math.round(n * 100) / 100
  const rgba = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css ?? '')
    if (!m) return null
    const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { hex: '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), a }
  }
  const colourOf = (css) => rgba(css)?.hex ?? '#000000'
  const painted = (css) => (rgba(css)?.a ?? 0) > 0.05
  const family = (stack) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  const visibleText = (el) => /\S/.test(el.textContent ?? '')
  const isSvg = (el) => el instanceof SVGElement
  const pageBg = colourOf(cs(section).backgroundColor)
  const lineHeightOf = (el) => {
    const c = cs(el)
    const lh = parseFloat(c.lineHeight)
    if (Number.isFinite(lh)) return lh / parseFloat(c.fontSize)
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;left:-9999px;white-space:pre'
    probe.style.font = c.font
    probe.textContent = 'Hg'
    document.body.append(probe)
    const h = probe.getBoundingClientRect().height
    probe.remove()
    return h / parseFloat(c.fontSize)
  }
  const transform = (c) => (c.textTransform === 'none' ? undefined : c.textTransform)
  const alignOf = (c) => (c.textAlign === 'center' ? 'center' : c.textAlign === 'right' || c.textAlign === 'end' ? 'right' : 'left')
  const textStyle = (el, extra = {}) => {
    const c = cs(el)
    const size = parseFloat(c.fontSize)
    const st = {
      font: family(c.fontFamily), size: round(size), weight: Number(c.fontWeight), italic: c.fontStyle === 'italic', colour: colourOf(c.color),
      lineHeight: Math.round(lineHeightOf(el) * 1000) / 1000, letterSpacing: round(parseFloat(c.letterSpacing) || 0), transform: transform(c), align: alignOf(c),
      before: round(parseFloat(c.marginTop) || 0), after: round(parseFloat(c.marginBottom) || 0)
    }
    const indent = parseFloat(c.textIndent) || 0
    if (indent) st.indent = round(indent)
    const pad = parseFloat(c.paddingLeft) || 0
    const bl = parseFloat(c.borderLeftWidth) || 0
    if (bl >= 2 && c.borderLeftStyle !== 'none') st.bar = { w: round(bl), colour: colourOf(c.borderLeftColor), gap: round(pad) }
    else if (pad) st.padLeft = round(pad)
    const bb = parseFloat(c.borderBottomWidth) || 0
    if (bb >= 0.5 && c.borderBottomStyle !== 'none') st.rule = { w: round(bb), colour: colourOf(c.borderBottomColor), gap: round(parseFloat(c.paddingBottom) || 0) }
    if (painted(c.backgroundColor) && colourOf(c.backgroundColor) !== pageBg) {
      st.bg = { colour: colourOf(c.backgroundColor), radius: round(parseFloat(c.borderTopLeftRadius) || 0), pad: ['Top', 'Right', 'Bottom', 'Left'].map((s) => round(parseFloat(c[`padding${s}`]) || 0)) }
    }
    return { ...st, ...extra }
  }
  const boxStyle = (el) => {
    const c = cs(el)
    const box = { radius: round(parseFloat(c.borderTopLeftRadius) || 0), pad: ['Top', 'Right', 'Bottom', 'Left'].map((s) => round(parseFloat(c[`padding${s}`]) || 0)), before: round(parseFloat(c.marginTop) || 0), after: round(parseFloat(c.marginBottom) || 0), gap: round(parseFloat(c.rowGap) || 0) }
    if (painted(c.backgroundColor)) box.bg = colourOf(c.backgroundColor)
    const bl = parseFloat(c.borderLeftWidth) || 0
    const bt = parseFloat(c.borderTopWidth) || 0
    if (bt >= 0.5 && c.borderTopStyle !== 'none') box.border = { w: round(bt), colour: colourOf(c.borderTopColor), ...(c.borderTopStyle === 'dashed' ? { dashed: true } : {}) }
    if (bl >= 2 && bl > bt + 0.5) box.bar = { w: round(bl), colour: colourOf(c.borderLeftColor) }
    return box
  }

  // Inline runs: bold, italic and colour where they differ from the block's own.
  const runsOf = (el) => {
    const base = cs(el)
    const baseWeight = Number(base.fontWeight)
    const baseColour = colourOf(base.color)
    const pre = /^pre/.test(base.whiteSpace)
    const runs = []
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const p = n.parentElement
          const c = cs(p)
          if (c.display === 'none') continue
          const text = pre ? n.data : n.data.replace(/\s+/g, ' ')
          if (!text) continue
          const run = { text }
          if (Number(c.fontWeight) >= 600 && baseWeight < 600) run.b = true
          if (c.fontStyle === 'italic' && base.fontStyle !== 'italic') run.i = true
          if (colourOf(c.color) !== baseColour) run.c = colourOf(c.color)
          const a = p.closest('a')
          if (a && el.contains(a) && /^(https?:|mailto:)/.test(a.getAttribute('href') ?? '')) run.href = a.getAttribute('href')
          runs.push(run)
        } else if (n.nodeName === 'BR') runs.push({ text: '\n' })
        else if (n.nodeType === 1 && !isSvg(n)) walk(n)
      }
    }
    walk(el)
    // White space at the ends and around line breaks takes no room.
    const out = []
    for (const r of runs) {
      const last = out.at(-1)
      if (last && last.b === r.b && last.i === r.i && last.c === r.c && last.href === r.href) last.text += r.text
      else out.push({ ...r })
    }
    for (const r of out) r.text = r.text.replace(/ *\n */g, '\n')
    if (out[0]) out[0].text = out[0].text.replace(/^\s+/, '')
    if (out.at(-1)) out.at(-1).text = out.at(-1).text.replace(/\s+$/, '')
    return out.filter((r) => r.text)
  }

  const inlineOnly = (el) => [...el.querySelectorAll('*')].every((k) => {
    if (isSvg(k) || k.tagName === 'IMG') return false
    const d = cs(k).display
    return k.tagName === 'BR' || d.startsWith('inline') || d === 'none' || d === 'contents'
  })

  // Template drawings: trusted HTML, kept as they are, placed by their box.
  const arts = []
  const snapshot = (els) => {
    const rs = els.map(R)
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y))
    const x1 = Math.max(...rs.map((r) => r.r)), y1 = Math.max(...rs.map((r) => r.b))
    const id = `${prefix}a${arts.length + 1}`
    const parts = els.map((el, i) => {
      const c = cs(el)
      const clone = el.cloneNode(true)
      clone.removeAttribute('data-g-skip')
      clone.style.position = 'absolute'
      clone.style.inset = 'auto'
      clone.style.margin = '0'
      clone.style.left = `${round(rs[i].x - x0)}px`
      clone.style.top = `${round(rs[i].y - y0)}px`
      clone.style.width = `${round(rs[i].w)}px`
      clone.style.height = `${round(rs[i].h)}px`
      clone.style.boxSizing = 'border-box'
      clone.style.fontFamily = c.fontFamily
      clone.style.fontSize = c.fontSize
      clone.style.color = c.color
      clone.style.lineHeight = c.lineHeight
      return clone
    })
    const root = document.createElement('div')
    root.style.cssText = `position:relative;width:${round(x1 - x0)}px;height:${round(y1 - y0)}px`
    root.append(...parts)
    // SVG ids made unique to this drawing, so two drawings on one page don't share a pattern.
    const ids = new Map()
    for (const e of root.querySelectorAll('[id]')) {
      ids.set(e.id, `${id}-${e.id}`)
      e.id = `${id}-${e.id}`
    }
    if (ids.size) {
      for (const e of root.querySelectorAll('*')) {
        for (const a of [...e.attributes]) {
          let v = a.value.replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, (all, k) => (ids.has(k) ? `url(#${ids.get(k)})` : all))
          if (/href$/.test(a.name) && v.startsWith('#') && ids.has(v.slice(1))) v = `#${ids.get(v.slice(1))}`
          if (v !== a.value) e.setAttribute(a.name, v)
        }
      }
    }
    const html = new XMLSerializer().serializeToString(root).replace(/\s+aria-hidden="true"/g, '')
    arts.push({ id, html, w: round(x1 - x0), h: round(y1 - y0) })
    return { t: 'art', art: id, w: round(x1 - x0), h: round(y1 - y0) }
  }
  const chartFor = (els) => {
    const text = els.map((e) => e.textContent ?? '').join(' ')
    const c = (charts ?? []).find((ch) => text.includes(ch.near))
    if (!c) return null
    const colours = []
    for (const e of els) for (const k of [e, ...e.querySelectorAll('*')]) {
      const fill = k.getAttribute?.('fill') ?? ''
      const bg = isSvg(k) ? null : rgba(cs(k).backgroundColor)
      for (const v of [/^#[0-9a-f]{6}$/i.test(fill) ? fill.toLowerCase() : null, bg && bg.a > 0.5 ? bg.hex : null]) if (v && !colours.includes(v) && v !== pageBg && v !== '#ffffff') colours.push(v)
    }
    const rs = els.map(R)
    return { t: 'chart', chart: c.chart, rows: c.rows, title: c.title, h: Math.max(...rs.map((r) => r.b)) - Math.min(...rs.map((r) => r.y)), colours }
  }
  const artOrChart = (els) => chartFor(els) ?? snapshot(els)

  const tableOf = (el) => {
    const trs = [...el.querySelectorAll('tr')]
    const head = el.querySelector('thead tr')
    const body = trs.filter((tr) => tr !== head)
    const cellText = (td) => runsOf(td).map((r) => r.text).join('').trim()
    const rows = (head ? [head, ...body] : body).map((tr) => [...tr.children].map(cellText))
    const last = body.at(-1)
    const footer = !!last && body.length > 2 && (parseFloat(cs(last).borderTopWidth) || 0) >= 1.5
    return { t: 'table', rows, header: !!head, footer, style: tableStyle(el, head, body, footer) }
  }

  /** A table's look from its header, body rows and footer: real <table>s and rows of cells alike. */
  const tableStyle = (el, head, body, footer) => {
    const tr = body.filter((r, i) => !(footer && i === body.length - 1))
    const first = tr[0]
    const cellsOf = (row) => [...row.children]
    const er = R(el)
    const cells = cellsOf(first)
    const firstCell = cells[0]
    const st = {
      text: textStyle(el),
      rowH: round(tr.map((r) => R(r).h).sort((a, b) => a - b)[Math.floor(tr.length / 2)]),
      padX: round(parseFloat(cs(firstCell).paddingLeft) || parseFloat(cs(first).paddingLeft) || 0),
      before: 0,
      after: 0,
      cols: cells.map((c, i) => {
        const r = R(c)
        const cc = cs(c)
        const inner = [...c.querySelectorAll('*')].find((k) => !isSvg(k) && visibleText(k) && k.children.length === 0) ?? c
        const ic = cs(inner)
        const col = { x: round(r.x - er.x), w: round(r.w), align: cc.justifyContent === 'flex-end' ? 'right' : alignOf(cc) }
        const bold = tr.every((row) => {
          const k = row.children[i]
          const leaf = k && ([...k.querySelectorAll('*')].find((q) => visibleText(q) && q.children.length === 0) ?? k)
          return !k || !visibleText(k) || Number(cs(leaf).fontWeight) >= 600
        })
        if (bold && Number(cs(el).fontWeight) < 600) col.bold = true
        if (colourOf(ic.color) !== colourOf(cs(el).color)) col.colour = colourOf(ic.color)
        if (Math.abs(parseFloat(ic.fontSize) - parseFloat(cs(el).fontSize)) > 0.2 && !c.children.length) col.size = round(parseFloat(ic.fontSize))
        const blocks = [...c.children].filter((k) => visibleText(k) && !cs(k).display.startsWith('inline'))
        if (blocks.length >= 2) {
          const s = cs(blocks[1])
          col.sub = { size: round(parseFloat(s.fontSize)), colour: colourOf(s.color), weight: Number(s.fontWeight), italic: s.fontStyle === 'italic' }
          const s0 = cs(blocks[0])
          if (Number(s0.fontWeight) >= 600) col.bold = true
          if (colourOf(s0.color) !== colourOf(cs(el).color)) col.colour = colourOf(s0.color)
        }
        // A bar drawn before the number, or the value as a coloured pill.
        const swatch = [...c.querySelectorAll('span,div')].find((k) => !visibleText(k) && painted(cs(k).backgroundColor) && R(k).w > 4)
        if (swatch) col.bar = colourOf(cs(swatch).backgroundColor)
        for (const row of tr) {
          const k = row.children[i]
          const pill = k && [...k.querySelectorAll('span,div')].find((q) => visibleText(q) && painted(cs(q).backgroundColor))
          if (pill) {
            col.pills ??= {}
            col.pills[pill.textContent.trim()] = { bg: colourOf(cs(pill).backgroundColor), colour: colourOf(cs(pill).color) }
          }
        }
        return col
      })
    }
    const total = er.w
    for (const c of st.cols) c.share = round(c.w / total)
    if (head) {
      const hc = cs(head)
      const leaf = [...head.querySelectorAll('*')].find((k) => visibleText(k) && k.children.length === 0) ?? head
      const lc = cs(leaf)
      st.head = {
        colour: colourOf(lc.color), size: round(parseFloat(lc.fontSize)), weight: Number(lc.fontWeight), transform: transform(lc), letterSpacing: round(parseFloat(lc.letterSpacing) || 0),
        h: round(R(head).h), radius: round(parseFloat(hc.borderTopLeftRadius) || 0)
      }
      if (painted(hc.backgroundColor)) st.head.bg = colourOf(hc.backgroundColor)
      const bb = parseFloat(hc.borderBottomWidth) || 0
      if (bb >= 0.5 && hc.borderBottomStyle !== 'none') st.head.line = { w: round(bb), colour: colourOf(hc.borderBottomColor) }
    }
    const bgs = tr.map((r) => (painted(cs(r).backgroundColor) ? colourOf(cs(r).backgroundColor) : null))
    const stripe = bgs.find((b, i) => b && bgs[i + 1] !== b)
    if (stripe && bgs.some((b) => !b || b !== stripe)) st.stripe = stripe
    else if (stripe) st.stripe = stripe
    const rc = cs(first)
    const bw = parseFloat(rc.borderBottomWidth) || 0
    if (bw >= 0.5 && rc.borderBottomStyle !== 'none') st.line = { w: round(bw), colour: colourOf(rc.borderBottomColor) }
    const cl = cells[1] ? parseFloat(cs(cells[1]).borderLeftWidth) || 0 : 0
    if (cl >= 0.5) st.colLine = { w: round(cl), colour: colourOf(cs(cells[1]).borderLeftColor) }
    if (footer) {
      const f = body.at(-1)
      const fc = cs(f)
      st.foot = { weight: Number(fc.fontWeight), colour: colourOf(fc.color), line: { w: round(parseFloat(fc.borderTopWidth) || 0), colour: colourOf(fc.borderTopColor) } }
    }
    return st
  }

  /** Rows of three or more cells that line up: a table drawn with flexbox. */
  const flexRows = (el) => {
    const kids = [...el.children]
    const rows = kids.filter((k) => /flex|grid/.test(cs(k).display) && !cs(k).flexDirection.startsWith('column'))
    if (rows.length < 3 || rows.length < kids.length * 0.8) return null
    const n = rows[1].children.length
    if (n < 3 || rows.filter((r) => r.children.length === n).length < rows.length * 0.8) return null
    // Most rows have three or more cells with words or numbers in them (not a row of swatches).
    if (rows.filter((r) => [...r.children].filter(visibleText).length >= 3).length < rows.length * 0.8) return null
    const lefts = (r) => [...r.children].map((c) => Math.round(R(c).x))
    const ref = lefts(rows[1])
    if (!rows.slice(2).every((r) => r.children.length !== n || lefts(r).every((x, i) => Math.abs(x - ref[i]) <= 3))) return null
    return rows
  }
  const flexTable = (el, rows) => {
    const cellText = (c) => {
      const blocks = [...c.children].filter((k) => visibleText(k) && !cs(k).display.startsWith('inline'))
      if (blocks.length >= 2) return blocks.map((b) => runsOf(b).map((r) => r.text).join('').trim()).join('\n')
      return runsOf(c).map((r) => r.text).join('').trim()
    }
    // The first row heads the table when it looks different from the rows under it.
    const sig = (row) => [...row.children].map((c) => {
      const leaf = [...c.querySelectorAll('*')].find((k) => visibleText(k) && k.children.length === 0) ?? c
      const s = cs(leaf)
      return `${s.fontSize}|${s.textTransform}|${s.letterSpacing}|${s.color}`
    }).join(',')
    const header = sig(rows[0]) !== sig(rows[1]) && sig(rows[1]) === sig(rows[2]) || (painted(cs(rows[0]).backgroundColor) && cs(rows[0]).backgroundColor !== cs(rows[1]).backgroundColor && cs(rows[0]).color !== cs(rows[1]).color)
    const body = header ? rows.slice(1) : rows
    const all = rows.map((r) => [...r.children].map(cellText))
    return { rows: header ? all.slice(1) : all, header: header ? all[0] : null, style: tableStyle(el, header ? rows[0] : null, body, false) }
  }

  // Classifying blocks.
  const conv = (el) => {
    const c = cs(el)
    if (c.display === 'none' || c.visibility === 'hidden') return []
    const r = R(el)
    if (isSvg(el) || el.tagName === 'IMG') return r.w && r.h ? [artOrChart([el])] : []
    if (!visibleText(el)) {
      if (r.h <= 3 && r.w > 40 && painted(c.backgroundColor)) return [{ t: 'divider', colour: colourOf(c.backgroundColor), h: round(r.h), before: round(parseFloat(c.marginTop) || 0), after: round(parseFloat(c.marginBottom) || 0) }]
      if (r.w > 4 && r.h > 4 && (el.querySelector('svg') || painted(c.backgroundColor))) return [artOrChart([el])]
      return []
    }
    if (el.tagName === 'TABLE') return [tableOf(el)]
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      const items = [...el.children].filter((li) => li.tagName === 'LI').map(runsOf)
      const li = el.querySelector('li') ?? el
      return [{ t: 'list', ordered: el.tagName === 'OL', items, style: textStyle(li, { before: round(parseFloat(c.marginTop) || 0), after: round(parseFloat(c.marginBottom) || 0), padLeft: round(parseFloat(c.paddingLeft) || 0) }) }]
    }
    if (inlineOnly(el)) return [{ t: 'text', runs: runsOf(el), style: textStyle(el), tag: el.tagName }]
    const kids = [...el.children].filter((k) => cs(k).display !== 'none' && cs(k).position !== 'absolute')
    const row = (/flex/.test(c.display) && !c.flexDirection.startsWith('column')) || (/grid/.test(c.display) && c.gridTemplateColumns.split(' ').length > 1)
    const bar = (parseFloat(c.borderLeftWidth) || 0) >= 2 && (parseFloat(c.borderTopWidth) || 0) < 0.5
    const tinted = (painted(c.backgroundColor) && colourOf(c.backgroundColor) !== pageBg) || (parseFloat(c.borderTopWidth) || 0) >= 0.5
    const table = flexRows(el)
    if (table) {
      const t = flexTable(el, table)
      return [{ t: 'table', rows: t.header ? [t.header, ...t.rows] : t.rows, header: !!t.header, footer: false, style: t.style }]
    }
    if (bar && !row && !tinted) {
      // A quote: its words, who said it (the smallest text) and an opening mark.
      const leaves = [...el.querySelectorAll('*')].filter((k) => !isSvg(k) && visibleText(k) && inlineOnly(k) && (k.parentElement === el || !inlineOnly(k.parentElement)))
      const mark = leaves.find((k) => k.textContent.trim().length <= 2)
      const rest = leaves.filter((k) => k !== mark)
      if (rest.length) {
        const bySize = [...rest].sort((a, b) => parseFloat(cs(b).fontSize) - parseFloat(cs(a).fontSize))
        const body = bySize[0]
        const cite = rest.length > 1 ? bySize.at(-1) : null
        const st = textStyle(body, { before: round(parseFloat(c.marginTop) || 0), after: round(parseFloat(c.marginBottom) || 0), bar: { w: round(parseFloat(c.borderLeftWidth)), colour: colourOf(c.borderLeftColor), gap: round(parseFloat(c.paddingLeft) || 0) } })
        if (mark) {
          const m = cs(mark)
          st.mark = { text: mark.textContent.trim(), size: round(parseFloat(m.fontSize)), colour: colourOf(m.color), font: family(m.fontFamily), h: round(R(mark).h) }
        }
        return [{ t: 'quote', runs: runsOf(body), cite: cite ? cite.textContent.replace(/\s+/g, ' ').trim() : undefined, style: st, citeStyle: cite ? textStyle(cite) : undefined }]
      }
    }
    if (row && kids.length >= 2) {
      const withText = kids.filter(visibleText)
      if (withText.length === 1 && inlineOnly(withText[0])) {
        // One text with drawings either side: a heading with an icon or a trailing line.
        const t = withText[0]
        const at = kids.indexOf(t)
        const st = textStyle(t, { before: round(parseFloat(c.marginTop) || 0), after: round(parseFloat(c.marginBottom) || 0) })
        const before = kids.slice(0, at).find((k) => R(k).w > 2)
        const after = kids.slice(at + 1).find((k) => R(k).w > 10 && painted(cs(k).backgroundColor) && R(k).h <= 3)
        const gap = round(parseFloat(c.columnGap) || 0)
        let lead
        if (before) {
          const a = snapshot([before])
          lead = { art: a.art, w: a.w, h: a.h, gap }
        }
        if (after) st.trail = { colour: colourOf(cs(after).backgroundColor), h: round(R(after).h), gap }
        else {
          const svgAfter = kids.slice(at + 1).find((k) => isSvg(k))
          const stroke = svgAfter?.querySelector('[stroke]')?.getAttribute('stroke')
          if (svgAfter) st.trail = { colour: /^#[0-9a-f]{6}$/i.test(stroke ?? '') ? stroke.toLowerCase() : colourOf(cs(svgAfter).color), h: 1, gap }
        }
        const block = { t: 'text', runs: runsOf(t), style: st, tag: t.tagName, lead }
        return tinted ? [{ t: 'callout', box: boxStyle(el), blocks: [{ ...block, style: { ...st, before: 0, after: 0 } }] }] : [block]
      }
      const cols = kids.filter((k) => R(k).w > 3 && (visibleText(k) || isSvg(k) || k.querySelector('svg')))
      const total = cols.reduce((n, k) => n + R(k).w, 0)
      const columns = cols.map((k) => ({ w: round(R(k).w / total), blocks: conv(k) }))
      const out = { t: 'columns', widths: columns.map((x) => x.w), columns: columns.map((x) => x.blocks), gap: round(parseFloat(c.columnGap) || 0) }
      if (tinted) return [{ t: 'callout', box: boxStyle(el), blocks: [out] }]
      out.before = round(parseFloat(c.marginTop) || 0)
      out.after = round(parseFloat(c.marginBottom) || 0)
      return [out]
    }
    const inner = []
    for (const n of el.childNodes) {
      if (n.nodeType === 1 && cs(n).position !== 'absolute') inner.push(...conv(n))
      else if (n.nodeType === 3 && /\S/.test(n.data)) inner.push({ t: 'text', runs: [{ text: n.data.replace(/\s+/g, ' ').trim() }], style: textStyle(el, { before: 0, after: 0 }), tag: 'TEXT' })
    }
    if (tinted) return [{ t: 'callout', box: boxStyle(el), blocks: inner }]
    // A plain wrapper: its own margins go to its first and last blocks.
    if (inner.length) {
      const top = parseFloat(c.marginTop) || 0
      const bottom = parseFloat(c.marginBottom) || 0
      if (top && inner[0].style) inner[0].style = { ...inner[0].style, before: Math.max(inner[0].style.before ?? 0, top) }
      else if (top) inner[0].before = Math.max(inner[0].before ?? 0, top)
      if (bottom && inner.at(-1).style) inner.at(-1).style = { ...inner.at(-1).style, after: Math.max(inner.at(-1).style.after ?? 0, bottom) }
    }
    return inner
  }

  const top = [...section.children]
  const out = { flow: null, tables: [], arts }

  if (flow) {
    const has = (el, text) => (el.textContent ?? '').replace(/\s+/g, ' ').includes(text)
    const a = top.findIndex((el) => has(el, flow.start))
    const b = flow.end ? top.findIndex((el, i) => i >= a && has(el, flow.end)) : a
    if (a < 0 || b < 0) throw new Error(`page ${index + 1}: no part holding "${a < 0 ? flow.start : flow.end}"`)
    const inDom = top.slice(a, b + 1)
    // Parts drawn between the start and the end (a picture placed earlier in the page's code) flow with them.
    const y0 = R(top[a]).y
    const y1 = R(top[b]).b
    const x0 = Math.min(...inDom.map((e) => R(e).x))
    const x1 = Math.max(...inDom.map((e) => R(e).r))
    const between = top.filter((el) => !inDom.includes(el) && (() => {
      const r = R(el)
      return r.y >= y0 - 1 && r.b <= y1 + 1 && r.x >= x0 - 8 && r.r <= x1 + 8 && r.h < S.height * 0.8 && r.w > 0
    })())
    const range = [...inDom, ...between].filter((el) => cs(el).display !== 'none')
    for (const el of range) el.setAttribute('data-g-skip', '')
    const rs = range.map(R)
    const x = Math.min(...rs.map((r) => r.x))
    const right = Math.max(...rs.map((r) => r.r))
    const y = Math.min(...rs.map((r) => r.y))
    const bottom = Math.max(...rs.map((r) => r.b))
    // The frame ends above whatever is drawn under the text: a footer, a form.
    const below = top.filter((el) => !range.includes(el)).map(R).filter((r) => r.y >= bottom - 2 && r.x < right && r.r > x && r.h < S.height * 0.8)
    const limit = below.length ? Math.min(...below.map((r) => r.y)) - 12 : S.height - 40
    // Parts side by side or one over another (a chart's card and its labels) are taken together.
    const sorted = [...range].sort((p, q) => R(p).y - R(q).y)
    const groups = []
    for (const el of sorted) {
      const r = R(el)
      const g = groups.at(-1)
      if (g && r.y < g.b - 1) {
        g.els.push(el)
        g.b = Math.max(g.b, r.b)
      } else groups.push({ els: [el], b: r.b, y: r.y })
    }
    const blocks = []
    let prevBottom = null
    for (const g of groups) {
      let made
      if (g.els.length === 1) made = conv(g.els[0])
      else {
        const rects = g.els.map(R)
        const inside = rects.some((p, i) => rects.some((q, j) => i !== j && q.x <= p.x + 1 && q.y <= p.y + 1 && q.r >= p.r - 1 && q.b >= p.b - 1))
        made = inside || g.els.some((e) => !visibleText(e)) ? [artOrChart(g.els)] : [{ t: 'columns', widths: rects.map((p) => round(p.w / rects.reduce((n, q) => n + q.w, 0))), columns: g.els.map(conv), gap: round(Math.max(8, Math.min(...rects.slice(1).map((p, i) => p.x - rects[i].r)))) }]
      }
      // Parts placed one under another keep the gap the board has between them.
      if (prevBottom !== null && made[0]) made[0].vgap = round(g.y - prevBottom)
      prevBottom = g.b
      blocks.push(...made)
    }
    out.flow = { x: round(x), y: round(y), w: round(right - x), h: round(limit - y), blocks }
  }

  // Tables on the page itself.
  const seen = new Set()
  for (const el of section.querySelectorAll('*')) {
    if (isSvg(el) || el.closest('[data-g-skip]') || [...seen].some((s) => s.contains(el))) continue
    const rows = el.tagName === 'TABLE' ? [...el.querySelectorAll('tr')] : flexRows(el)
    if (!rows) continue
    seen.add(el)
    const t = el.tagName === 'TABLE' ? (() => {
      const tt = tableOf(el)
      return { rows: tt.header ? tt.rows.slice(1) : tt.rows, header: tt.header ? tt.rows[0] : null, style: tt.style }
    })() : flexTable(el, rows)
    const r = R(el)
    const below = top.map(R).filter((q) => q.y >= r.b - 2 && q.x < r.r && q.r > r.x && q.h < S.height * 0.8)
    const limit = below.length ? Math.min(...below.map((q) => q.y)) - 6 : S.height - 40
    el.setAttribute('data-g-skip', '')
    out.tables.push({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(Math.max(r.h, limit - r.y)), ...t })
  }
  return out
}

// ---------------------------------------------------------------------------
// Turning what the pages hold into the look.

const sigOf = (s) => JSON.stringify([s.font, s.size, s.weight, s.italic, s.colour, s.lineHeight, s.letterSpacing, s.transform, s.align, s.indent, s.padLeft, s.bar, s.rule, s.trail, s.bg])

/** Names the text styles: body, h1 to h3 by size, then the template's own by what they look like. */
function nameStyles(texts) {
  const byKey = new Map()
  for (const t of texts) {
    const k = sigOf(t.style)
    const e = byKey.get(k) ?? { style: t.style, chars: 0, count: 0, sample: '' }
    const text = t.runs.map((r) => r.text).join('')
    e.chars += text.length
    // Spacing: what most uses of the style have, leaving out uses that sit first in their box (0).
    ;(e.befores ??= []).push(t.style.before)
    ;(e.afters ??= []).push(t.style.after)
    const mode = (xs) => {
      const v = xs.filter((x) => x > 0)
      if (!v.length) return 0
      const n = new Map()
      for (const x of v) n.set(x, (n.get(x) ?? 0) + 1)
      return [...n].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    }
    e.style = { ...e.style, before: mode(e.befores), after: mode(e.afters) }
    e.count++
    if (!e.sample) e.sample = text
    byKey.set(k, e)
  }
  const entries = [...byKey.entries()]
  const paras = entries.filter(([, e]) => e.chars / e.count > 40)
  const [bodyKey, body] = (paras.length ? paras : entries).sort((a, b) => b[1].chars - a[1].chars)[0] ?? []
  const names = new Map()
  if (bodyKey) names.set(bodyKey, 'body')
  const headingish = entries.filter(([k, e]) => k !== bodyKey && body && e.style.size >= body.style.size * 1.2 && e.chars / e.count < 90 && (e.style.weight >= 600 || e.style.font !== body.style.font) && !e.style.italic)
  const sizes = [...new Set(headingish.map(([, e]) => e.style.size))].sort((a, b) => b - a)
  const level = (size) => Math.min(3, sizes.indexOf(size) + 1)
  const used = new Set(['body'])
  const unique = (n) => {
    let name = n
    for (let i = 2; used.has(name); i++) name = `${n}${i}`
    used.add(name)
    return name
  }
  const levels = new Map()
  for (const [k, e] of headingish.sort((a, b) => b[1].style.size - a[1].style.size)) {
    const l = level(e.style.size)
    names.set(k, unique(`h${l}`))
    levels.set(k, l)
  }
  for (const [k, e] of entries) {
    if (names.has(k)) continue
    const s = e.style
    const name = body && (s.italic || s.font === 'Caveat') && s.size > body.style.size * 1.5 ? 'signature'
      : s.indent && s.indent < 0 ? 'reference'
      : s.align === 'right' ? 'right'
      : s.transform === 'uppercase' ? 'label'
      : body && s.size < body.style.size - 0.2 ? 'small'
      : body && s.weight >= 600 && s.weight > body.style.weight ? 'strong'
      : 'text'
    names.set(k, unique(name))
  }
  return { names, levels, hints: Object.fromEntries(entries.map(([k, e]) => [names.get(k), e.sample.slice(0, 80)])), styles: Object.fromEntries(entries.map(([k, e]) => [names.get(k), e.style])) }
}

/** Every text-ish block, columns' and callouts' included. */
function* rawTexts(blocks) {
  for (const b of blocks) {
    if (b.t === 'text') yield b
    if (b.t === 'columns') for (const c of b.columns) yield* rawTexts(c)
    if (b.t === 'callout') yield* rawTexts(b.blocks)
  }
}

/** A look from its fixed pages only: styles picked from the text boxes, for documents in this look. */
function stylesFromBoxes(designs) {
  const boxes = designs.flatMap((d) => d.texts)
  const style = (t, extra = {}) => ({ font: t.font, size: t.size, weight: t.weight, italic: t.italic, colour: t.colour, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, ...(t.transform ? { transform: t.transform } : {}), align: 'left', before: 0, after: 8, ...extra })
  const long = boxes.filter((t) => t.sample.length > 60 && !t.wrap && t.size <= 14).sort((a, b) => b.sample.length - a.sample.length)
  const bodyBox = long[0] ?? boxes.slice().sort((a, b) => a.size - b.size)[Math.floor(boxes.length / 2)]
  const body = style(bodyBox, { lineHeight: Math.max(1.45, bodyBox.lineHeight), after: 8, italic: false, colour: bodyBox.colour })
  const heads = boxes.filter((t) => t.size >= body.size * 1.4 && /\p{L}{3}/u.test(t.sample) && t.sample.split(/\s+/).length >= 2 && t.opacity >= 0.9)
  const big = heads.slice().sort((a, b) => b.size - a.size)
  const h1src = big.find((t) => t.size <= 40) ?? big.at(-1) ?? bodyBox
  const h2src = big.filter((t) => t.size < h1src.size * 0.85 && t.size >= body.size * 1.3).sort((a, b) => b.size - a.size)[0] ?? h1src
  const h1 = style(h1src, { size: Math.min(h1src.size, 30), lineHeight: 1.15, before: 18, after: 8, transform: undefined, letterSpacing: Math.min(0, h1src.letterSpacing) })
  const h2 = style(h2src, { size: Math.min(h2src.size, 20), lineHeight: 1.2, before: 16, after: 6, transform: undefined, letterSpacing: Math.min(0, h2src.letterSpacing) })
  const h3 = { ...body, weight: Math.max(700, body.weight), size: Math.round(body.size * 1.15 * 10) / 10, before: 12, after: 4, colour: h2.colour }
  return { styles: { body, h1, h2, h3 }, hints: { body: bodyBox.sample.slice(0, 80), h1: h1src.sample, h2: h2src.sample } }
}

const isNumberish = (s) => !/\p{L}{2}/u.test(s)
const num = (s) => {
  const m = /-?[\d,]*\.?\d+/.exec(String(s).replace(/,(?=\d{3}\b)/g, ''))
  return m ? Number(m[0].replace(/,/g, '')) : NaN
}
const near = (a, b) => Math.abs(a - b) < 0.011

/** Columns that are other columns multiplied, and totals that add a column or other boxes up. */
function findCalcs(design) {
  for (const t of design.tables) {
    const rows = t.sample
    const n = rows[0]?.length ?? 0
    for (let c = 0; c < n; c++) {
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (a === c || b === c) continue
        if (rows.every((r) => [r[a], r[b], r[c]].every((v) => Number.isFinite(num(v))) && near(num(r[a]) * num(r[b]), num(r[c]))) && rows.some((r) => num(r[a]) !== 1 && num(r[b]) !== 1)) {
          t.calc = [{ col: c, mul: [a, b] }]
        }
      }
    }
  }
  const money = design.texts.filter((t) => /\d/.test(t.sample) && isNumberish(t.sample) && /[£$€]/.test(t.sample))
  const calcs = {}
  for (const box of money) {
    const v = num(box.sample)
    for (const t of design.tables) {
      for (let c = 0; c < (t.sample[0]?.length ?? 0); c++) {
        const sum = t.sample.reduce((s, r) => s + num(r[c]), 0)
        if (t.sample.every((r) => Number.isFinite(num(r[c]))) && near(sum, v)) calcs[box.name] = { sum: { table: t.name, col: c } }
      }
    }
  }
  for (const box of money) {
    if (calcs[box.name]) continue
    const v = num(box.sample)
    for (const o of money) {
      if (o === box) continue
      for (const f of [0.05, 0.1, 0.125, 0.15, 0.175, 0.2, 0.25]) if (near(num(o.sample) * f, v) && calcs[o.name]) calcs[box.name] = { mul: { box: o.name, factor: f } }
    }
    for (const o of money) for (const p of money) {
      if (calcs[box.name] || o === box || p === box || o.name >= p.name) continue
      if (near(num(o.sample) + num(p.sample), v) && calcs[o.name] && calcs[p.name]) calcs[box.name] = { add: [o.name, p.name] }
    }
  }
  if (Object.keys(calcs).length) design.calcs = calcs
}

// ---------------------------------------------------------------------------
// Writing the look as TypeScript, with every sample text marked for translation.

const messages = []
const M = (s) => (typeof s === 'string' && /\p{L}{2}/u.test(s) && !/[{}]/.test(s) ? `\u0000${messages.push(s) - 1}\u0000` : s)
const source = (value) => JSON.stringify(value, null, 1)
  .replace(/\n\s*/g, ' ')
  .replace(/"\\u0000(\d+)\\u0000"/g, (_, i) => `msg(${JSON.stringify(messages[Number(i)])})`)

function writeLook(meta, look) {
  const src = `// Generated by scripts/build-doc-templates.mjs from the ${meta.board} board. Don't edit by hand: change the board and run the script again.
// The sample text and each page's role are marked with msg() so they can be translated; the art holds no UI text.
import { msg } from '../../i18n'
import type { DocBoard } from '../../core/doc/look'

const board: DocBoard = ${source(look)}

export default board
`
  writeFileSync(join(OUT, `${meta.id}.ts`), src)
}

function writeIndex(entries) {
  const q = (s) => `msg(${JSON.stringify(s)})`
  const info = entries.map((e) => `  { id: ${JSON.stringify(e.id)}, name: ${q(e.name)}, blurb: ${q(e.blurb)}, purpose: ${JSON.stringify(e.purpose)}, look: ${q(e.look)}, fonts: ${JSON.stringify(e.families)}, pages: ${e.pages}, pack: ${!!e.pack} }`)
  const loaders = entries.map((e) => `  ${JSON.stringify(e.id)}: () => import('./${e.id}').then((m) => m.default)`)
  writeFileSync(join(OUT, 'index.ts'), `// Generated by scripts/build-doc-templates.mjs from scripts/doc-templates.config.json and the boards. Don't edit by hand.
import { msg } from '../../i18n'
import type { DocBoard, DocBoardInfo } from '../../core/doc/look'

/** The designed document templates, in the order the start screen shows them. */
export const DOC_BOARDS: DocBoardInfo[] = [
${info.join(',\n')}
]

/** Each look's designs and styles, loaded only when a document or the start screen needs them. */
export const DOC_LOADERS: Record<string, () => Promise<DocBoard>> = {
${loaders.join(',\n')}
}
`)
}

/** Raw blocks from the page to the document model, with style names in place of styles. */
function toBlocks(raw, ctx) {
  const out = []
  for (const b of raw) {
    const id = `b${++ctx.n}`
    switch (b.t) {
      case 'text': {
        const name = ctx.names.get(sigOf(b.style))
        const level = ctx.levels.get(sigOf(b.style))
        const runs = b.runs.map((r) => ({ ...r, text: M(r.text), ...(r.c ? { c: ctx.colour(r.c) } : {}) }))
        // A heading's icon is its style's, so new headings get it too; a paragraph's is its own.
        if (level && b.lead) ctx.look.styles[name].lead ??= b.lead
        if (level) out.push({ id, type: 'heading', level, runs, ...(name !== `h${level}` ? { style: name } : {}) })
        else out.push({ id, type: 'paragraph', runs, ...(name !== 'body' ? { style: name } : {}), ...(b.lead ? { icon: b.lead.art } : {}) })
        break
      }
      case 'list':
        ctx.look.styles.list ??= b.style
        out.push({ id, type: 'list', ordered: b.ordered, items: b.items.map((runs) => runs.map((r) => ({ ...r, text: M(r.text), ...(r.c ? { c: ctx.colour(r.c) } : {}) }))) })
        break
      case 'quote':
        ctx.look.styles.quote ??= b.style
        if (b.citeStyle) ctx.look.styles.cite ??= b.citeStyle
        out.push({ id, type: 'quote', runs: b.runs.map((r) => ({ ...r, text: M(r.text), ...(r.c ? { c: ctx.colour(r.c) } : {}) })), ...(b.cite ? { cite: M(b.cite) } : {}) })
        break
      case 'callout': {
        const key = ctx.boxName(b.box)
        out.push({ id, type: 'callout', blocks: toBlocks(b.blocks, ctx), ...(key !== 'callout' ? { style: key } : {}) })
        break
      }
      case 'columns': {
        const key = ctx.columnsName(b)
        out.push({ id, type: 'columns', columns: b.columns.map((c) => toBlocks(c, ctx)), widths: b.widths, ...(key !== 'columns' ? { style: key } : {}) })
        break
      }
      case 'table': {
        const key = ctx.tableName(b.style)
        out.push({ id, type: 'table', rows: b.rows.map((r) => r.map(M)), header: b.header, ...(b.footer ? { footer: true } : {}), ...(key !== 'table' ? { style: key } : {}) })
        break
      }
      case 'art':
        out.push({ id, type: 'art', art: b.art })
        break
      case 'chart':
        if (!ctx.look.chart.colours.length) ctx.look.chart.colours = b.colours.slice(0, 6)
        out.push({ id, type: 'chart', chart: b.chart, rows: b.rows.map((r) => r.map(M)), ...(b.title ? { title: M(b.title) } : {}) })
        break
      case 'divider':
        ctx.look.boxes.divider ??= { bg: b.colour, radius: 0, pad: [0, 0, 0, 0], before: b.before || 12, after: b.after || 12, gap: b.h }
        out.push({ id, type: 'divider' })
        break
    }
    // The gap the board has above a part placed by itself.
    if (b.vgap !== undefined && out.length) ctx.gaps.set(out.at(-1).id, b.vgap)
  }
  return out
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } })
mkdirSync(OUT, { recursive: true })
const entries = []
for (const meta of config.boards) {
  const file = join(dir, `${meta.board}.dc.html`)
  const title = canvas.boards?.[`${meta.board}.dc.html`]?.title ?? ''
  const [, purpose = meta.purpose, lookName = meta.look] = title.split(' · ')
  const entry = { ...meta, purpose: meta.purpose ?? purpose, look: meta.look ?? lookName }
  if (!PURPOSES.includes(entry.purpose)) throw new Error(`${meta.board}: purpose must be one of ${PURPOSES.join(', ')} (got ${entry.purpose})`)
  if (!entry.look) throw new Error(`${meta.board}: no look name; add "look" in doc-templates.config.json`)
  if (only.length && !only.includes(meta.board)) {
    const old = readFileSync(join(OUT, `${meta.id}.ts`), 'utf8')
    const fonts = JSON.parse(/"fonts": (\[[^\]]*\])/.exec(old)[1])
    entries.push({ ...entry, families: [...new Set(fonts.map((f) => f.family))], pages: meta.pages.length })
    continue
  }
  await page.goto('about:blank')
  await page.setContent(boardHtml(file), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const missing = await page.evaluate(async (fams) => {
    await Promise.all(fams.map((f) => document.fonts.load(`16px '${f}'`)))
    return fams.filter((f) => !document.fonts.check(`16px '${f}'`))
  }, [...FAMILIES])
  if (missing.length) throw new Error(`${meta.board}: fonts didn't load: ${missing.join(', ')}`)
  const count = await page.locator(PAGE).count()
  if (count !== meta.pages.length) throw new Error(`${meta.board}: ${count} pages on the board, ${meta.pages.length} in the config`)
  const pages = []
  for (let i = 0; i < count; i++) {
    const cfg = meta.pages[i]
    const held = await page.evaluate(collect, { index: i, selector: PAGE, flow: cfg.flow ?? null, charts: cfg.charts ?? [], prefix: `${meta.id}.${i + 1}` })
    const art = await page.evaluate(extract, { index: i, prefix: `${meta.id}-${i + 1}`, scale: 1, families: [...FAMILIES], selector: PAGE })
    pages.push({ held, art })
  }

  // The look: styles from the flowing pages' blocks, or from the fixed pages' text boxes.
  const look = { id: meta.id, fonts: [], designs: [], styles: {}, styleHints: {}, boxes: {}, tables: {}, chart: { colours: [], text: null, grid: '' }, palette: {}, arts: {}, plain: null, flow: '', sample: [] }
  const allRaw = pages.flatMap((p) => (p.held.flow ? [...rawTexts(p.held.flow.blocks)] : []))
  const named = nameStyles(allRaw)
  Object.assign(look.styles, named.styles)
  for (const [k, v] of Object.entries(named.hints)) look.styleHints[k] = M(v)
  const colours = new Map()
  const ctx = {
    n: 0, look, names: named.names, levels: named.levels, gaps: new Map(),
    colour: (hex) => {
      if (!colours.has(hex)) colours.set(hex, `c${colours.size + 1}`)
      look.palette[colours.get(hex)] = hex
      return colours.get(hex)
    },
    boxName: (box) => {
      const sig = JSON.stringify(box)
      const found = Object.entries(look.boxes).find(([, b]) => JSON.stringify(b) === sig)
      if (found) return found[0]
      const name = look.boxes.callout ? `callout${Object.keys(look.boxes).filter((k) => k.startsWith('callout')).length + 1}` : 'callout'
      look.boxes[name] = box
      return name
    },
    columnsName: (b) => {
      const box = { radius: 0, pad: [0, 0, 0, 0], before: b.before ?? 0, after: b.after ?? 0, gap: b.gap ?? 16 }
      const sig = JSON.stringify(box)
      const found = Object.entries(look.boxes).find(([k, x]) => k.startsWith('columns') && JSON.stringify(x) === sig)
      if (found) return found[0]
      const name = look.boxes.columns ? `columns${Object.keys(look.boxes).filter((k) => k.startsWith('columns')).length + 1}` : 'columns'
      look.boxes[name] = box
      return name
    },
    tableName: (st) => {
      const flowStyle = { ...st, cols: st.cols.map(({ x, w, share, ...c }) => ({ ...c, w: share })) }
      const sig = JSON.stringify(flowStyle)
      const found = Object.entries(look.tables).find(([, x]) => JSON.stringify(x) === sig)
      if (found) return found[0]
      const name = look.tables.table ? `table${Object.keys(look.tables).length + 1}` : 'table'
      look.tables[name] = flowStyle
      return name
    }
  }
  const fonts = new Map()
  const addFont = (f) => fonts.set(`${f.font ?? f.family}|${f.weight}|${f.italic}`, { family: f.font ?? f.family, weight: f.weight, italic: f.italic })
  pages.forEach(({ held, art }, i) => {
    const cfg = meta.pages[i]
    const id = `${meta.id}.${i + 1}`
    for (const a of held.arts) look.arts[a.id] = { html: a.html, w: a.w, h: a.h }
    const texts = nameSlots(art.texts).map(({ lines, ...t }) => ({ ...t, maxChars: Math.max(4, Math.ceil(t.sample.length * 1.4)) }))
    for (const f of [...texts, ...art.artFonts]) addFont(f)
    const design = { id, role: M(cfg.role), bg: art.bg, art: art.art, ...(art.over ? { over: art.over } : {}), texts: texts.map((t) => ({ ...t, sample: M(t.sample) })), tables: [] }
    // A page number: a small box showing this page's own number.
    const auto = {}
    for (const t of texts) if (t.sample === String(i + 1) && t.size <= 14) auto[t.name] = 'page'
    if (Object.keys(auto).length) design.auto = auto
    const tables = {}
    held.tables.forEach((tb, n) => {
      const name = n ? `table${n + 1}` : 'table'
      const { cols, ...style } = tb.style
      design.tables.push({ name, x: tb.x, y: tb.y, w: tb.w, h: tb.h, header: tb.header ? tb.header.map(M) : null, style: { ...style, cols: cols.map(({ share, ...c }) => c) }, sample: tb.rows })
      tables[name] = tb.rows.map((r) => r.map(M))
    })
    findCalcs(design)
    for (const t of design.tables) delete t.sample
    const section = { id: `p${i + 1}`, design: id, texts: Object.fromEntries(design.texts.map((t) => [t.name, t.sample])), tables }
    if (held.flow) {
      const f = held.flow
      design.flow = { x: f.x, y: f.y, w: f.w, h: f.h, ...(cfg.flow.next === 'plain' ? { next: `${meta.id}.plain` } : cfg.flow.next ? { next: `${meta.id}.${cfg.flow.next}` } : {}) }
      section.blocks = toBlocks(f.blocks, ctx)
      look.flow ||= id
      for (const t of rawTexts(f.blocks)) addFont(t.style)
    }
    // Text boxes the page fills itself start empty in the sample.
    for (const name of Object.keys(design.auto ?? {})) section.texts[name] = ''
    look.designs.push(design)
    look.sample.push(section)
  })
  // Gaps between parts placed one under another, where the board has them, become the styles' spacing.
  for (const section of look.sample) {
    const flat = []
    const walk = (list) => list.forEach((b) => {
      flat.push(b)
      if (b.type === 'callout') walk(b.blocks)
    })
    walk(section.blocks ?? [])
    for (const b of flat) {
      const gap = ctx.gaps.get(b.id)
      if (gap === undefined) continue
      const key = b.style ?? (b.type === 'heading' ? `h${b.level}` : b.type === 'paragraph' ? 'body' : b.type)
      const st = look.styles[key] ?? look.tables[key] ?? look.boxes[key]
      if (st && !st.before) st.before = Math.max(0, Math.round(gap))
    }
  }
  if (!look.styles.body) {
    const derived = stylesFromBoxes(look.designs)
    Object.assign(look.styles, derived.styles)
    for (const [k, v] of Object.entries(derived.hints)) look.styleHints[k] ??= M(v)
  }
  // Pages without a flowing part can still start one: on the plain page of the look's paper.
  const papers = look.designs.map((d) => d.bg)
  const light = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  }
  const paper = papers.slice().sort((a, b) => light(b) - light(a))[0] ?? '#ffffff'
  const flowDesign = look.designs.find((d) => d.flow)
  look.plain = flowDesign ? { bg: paper, x: flowDesign.flow.x, w: flowDesign.flow.w, top: 64, bottom: 64 } : { bg: paper, x: 56, w: 483, top: 64, bottom: 64 }
  look.flow ||= `${meta.id}.plain`
  const body = look.styles.body
  look.chart.text = { ...body, size: Math.max(8, body.size - 1.5), lineHeight: 1.2, before: 0, after: 0 }
  look.chart.grid = look.tables.table?.line?.colour ?? '#d9d9d9'
  if (!look.chart.colours.length) look.chart.colours = [...new Set([...Object.values(look.palette), look.styles.h1?.colour, look.styles.h2?.colour].filter(Boolean))].slice(0, 5)
  look.fonts = [...fonts.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight)
  for (const f of look.fonts) if (!FAMILIES.has(f.family)) throw new Error(`${meta.board}: the font ${f.family} isn't bundled`)
  writeLook(meta, look)
  const families = [...new Set(look.fonts.map((f) => f.family))]
  entries.push({ ...entry, families, pages: count })
  const flowing = look.sample.filter((s) => s.blocks).map((s) => `${s.design}: ${s.blocks.length} blocks`).join(', ')
  console.log(`${meta.board}: ${count} pages, ${look.designs.reduce((n, d) => n + d.texts.length, 0)} text boxes, ${look.designs.reduce((n, d) => n + d.tables.length, 0)} tables${flowing ? `, ${flowing}` : ''}; styles ${Object.keys(look.styles).join(', ')}`)
}
writeIndex(entries)
await browser.close()
