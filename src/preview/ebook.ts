/**
 * EPUB books: the chapters in reading order, one after another, each a "page" for
 * the Go menu and page counter. The book's own styles are left out so it reads in
 * Glance's type; its pictures come from inside the book.
 */
import JSZip from 'jszip'
import { adopt, cleanFragment, keepImagesLocal } from './sanitize'
import { trackCurrent, type PreviewRendering, type RenderOptions } from './render'

/** The most a book may unpack to; bigger ones are refused rather than freezing the window. */
const MAX_UNPACKED = 256 * 1024 * 1024

/** Resolves `href` against the file it appears in, as a path inside the book. */
export function resolvePath(from: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0].split('?')[0])
  const parts = clean.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const parse = (xml: string, type: DOMParserSupportedType = 'application/xml') => new DOMParser().parseFromString(xml, type)
const byLocalName = (root: Document | Element, name: string) => [...root.getElementsByTagName('*')].filter((el) => el.localName === name)

export interface EbookChapter {
  path: string
  html: string
}

export async function readEpub(bytes: Uint8Array): Promise<{ title: string; chapters: EbookChapter[]; zip: JSZip }> {
  const zip = await JSZip.loadAsync(bytes)
  let unpacked = 0
  zip.forEach((_, f) => (unpacked += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0))
  if (unpacked > MAX_UNPACKED) throw new Error('book too large')

  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = containerXml && byLocalName(parse(containerXml), 'rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('not an EPUB book')
  const opf = parse((await zip.file(opfPath)?.async('string')) ?? '')
  const manifest = new Map(byLocalName(opf, 'item').map((it) => [it.getAttribute('id') ?? '', { href: it.getAttribute('href') ?? '', type: it.getAttribute('media-type') ?? '' }]))
  const title = byLocalName(opf, 'title')[0]?.textContent?.trim() ?? ''

  const chapters: EbookChapter[] = []
  for (const ref of byLocalName(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (!item || !/html/.test(item.type)) continue
    const path = resolvePath(opfPath, item.href)
    const html = await zip.file(path)?.async('string')
    if (html != null) chapters.push({ path, html })
  }
  if (!chapters.length) throw new Error('the book has no chapters')
  return { title, chapters, zip }
}

export async function renderEbook(bytes: Uint8Array, container: HTMLElement, opts: RenderOptions): Promise<PreviewRendering> {
  const { chapters, zip } = await readEpub(bytes)
  const urls = new Map<string, string>()
  /** A picture inside the book, as a blob: address (made once per picture). */
  const pictureUrl = async (path: string): Promise<string | null> => {
    if (urls.has(path)) return urls.get(path)!
    const f = zip.file(path)
    if (!f) return null
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    const url = URL.createObjectURL(new Blob([await f.async('arraybuffer')], { type }))
    urls.set(path, url)
    return url
  }
  const chapterIndex = new Map(chapters.map((c, i) => [c.path, i]))

  const book = document.createElement('article')
  book.className = 'ebook'
  const sections: HTMLElement[] = []
  for (const [i, ch] of chapters.entries()) {
    let doc = parse(ch.html, 'application/xhtml+xml')
    if (doc.getElementsByTagName('parsererror').length) doc = parse(ch.html, 'text/html')
    const body = doc.body ?? byLocalName(doc, 'body')[0]
    if (!body) continue
    const clean = cleanFragment(new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>|<\/body>$/g, ''))
    // Pictures come from inside the book (set after cleaning, which doesn't allow blob: addresses).
    for (const el of clean.querySelectorAll('img, image')) {
      for (const attr of ['src', 'href', 'xlink:href']) {
        const v = el.getAttribute(attr)
        if (!v || /^[a-z]+:/i.test(v)) continue
        const url = await pictureUrl(resolvePath(ch.path, v))
        if (url) el.setAttribute(attr, url)
      }
    }
    keepImagesLocal(clean)
    const section = document.createElement('section')
    section.className = 'ebook-chapter'
    section.id = `chapter-${i}`
    section.append(adopt(clean))
    // Links to other chapters jump within the page; links to a spot keep its id.
    for (const a of section.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = a.getAttribute('href') ?? ''
      if (/^[a-z]+:/i.test(href)) continue
      const target = href.startsWith('#') ? i : chapterIndex.get(resolvePath(ch.path, href))
      const spot = href.split('#')[1]
      if (target == null) a.removeAttribute('href')
      else a.setAttribute('href', spot ? `#${spot}` : `#chapter-${target}`)
    }
    sections.push(section)
    book.append(section)
  }
  container.append(book)
  const observer = trackCurrent(sections, opts)
  return {
    pageCount: sections.length,
    sheetNames: [],
    goTo: (i) => sections[i]?.scrollIntoView({ block: 'start' }),
    setZoom: (scale) => (book.style.zoom = String(scale)),
    dispose: () => {
      observer.disconnect()
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }
}
