/**
 * A Word file (.docx) as a Glance document: its headings, paragraphs (bold, italic,
 * underline and links), lists, tables and pictures become blocks in a plain page of the
 * chosen look. What Word lays out itself (text boxes, columns, headers and footers,
 * fonts, colours, tracked changes and comments) is left out, and the result says so.
 *
 * Also an AI-safe edit: replacing text in a Word file, written to a new file, touching
 * only the text inside runs so the rest of the file stays as Word wrote it.
 *
 * The XML is read with regular expressions over the parts Word writes, so this runs
 * anywhere (tests, the browser, the app) without a DOM.
 */
import JSZip from 'jszip'
import { DOC_VERSION, tidyRuns, type Block, type Doc, type Run } from './model'

export interface DocxImport {
  doc: Doc
  media: Map<string, Uint8Array>
  /** What was left out, in plain words. */
  lost: string[]
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')

const attr = (xml: string, name: string) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(xml)
  return m ? decode(m[1]) : undefined
}

/** Top-level elements named `tag` in `xml`, nested ones of the same name kept inside. */
function elements(xml: string, tag: string): { xml: string; at: number }[] {
  const out: { xml: string; at: number }[] = []
  const open = new RegExp(`<${tag}[\\s>/]`, 'g')
  let i = 0
  for (;;) {
    open.lastIndex = i
    const m = open.exec(xml)
    if (!m) break
    const start = m.index
    // Self-closing
    const gt = xml.indexOf('>', start)
    if (xml[gt - 1] === '/') {
      out.push({ xml: xml.slice(start, gt + 1), at: start })
      i = gt + 1
      continue
    }
    let depth = 1
    let j = gt + 1
    const re = new RegExp(`<${tag}[\\s>/]|</${tag}>`, 'g')
    while (depth > 0) {
      re.lastIndex = j
      const n = re.exec(xml)
      if (!n) { j = xml.length; break }
      if (n[0].startsWith('</')) depth--
      else if (xml[xml.indexOf('>', n.index) - 1] !== '/') depth++
      j = n.index + n[0].length
    }
    out.push({ xml: xml.slice(start, j), at: start })
    i = j
  }
  return out
}

interface Ctx {
  rels: Map<string, string>
  styles: Map<string, string>
  numbered: Map<string, boolean>
  zip: JSZip
  media: Map<string, Uint8Array>
  lost: Set<string>
  id: () => string
}

function runsOf(p: string, ctx: Ctx): Run[] {
  const runs: Run[] = []
  // Links wrap runs; read them in order with the runs outside them.
  const parts = p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '')
  const re = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g
  for (let m = re.exec(parts); m; m = re.exec(parts)) {
    if (m[2] !== undefined) {
      const rid = attr(m[1], 'r:id')
      const href = rid ? ctx.rels.get(rid) : undefined
      for (const r of m[2].matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) runs.push(...run(r[1], href && /^(https?:|mailto:)/.test(href) ? href : undefined))
    } else runs.push(...run(m[3]))
  }
  return tidyRuns(runs)
}

function run(r: string, href?: string): Run[] {
  const pr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] ?? ''
  const on = (tag: string) => new RegExp(`<w:${tag}(?:\\s+w:val="(?:true|1|on)")?\\s*/>`).test(pr)
  const marks = { ...(on('b') ? { b: true } : {}), ...(on('i') ? { i: true } : {}), ...(/<w:u\s+w:val="(?!none)/.test(pr) ? { u: true } : {}), ...(href ? { href } : {}) }
  const out: Run[] = []
  for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:t\/>/g)) {
    const text = m[1] !== undefined ? decode(m[1]) : m[0] === '<w:tab/>' ? '\t' : m[0] === '<w:br/>' ? '\n' : ''
    if (text) out.push({ text, ...marks })
  }
  return out
}

const plainOf = (runs: Run[]) => runs.map((r) => r.text).join('')

