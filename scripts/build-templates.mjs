#!/usr/bin/env node
/**
 * Turns the designed template boards into Glance's designed slides (src/deck/designs/).
 *
 *   node scripts/build-templates.mjs <boards folder> [Board ...]
 *
 * A board is a <Name>.dc.html file with six <section aria-label="Slide N, ..."> slides,
 * each 640 by 360, drawn with inline styles and inline SVG. For each slide this keeps the
 * drawing as the design's art and turns every piece of HTML text into an editable text
 * box: where it sits, its font and colour, and the sample text. Which boards are used, in
 * what order and with what names, is in scripts/templates.config.json; with Board names on
 * the command line only those boards are rebuilt.
 *
 * The output is committed; don't edit it by hand. Dev tool only: it uses the Playwright
 * and Chromium installed globally (PLAYWRIGHT and CHROMIUM override where they are), and
 * the fonts in src/styles/fonts, so nothing is fetched from the network.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/deck/designs')
const FONTS = join(ROOT, 'src/styles/fonts')
const PURPOSES = ['School', 'Work', 'Events', 'Personal', 'Clubs']
const SCALE = 3

/** The bundled fonts, as the boards name them. Keep in step with src/deck/fonts.ts. */
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
const FAMILIES = new Set(FONT_FILES.map((f) => f[0]))

const [dir, ...only] = process.argv.slice(2)
if (!dir || !existsSync(dir)) {
  console.error('Usage: node scripts/build-templates.mjs <boards folder> [Board ...]')
  process.exit(1)
}
const config = JSON.parse(readFileSync(join(ROOT, 'scripts/templates.config.json'), 'utf8'))
const canvas = existsSync(join(dir, 'canvas.json')) ? JSON.parse(readFileSync(join(dir, 'canvas.json'), 'utf8')) : { boards: {} }

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright')

const fontCss = FONT_FILES.map(([family, style, weight, file]) =>
  `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}) format('woff2')}`).join('\n')

/** The board's HTML without the design tool's scripts, and with the local fonts instead of Google's. */
function boardHtml(file) {
  return readFileSync(file, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<\/?x-dc>|<\/?helmet>/g, '')
    .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, `<style>${fontCss}</style>`)
}

/** Runs in the page: measures one slide and splits it into art and text boxes. */
function extract({ index, prefix, scale, families }) {
  const section = document.querySelectorAll('section[aria-label^="Slide"]')[index]
  const S = section.getBoundingClientRect()
  const inSvg = (el) => !!el.parentElement?.closest('svg')
  const boxes = [...section.querySelectorAll('*')].filter((el) => !inSvg(el))
  const visible = (t) => /\S/.test(t.data)
  const ownText = (el) => el.tagName.toLowerCase() !== 'svg' && [...el.childNodes].some((c) => c.nodeType === 3 && visible(c))
  const rel = (r) => ({ x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height })
  const union = (rs) => {
    rs = rs.filter((r) => r.right - r.left || r.bottom - r.top)
    if (!rs.length) return null
    const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top))
    const x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom))
    return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 }
  }

  // 1. Layout without transforms: every box where layout put it, before any rotation.
  const off = document.createElement('style')
  off.textContent = 'section :not(svg *){transform:none!important;rotate:none!important;scale:none!important;translate:none!important}'
  document.head.append(off)
  const layout = new Map()
  for (const el of [section, ...boxes]) {
    const cs = getComputedStyle(el)
    const info = { rect: rel(el.getBoundingClientRect()), display: cs.display, border: [parseFloat(cs.borderLeftWidth) || 0, parseFloat(cs.borderTopWidth) || 0] }
    if (el !== section && ownText(el)) {
      const pre = /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace)
      // Runs of text between child elements. Two runs either side of a swatch or an icon
      // are two pieces of text; one run, however many lines, is one.
      const runs = [[]]
      for (const c of el.childNodes) {
        if (c.nodeType === 3 || c.nodeName === 'BR') runs.at(-1).push(c)
        else if (c.nodeType === 1) runs.push(Object.assign([c], { element: true }), [])
      }
      const fragsOf = (nodes) => nodes.filter((c) => c.nodeType === 3 && visible(c)).flatMap((t) => {
        // Only the glyphs: white space at either end takes no room once the text is trimmed.
        const r = document.createRange()
        if (pre) r.selectNodeContents(t)
        else {
          r.setStart(t, t.data.search(/\S/))
          r.setEnd(t, t.data.trimEnd().length)
        }
        return [...r.getClientRects()].filter((q) => q.width > 0.5).map((f) => ({ left: f.left, top: f.top, right: f.right, bottom: f.bottom }))
      })
      const rectOf = (c) => union([...c.getClientRects()])
      info.runs = []
      runs.forEach((nodes, i) => {
        if (nodes.element) return
        const frags = fragsOf(nodes)
        if (!frags.length) return
        // The element just before and after the run, if any.
        const prev = runs.slice(0, i).reverse().find((r) => r.element)?.[0]
        const next = runs.slice(i + 1).find((r) => r.element)?.[0]
        info.runs.push({ nodes, frags, text: union(frags), prev: prev && rectOf(prev), next: next && rectOf(next) })
      })
      info.kids = [...el.children].filter((c) => c.tagName !== 'BR' && getComputedStyle(c).position !== 'absolute').map(rectOf).filter(Boolean)
      info.padding = ['Left', 'Top', 'Right', 'Bottom'].map((s) => parseFloat(cs[`padding${s}`]) || 0)
      const r = el.getBoundingClientRect()
      info.outer = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    layout.set(el, info)
  }
  off.remove()

  // 2. How each box is turned: its transforms and its parents', as one matrix in slide space.
  const world = new Map([[section, new DOMMatrix()]])
  const matrixOf = (el) => {
    if (world.has(el)) return world.get(el)
    const parent = matrixOf(el.parentElement)
    const cs = getComputedStyle(el)
    let m = parent
    if (cs.transform && cs.transform !== 'none') {
      const { rect } = layout.get(el)
      const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat)
      const at = new DOMMatrix().translate(rect.x + ox, rect.y + oy).multiply(new DOMMatrix(cs.transform)).translate(-(rect.x + ox), -(rect.y + oy))
      m = parent.multiply(at)
    }
    world.set(el, m)
    return m
  }
  const opacityOf = (el) => {
    let o = 1
    for (let e = el; e && e !== section.parentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
    return o
  }
  const hex = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css)
    if (!m) return { colour: '#000000', alpha: 1 }
    const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { colour: '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), alpha: a }
  }
  const family = (stack) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  const round = (n) => Math.round(n * 10) / 10

  // 3. The text boxes.
  const texts = []
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre'
  document.body.append(probe)
  const pieces = []
  const clipped = new Set()
  for (const el of boxes) {
    const info = layout.get(el)
    if (!info.runs?.length || getComputedStyle(el).visibility === 'hidden') continue
    const split = info.runs.length > 1
    for (const run of info.runs) pieces.push({ el, info, run, split })
  }
  // Text the design hides under something opaque stays in the art, since a text box would sit on top.
  const opaque = (e) => {
    if (e instanceof SVGElement) return false
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).backgroundColor)
    const a = m ? Number(m[1].split(/[,\s/]+/).filter(Boolean)[3] ?? 1) : 0
    return a > 0.9
  }
  const hidden = (el, T) => {
    const above = document.elementsFromPoint((T.left + T.right) / 2, (T.top + T.bottom) / 2)
    for (const e of above) {
      if (e === el || el.contains(e)) return false
      if (!e.contains(el) && section.contains(e) && opaque(e)) return true
    }
    return false
  }
  const keepText = new Set()
  // Art drawn over a text box: the slide's top-level box it belongs to, when at least a tenth
  // of the points sampled across the text hit it first.
  const covers = new Set()
  const topOf = (e) => {
    while (e.parentElement && e.parentElement !== section) e = e.parentElement
    return e
  }
  const painted = (e) => {
    if (e instanceof SVGElement) return opacityOf(e) >= 0.3
    if (e.tagName === 'IMG') return true
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).backgroundColor)
    return (m ? Number(m[1].split(/[,\s/]+/).filter(Boolean)[3] ?? 1) : 0) > 0.05 || getComputedStyle(e).backgroundImage !== 'none'
  }
  const coverOf = (el, m, T) => {
    const hits = new Map()
    let n = 0
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) {
      const p = m.transformPoint(new DOMPoint(T.left + ((i + 0.5) / 7) * T.width - S.left, T.top + ((j + 0.5) / 5) * T.height - S.top))
      n++
      for (const e of document.elementsFromPoint(p.x + S.left, p.y + S.top)) {
        if (e === el || el.contains(e) || !section.contains(e) || e === section) break
        if (e.contains(el) || !painted(e)) continue
        const top = topOf(e)
        // A texture or frame over the whole slide stays under the text, so the text stays easy to pick.
        const r = e.getBoundingClientRect()
        if (top === topOf(el) || r.width * r.height > 0.5 * S.width * S.height) break
        hits.set(top, (hits.get(top) ?? 0) + 1)
        break
      }
    }
    const best = [...hits].sort((a, b) => b[1] - a[1])[0]
    return best && best[1] >= n / 10 ? best[0] : null
  }
  const hitAll = document.createElement('style')
  hitAll.textContent = 'section *{pointer-events:auto!important}'
  document.head.append(hitAll)
  for (const { el, info, run, split } of pieces) {
    const cs = getComputedStyle(el)
    if (hidden(el, run.text)) {
      keepText.add(el)
      continue
    }
    // The text: the run's text nodes, <br> as a line break, white space collapsed as the page shows it.
    const pre = /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace)
    const raw = run.nodes.map((c) => (c.nodeType === 3 ? c.data : '\n')).join('')
    const sample = (pre ? raw : raw.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')).replace(/^\n+|\n+$/g, '')
    if (!sample.trim()) continue
    const size = parseFloat(cs.fontSize)
    const T = run.text
    // Line height: as set, or as the font's normal height measured on the text.
    let lh = parseFloat(cs.lineHeight)
    if (!Number.isFinite(lh)) {
      probe.style.font = cs.font
      probe.textContent = 'Hg'
      lh = probe.getBoundingClientRect().height
    }
    // The area the text may fill: the content box, less any child beside, above or below it.
    const pad = info.padding
    const bw = info.border
    const A = { left: info.outer.left + bw[0] + pad[0], top: info.outer.top + bw[1] + pad[1], right: info.outer.right - bw[0] - pad[2], bottom: info.outer.bottom - bw[1] - pad[3] }
    let indent = 0
    const sameRows = (k) => k.top < T.bottom - 1 && k.bottom > T.top + 1
    if (split) {
      // One of several runs: from the element before it to the element after it.
      const rows = new Set(run.frags.map((f) => Math.round(f.top)))
      if (rows.size > 1 && run.frags[0]) {
        // It wraps onto more lines: the whole content box, its first line starting where the run does.
        indent = Math.max(0, run.frags[0].left - A.left)
      } else {
        A.left = T.left
        if (run.next && sameRows(run.next) && run.next.left >= T.right - 1) A.right = Math.min(A.right, run.next.left)
        else A.right = Math.max(A.right, T.right)
      }
    } else {
      for (const k of info.kids) {
        // Beside a child: from where the glyphs start, keeping the gap the design had.
        if (k.right <= T.left + 1 && sameRows(k)) A.left = Math.max(A.left, T.left)
        else if (k.left >= T.right - 1 && sameRows(k)) A.right = Math.min(A.right, k.left)
        else if (k.bottom <= T.top + 1) A.top = Math.max(A.top, k.bottom)
        else if (k.top >= T.bottom - 1) A.bottom = Math.min(A.bottom, k.top)
        else {
          // A child on the text's first line, before it: the first line starts after it.
          const first = run.frags[0]
          if (first && k.right <= first.left + 1 && k.top < first.bottom && k.bottom > first.top) indent = Math.max(indent, first.left - A.left)
        }
      }
    }
    const inline = cs.display === 'inline' || split
    if (inline) {
      // An inline box is only as tall as its glyphs; give it whole lines.
      const lines = Math.max(1, Math.round(T.height / lh))
      const mid = (T.top + T.bottom) / 2
      if (!split) {
        A.left = T.left
        A.right = T.right
      }
      A.top = mid - (lines * lh) / 2
      A.bottom = mid + (lines * lh) / 2
    }
    A.right = Math.max(A.right, A.left + 1)
    A.bottom = Math.max(A.bottom, A.top + 1)
    const top = T.top - A.top
    const bottom = A.bottom - T.bottom
    const left = T.left - A.left
    const right = A.right - T.right
    const tol = Math.max(2, lh * 0.15)
    const valign = inline || (top > tol && Math.abs(top - bottom) <= tol) ? 'middle' : top > tol && bottom <= tol ? 'bottom' : 'top'
    const ta = cs.textAlign
    const align = ta === 'center' || ta === '-webkit-center' ? 'center' : ta === 'right' || ta === 'end' ? 'right'
      : split ? 'left' : left > 2 && Math.abs(left - right) <= 2 && !indent ? 'center' : right <= 1 && left > 2 && !indent ? 'right' : 'left'

    // Where the area ends up once the element and its parents are turned.
    const m = matrixOf(el)
    const k = Math.hypot(m.a, m.b)
    const c = m.transformPoint(new DOMPoint((A.left + A.right) / 2 - S.left, (A.top + A.bottom) / 2 - S.top))
    // A pixel more than measured, so rounding never pushes the last word onto a new line.
    const slack = 0.34
    if (align === 'left') A.right += slack
    else if (align === 'right') A.left -= slack
    else {
      A.left -= slack / 2
      A.right += slack / 2
    }
    const w = (A.right - A.left) * k
    const h = (A.bottom - A.top) * k
    const rotate = (Math.atan2(m.b, m.a) * 180) / Math.PI

    // Average glyph width at this font, for fitting longer text later.
    probe.style.font = cs.font
    probe.style.letterSpacing = cs.letterSpacing
    probe.style.textTransform = cs.textTransform
    const longest = sample.split('\n').reduce((a, b) => (b.length > a.length ? b : a), '')
    probe.textContent = longest
    const charW = probe.getBoundingClientRect().width / Math.max(1, longest.length) / size
    // Text filled with a gradient (background-clip: text): the gradient goes with the text box.
    const clipText = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text'
    const gradient = clipText && cs.backgroundImage !== 'none' ? cs.backgroundImage.replace(/(-?[\d.]+)px/g, (_, n) => `${round(Number(n) * scale * k)}px`) : undefined
    if (gradient) clipped.add(el)
    const { colour, alpha } = hex(gradient ? /rgba?\([^)]+\)/.exec(gradient)?.[0] ?? cs.color : cs.color)
    const fam = family(cs.fontFamily)
    if (!families.includes(fam)) throw new Error(`Slide ${index + 1}: the font ${fam} isn't bundled (text "${sample.slice(0, 30)}")`)
    // Partly covered by art painted later (a runner over the big 5K): it goes under that art.
    const cover = coverOf(el, m, T)
    if (cover) covers.add(cover)
    const shadow = cs.textShadow !== 'none' ? cs.textShadow.replace(/(-?[\d.]+)px/g, (_, n) => `${round(Number(n) * scale * k)}px`) : undefined
    texts.push({
      el,
      x: round((c.x - w / 2) * scale), y: round((c.y - h / 2) * scale), w: round(w * scale), h: round(h * scale), rotate: round(rotate),
      font: fam, size: round(size * k * scale), weight: Number(cs.fontWeight), italic: cs.fontStyle === 'italic',
      colour, opacity: round(alpha * opacityOf(el) * 100) / 100,
      letterSpacing: round((parseFloat(cs.letterSpacing) || 0) * k * scale), lineHeight: Math.round((lh / size) * 1000) / 1000,
      align, valign, transform: cs.textTransform === 'none' ? undefined : cs.textTransform,
      wrap: pre ? 'pre' : cs.whiteSpace === 'nowrap' ? 'nowrap' : undefined,
      indent: indent ? round(indent * k * scale) : undefined,
      shadow,
      gradient,
      charW: Math.round(charW * 1000) / 1000,
      lines: Math.max(1, Math.round(T.height / lh)),
      sample
    })
  }
  probe.remove()
  hitAll.remove()
  // Text boxes go under the first covering box and everything painted after it.
  const tops = [...section.children]
  let firstCover = covers.size ? Math.min(...[...covers].map((e) => tops.indexOf(e))) : -1
  for (const t of texts) if (firstCover >= 0 && tops.indexOf(topOf(t.el)) < firstCover) t.under = true
  if (!texts.some((t) => t.under)) firstCover = -1

  // A slide drawn wholly in SVG, text and all: each line of SVG text becomes a text box.
  const svgTexts = new Set()
  if (!texts.length) {
    const all = [...section.querySelectorAll('svg text')]
    all.forEach((el, i) => {
      if (el.closest('defs, pattern, mask, clipPath, symbol, marker') || el.querySelector('textPath') || !/\S/.test(el.textContent)) return
      const cs = getComputedStyle(el)
      const b = el.getBBox()
      if (!b.width || !b.height) return
      const m = new DOMMatrix().translate(-S.left, -S.top).multiply(el.getScreenCTM())
      const k = Math.hypot(m.a, m.b)
      const size = parseFloat(cs.fontSize)
      const c = m.transformPoint(new DOMPoint(b.x + b.width / 2, b.y + b.height / 2))
      const anchor = cs.textAnchor
      const sample = el.textContent.replace(/\s+/g, ' ').trim()
      probe.style.font = cs.font
      probe.style.letterSpacing = cs.letterSpacing
      probe.textContent = sample
      document.body.append(probe)
      const charW = probe.getBoundingClientRect().width / Math.max(1, sample.length) / size
      probe.remove()
      const { colour, alpha } = hex(cs.fill.startsWith('rgb') ? cs.fill : cs.color)
      const fam = family(cs.fontFamily)
      if (!families.includes(fam)) throw new Error(`Slide ${index + 1}: the font ${fam} isn't bundled (text "${sample.slice(0, 30)}")`)
      const w = b.width * k
      const h = b.height * k
      svgTexts.add(i)
      texts.push({
        x: round((c.x - w / 2) * scale), y: round((c.y - h / 2) * scale), w: round(w * scale), h: round(h * scale), rotate: round((Math.atan2(m.b, m.a) * 180) / Math.PI),
        font: fam, size: round(size * k * scale), weight: Number(cs.fontWeight), italic: cs.fontStyle === 'italic',
        colour, opacity: round(alpha * Number(cs.fillOpacity || 1) * opacityOf(el) * 100) / 100,
        letterSpacing: round((parseFloat(cs.letterSpacing) || 0) * k * scale), lineHeight: Math.round((b.height / size) * 1000) / 1000,
        align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left', valign: 'middle', wrap: 'nowrap',
        charW: Math.round(charW * 1000) / 1000, lines: 1, sample
      })
    })
  }

  // 4. The art: the slide with every box placed absolutely, so taking the text out moves nothing.
  const clone = section.cloneNode(true)
  const cloned = [...clone.querySelectorAll('*')].filter((el) => !inSvg(el))
  boxes.forEach((el, i) => {
    const c = cloned[i]
    const info = layout.get(el)
    if (info.display === 'none' || el.tagName === 'BR') return c.remove()
    const parent = layout.get(el.parentElement)
    const left = info.rect.x - parent.rect.x - parent.border[0]
    const top = info.rect.y - parent.rect.y - parent.border[1]
    const s = c.style
    s.position = 'absolute'
    s.inset = 'auto'
    s.margin = '0'
    s.boxSizing = 'border-box'
    s.left = `${round(left)}px`
    s.top = `${round(top)}px`
    s.width = `${round(info.rect.w)}px`
    s.height = `${round(info.rect.h)}px`
    s.flex = 'none'
    if (/^inline/.test(info.display) || info.display === 'contents') s.display = 'block'
    if (clipped.has(el)) s.background = 'none'
  })
  const kept = new Set(boxes.flatMap((el, i) => (keepText.has(el) ? [cloned[i]] : [])))
  for (const el of [clone, ...cloned]) for (const n of [...el.childNodes]) if (n.nodeType === 8 || (n.nodeType === 3 && !kept.has(el))) n.remove()
  const clonedSvgText = [...clone.querySelectorAll('svg text')]
  for (const i of svgTexts) clonedSvgText[i].remove()
  // The section itself becomes the art's root, scaled to the 1920 by 1080 slide.
  const root = document.createElement('div')
  root.setAttribute('style', clone.getAttribute('style') ?? '')
  const cs = getComputedStyle(section)
  Object.assign(root.style, { position: 'absolute', left: '0', top: '0', width: `${S.width}px`, height: `${S.height}px`, margin: '0', borderRadius: '0', overflow: 'hidden', transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' })
  root.style.fontFamily = cs.fontFamily
  root.style.color = cs.color
  root.append(...clone.childNodes)
  // The art painted over the under text boxes, if any: the same root, without its background.
  let over = null
  if (firstCover >= 0) {
    const start = cloned[boxes.indexOf(tops[firstCover])]
    const rest = [...root.childNodes]
    const at = rest.indexOf(start)
    if (at >= 0) {
      over = root.cloneNode(false)
      over.style.background = 'none'
      over.style.boxShadow = 'none'
      over.append(...rest.slice(at))
    }
  }
  // SVG ids made unique to this design, so two slides on one page don't share a pattern.
  const ids = new Map()
  for (const el of root.querySelectorAll('[id]')) {
    ids.set(el.id, `${prefix}-${el.id}`)
    el.id = `${prefix}-${el.id}`
  }
  for (const el of over?.querySelectorAll('[id]') ?? []) {
    ids.set(el.id, `${prefix}-${el.id}`)
    el.id = `${prefix}-${el.id}`
  }
  if (ids.size) {
    for (const el of [...root.querySelectorAll('*'), ...(over?.querySelectorAll('*') ?? [])]) {
      for (const a of [...el.attributes]) {
        let v = a.value.replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, (all, id) => (ids.has(id) ? `url(#${ids.get(id)})` : all))
        if (/href$/.test(a.name) && v.startsWith('#') && ids.has(v.slice(1))) v = `#${ids.get(v.slice(1))}`
        if (v !== a.value) el.setAttribute(a.name, v)
      }
    }
  }
  // Fonts the art itself uses (SVG text).
  const artFonts = [...section.querySelectorAll('svg text')].filter((t) => /\S/.test(t.textContent)).map((t) => {
    const s = getComputedStyle(t)
    return { font: family(s.fontFamily), weight: Number(s.fontWeight), italic: s.fontStyle === 'italic' }
  })
  const serial = (e) => new XMLSerializer().serializeToString(e).replace(/\s+aria-hidden="true"/g, '')
  const art = serial(root)
  return {
    role: (section.getAttribute('aria-label') ?? '').replace(/^Slide \d+,?\s*/, ''),
    bg: hex(cs.backgroundColor).colour,
    art,
    over: over ? serial(over) : undefined,
    texts: texts.map(({ el, ...t }) => t),
    svgText: svgTexts.size > 0,
    artFonts
  }
}