async function pictureOf(p: string, ctx: Ctx): Promise<Block | null> {
  const blip = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(p)
  if (!blip) return null
  const target = ctx.rels.get(blip[1])
  if (!target) return null
  const path = target.startsWith('/') ? target.slice(1) : `word/${target}`
  const file = ctx.zip.file(path)
  const name = path.split('/').pop() ?? 'picture.png'
  if (!file || !/\.(png|jpe?g|gif|webp)$/i.test(name)) {
    ctx.lost.add('pictures in formats Glance can\'t show (like EMF or WMF)')
    return null
  }
  const src = `media/${name.replace(/[^\w .()-]/g, '_')}`
  ctx.media.set(src, await file.async('uint8array'))
  const alt = attr(/<wp:docPr\b[^>]*>/.exec(p)?.[0] ?? '', 'descr') ?? attr(/<wp:docPr\b[^>]*>/.exec(p)?.[0] ?? '', 'title') ?? ''
  return { id: ctx.id(), type: 'picture', src, alt }
}

function tableOf(t: string, ctx: Ctx): Block | null {
  const rows = elements(t, 'w:tr').map((tr) => elements(tr.xml, 'w:tc').map((tc) => elements(tc.xml, 'w:p').map((p) => plainOf(runsOf(p.xml, ctx))).join('\n').trim()))
  if (/<w:tbl[\s>]/.test(t.slice(5))) ctx.lost.add('tables inside tables (their text is kept)')
  if (/w:gridSpan|w:vMerge/.test(t)) ctx.lost.add('merged table cells')
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (!rows.length || !width) return null
  return { id: ctx.id(), type: 'table', header: true, rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]) }
}