/**
 * Slot names: the most prominent text is the title, the rest text2, text3 and so on.
 * Prominence is size, but a short word or a number (a giant "5K", "£18,400") counts for
 * less than a heading, so the heading is the title.
 */
function nameSlots(texts) {
  const words = (t) => Math.min(1, (t.sample.match(/\p{L}/gu) ?? []).length / 6)
  const weight = (t) => t.size * words(t)
  const byWeight = texts.some((t) => weight(t) > 0)
  let title = 0
  texts.forEach((t, i) => {
    if ((byWeight ? weight(t) - weight(texts[title]) : t.size - texts[title].size) > 0.01) title = i
  })
  let n = 1
  return texts.map((t, i) => ({ name: i === title ? 'title' : `text${++n}`, ...t }))
}

// Text with braces (code on a slide) can't be a message, since braces mark placeholders; it stays as it is.
const q = (s) => (/[{}]/.test(s) ? JSON.stringify(s) : `msg(${JSON.stringify(s)})`)

function writeBoard(meta, slides) {
  const fonts = new Map()
  const designs = slides.map((s, i) => {
    for (const f of [...s.texts, ...s.artFonts]) fonts.set(`${f.font}|${f.weight}|${f.italic}`, { family: f.font, weight: f.weight, italic: f.italic })
    return { id: `${meta.id}.${i + 1}`, role: s.role, bg: s.bg, art: s.art, over: s.over, texts: nameSlots(s.texts).map(({ lines, ...t }) => ({ ...t, maxChars: Math.max(4, Math.ceil(t.sample.length * 1.4)) })) }
  })
  const used = [...fonts.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight)
  const body = designs.map((d) => {
    const texts = d.texts.map((t) => {
      const { sample, ...rest } = t
      const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      return `      { ${fields.join(', ')}, sample: ${q(sample)} }`
    })
    return `    {\n      id: ${JSON.stringify(d.id)},\n      role: ${q(d.role.charAt(0).toUpperCase() + d.role.slice(1))},\n      bg: ${JSON.stringify(d.bg)},\n      art: ${JSON.stringify(d.art)},\n${d.over ? `      over: ${JSON.stringify(d.over)},\n` : ''}      texts: [\n${texts.join(',\n')}\n      ]\n    }`
  })
  const src = `// Generated by scripts/build-templates.mjs from the ${meta.board} board. Don't edit by hand: change the board and run the script again.
// The sample text and each design's role are marked with msg() so they can be translated; the art holds no UI text.
import { msg } from '../../i18n'
import type { Board } from '../../core/deck/design'

const board: Board = {
  id: ${JSON.stringify(meta.id)},
  fonts: ${JSON.stringify(used)},
  designs: [
${body.join(',\n')}
  ]
}

export default board
`
  writeFileSync(join(OUT, `${meta.id}.ts`), src)
  return { fonts: used, firstSlide: designs[0]?.id }
}

function writeIndex(entries) {
  const info = entries.map((e) => `  { id: ${JSON.stringify(e.id)}, name: ${q(e.name)}, blurb: ${q(e.blurb)}, purpose: ${JSON.stringify(e.purpose)}, look: ${q(e.look)}, fonts: ${JSON.stringify([...new Set(e.fonts.map((f) => f.family))])}, slides: ${e.slides} }`)
  const loaders = entries.map((e) => `  ${JSON.stringify(e.id)}: () => import('./${e.id}').then((m) => m.default)`)
  writeFileSync(join(OUT, 'index.ts'), `// Generated by scripts/build-templates.mjs from scripts/templates.config.json and the boards. Don't edit by hand.
import { msg } from '../../i18n'
import type { Board, BoardInfo } from '../../core/deck/design'

/** The designed templates, in the order the start screen shows them. */
export const BOARDS: BoardInfo[] = [
${info.join(',\n')}
]

/** Each board's designs, loaded only when a deck or the start screen needs them. */
export const BOARD_LOADERS: Record<string, () => Promise<Board>> = {
${loaders.join(',\n')}
}
`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } })
mkdirSync(OUT, { recursive: true })
const entries = []
for (const meta of config.boards) {
  const file = join(dir, `${meta.board}.dc.html`)
  const title = canvas.boards?.[`${meta.board}.dc.html`]?.title ?? ''
  const [, purpose = meta.purpose, look = meta.look] = title.split(' · ')
  const entry = { ...meta, purpose: meta.purpose ?? purpose, look: meta.look ?? look }
  if (!PURPOSES.includes(entry.purpose)) throw new Error(`${meta.board}: purpose must be one of ${PURPOSES.join(', ')} (got ${entry.purpose})`)
  if (!entry.look) throw new Error(`${meta.board}: no look name; add "look" in templates.config.json`)
  if (only.length && !only.includes(meta.board)) {
    // Not rebuilt: keep what the last run wrote.
    const old = readFileSync(join(OUT, `${meta.id}.ts`), 'utf8')
    const fonts = JSON.parse(/fonts: (\[.*\]),/.exec(old)[1])
    entries.push({ ...entry, fonts, slides: (old.match(/^ {6}id: /gm) ?? []).length })
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
  const count = await page.locator('section[aria-label^="Slide"]').count()
  if (!count) throw new Error(`${meta.board}: no <section aria-label="Slide N, ..."> slides`)
  const slides = []
  for (let i = 0; i < count; i++) slides.push(await page.evaluate(extract, { index: i, prefix: `${meta.id}-${i + 1}`, scale: SCALE, families: [...FAMILIES] }))
  const { fonts } = writeBoard(entry, slides)
  entries.push({ ...entry, fonts, slides: count })
  console.log(`${meta.board}: ${count} slides, ${slides.reduce((n, s) => n + s.texts.length, 0)} text boxes, fonts ${[...new Set(fonts.map((f) => `${f.family} ${f.weight}${f.italic ? 'i' : ''}`))].join(', ')}`)
}
writeIndex(entries)
await browser.close()