/** Reads a .docx into a document in `look`, its blocks on that look's flowing page. */
export async function importDocx(bytes: Uint8Array, look: string, flowDesign: string): Promise<DocxImport> {
  const zip = await JSZip.loadAsync(bytes)
  const main = await zip.file('word/document.xml')?.async('string')
  if (!main) throw new Error('not a Word document (no word/document.xml)')
  const rels = new Map<string, string>()
  const relXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target)
  }
  const styles = new Map<string, string>()
  const styleXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
  for (const s of elements(styleXml, 'w:style')) {
    const id = attr(s.xml, 'w:styleId')
    const name = attr(/<w:name\b[^>]*>/.exec(s.xml)?.[0] ?? '', 'w:val')
    if (id && name) styles.set(id, name.toLowerCase())
  }
  const numbered = new Map<string, boolean>()
  const numXml = (await zip.file('word/numbering.xml')?.async('string')) ?? ''
  const abstract = new Map<string, boolean>()
  for (const a of elements(numXml, 'w:abstractNum')) {
    const fmt = attr(/<w:numFmt\b[^>]*>/.exec(a.xml)?.[0] ?? '', 'w:val')
    abstract.set(attr(a.xml, 'w:abstractNumId') ?? '', !!fmt && fmt !== 'bullet' && fmt !== 'none')
  }
  for (const n of elements(numXml, 'w:num')) {
    const aid = attr(/<w:abstractNumId\b[^>]*>/.exec(n.xml)?.[0] ?? '', 'w:val') ?? ''
    numbered.set(attr(n.xml, 'w:numId') ?? '', abstract.get(aid) ?? false)
  }
  let n = 0
  const ctx: Ctx = { rels, styles, numbered, zip, media: new Map(), lost: new Set(), id: () => `b${++n}` }
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(main)?.[1] ?? ''
  if (/<w:txbxContent/.test(body)) ctx.lost.add('text boxes (their text is kept as paragraphs)')
  if (/<w:cols\s+[^>]*w:num="[2-9]"/.test(body)) ctx.lost.add('columns')
  if (/<w:ins\b|<w:del\b/.test(body)) ctx.lost.add('tracked changes (the text is read as it stands now)')
  if ([...rels.values()].some((t) => /header|footer/.test(t))) ctx.lost.add('headers and footers')
  if (zip.file('word/comments.xml')) ctx.lost.add('comments')
  if (/<w:drawing>[\s\S]*?<c:chart/.test(body) || [...rels.values()].some((t) => /charts\//.test(t))) ctx.lost.add('charts')
  ctx.lost.add('fonts, colours and page layout (the look draws those)')

  const blocks: Block[] = []
  const items = [...elements(body, 'w:p').map((x) => ({ ...x, kind: 'p' as const })), ...elements(body, 'w:tbl').map((x) => ({ ...x, kind: 't' as const }))].sort((a, b) => a.at - b.at)
  // Paragraphs inside tables were found as part of the table too; skip those.
  const tables = items.filter((x) => x.kind === 't')
  const inTable = (at: number) => tables.some((t) => at > t.at && at < t.at + t.xml.length)
  let list: Extract<Block, { type: 'list' }> | null = null
  for (const it of items) {
    if (it.kind === 'p' && inTable(it.at)) continue
    if (it.kind === 't') {
      list = null
      const t = tableOf(it.xml, ctx)
      if (t) blocks.push(t)
      continue
    }
    const p = it.xml
    const pic = await pictureOf(p, ctx)
    if (pic) blocks.push(pic)
    if (/<w:br\s+w:type="page"\s*\/>/.test(p) || /<w:pageBreakBefore\s*\/>/.test(p)) blocks.push({ id: ctx.id(), type: 'pageBreak' })
    const runs = runsOf(p.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, ''), ctx)
    const text = plainOf(runs)
    const styleId = attr(/<w:pStyle\b[^>]*>/.exec(p)?.[0] ?? '', 'w:val') ?? ''
    const style = styles.get(styleId) ?? styleId.toLowerCase()
    const numId = attr(/<w:numId\b[^>]*>/.exec(p)?.[0] ?? '', 'w:val')
    if (numId && numId !== '0' && text.trim()) {
      const ordered = numbered.get(numId) ?? false
      if (!list || list.ordered !== ordered) {
        list = { id: ctx.id(), type: 'list', ordered, items: [] }
        blocks.push(list)
      }
      list.items.push(runs)
      continue
    }
    list = null
    if (!text.trim()) continue
    const h = /^(?:heading\s*|title$)(\d)?/.exec(style)
    if (h) {
      const level = style === 'title' ? 1 : Math.min(3, Math.max(1, Number(h[1] ?? 1)))
      blocks.push({ id: ctx.id(), type: 'heading', level: level as 1 | 2 | 3, runs })
    } else if (/quote/.test(style)) blocks.push({ id: ctx.id(), type: 'quote', runs })
    else blocks.push({ id: ctx.id(), type: 'paragraph', runs })
  }
  const doc: Doc = { version: DOC_VERSION, look, sections: [{ id: 'p1', design: flowDesign, texts: {}, tables: {}, blocks }] }
  return { doc, media: ctx.media, lost: [...ctx.lost] }
}

/**
 * Replaces text in a Word file and returns the new file's bytes; the original is left
 * alone. Only text inside one run is matched, so formatting, fields and the rest of the
 * file stay as they were; `count` says how many places changed.
 */
export async function replaceInDocx(bytes: Uint8Array, find: string, replace: string): Promise<{ bytes: Uint8Array; count: number }> {
  if (!find) throw new Error('find must not be empty')
  const zip = await JSZip.loadAsync(bytes)
  const parts = Object.keys(zip.files).filter((p) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))
  if (!parts.includes('word/document.xml')) throw new Error('not a Word document (no word/document.xml)')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let count = 0
  for (const part of parts) {
    const xml = await zip.file(part)!.async('string')
    const next = xml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_, open: string, inner: string, close: string) => {
      const text = decode(inner)
      if (!text.includes(find)) return open + inner + close
      const pieces = text.split(find)
      count += pieces.length - 1
      const out = pieces.join(replace)
      // Spaces at the ends are kept only with xml:space="preserve".
      const o = /^\s|\s$/.test(out) && !/xml:space/.test(open) ? open.replace('<w:t', '<w:t xml:space="preserve"') : open
      return o + esc(out) + close
    })
    if (next !== xml) zip.file(part, next)
  }
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), count }
}
