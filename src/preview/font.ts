/**
 * Font files: the font's name and a sample sheet in several sizes, with a line the
 * reader can type into. The font is loaded only into this window, never installed.
 */
import { t } from '../i18n'
import type { PreviewRendering } from './render'

export interface FontNames {
  family?: string
  style?: string
  version?: string
  designer?: string
  copyright?: string
}

/** Reads the name table of a TrueType/OpenType font (or a WOFF one, unpacking it). */
export async function fontNames(bytes: Uint8Array): Promise<FontNames> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = String.fromCharCode(...bytes.subarray(0, 4))
  let table: Uint8Array | null = null
  if (tag === 'wOFF') {
    const count = view.getUint16(12)
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20
      if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== 'name') continue
      const offset = view.getUint32(at + 4)
      const packed = view.getUint32(at + 8)
      const size = view.getUint32(at + 12)
      const raw = bytes.subarray(offset, offset + packed)
      table = packed < size ? await inflate(raw) : raw
    }
  } else if (tag === '\0\x01\0\0' || tag === 'OTTO' || tag === 'true') {
    const count = view.getUint16(4)
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16
      if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== 'name') continue
      table = bytes.subarray(view.getUint32(at + 8), view.getUint32(at + 8) + view.getUint32(at + 12))
    }
  }
  return table ? readNameTable(table) : {}
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function readNameTable(table: Uint8Array): FontNames {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const count = view.getUint16(2)
  const strings = view.getUint16(4)
  const found = new Map<number, { score: number; text: string }>()
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12
    if (at + 12 > table.length) break
    const platformId = view.getUint16(at)
    const lang = view.getUint16(at + 4)
    const id = view.getUint16(at + 6)
    const length = view.getUint16(at + 8)
    const start = strings + view.getUint16(at + 10)
    const raw = table.subarray(start, start + length)
    // Windows English names are best; Mac Roman ones do when there are none.
    let text: string
    let score: number
    if (platformId === 3 || platformId === 0) {
      text = new TextDecoder('utf-16be').decode(raw)
      score = lang === 0x409 ? 3 : 2
    } else if (platformId === 1) {
      text = new TextDecoder('macintosh').decode(raw)
      score = lang === 0 ? 1 : 0
    } else continue
    if ((found.get(id)?.score ?? -1) < score) found.set(id, { score, text: text.trim() })
  }
  const get = (id: number) => found.get(id)?.text || undefined
  return { family: get(16) ?? get(1), style: get(17) ?? get(2), version: get(5), designer: get(9), copyright: get(0) }
}

let seq = 0

export async function renderFont(ext: string, name: string, bytes: Uint8Array, container: HTMLElement): Promise<PreviewRendering> {
  const family = `glance-preview-font-${++seq}`
  const face = new FontFace(family, bytes.slice().buffer)
  await face.load()
  document.fonts.add(face)
  const names = await fontNames(bytes).catch((): FontNames => ({}))

  const sheet = document.createElement('div')
  sheet.className = 'font-sheet'
  const el = (tag: string, cls: string, text = '', fontFamily = false) => {
    const e = document.createElement(tag)
    e.className = cls
    e.textContent = text
    if (fontFamily) e.style.fontFamily = `"${family}"`
    return e
  }
  const head = el('header', 'font-head')
  const big = el('div', 'font-big', 'Aa', true) // i18n-ignore: a letter sample, not text to read
  const titles = el('div', 'font-titles')
  titles.append(el('h1', '', names.family ?? name.replace(/\.[^.]+$/, '')))
  const details = [names.style, names.version, ext.toUpperCase()].filter(Boolean).join(' · ')
  titles.append(el('p', 'font-meta', details))
  if (names.designer) titles.append(el('p', 'font-meta', t('Designed by {name}', { name: names.designer })))
  head.append(big, titles)

  const field = document.createElement('input')
  field.className = 'font-try'
  field.type = 'text'
  field.placeholder = t('Type to try the font')
  field.setAttribute('aria-label', t('Type to try the font'))

  const charset = el('div', 'font-charset', '', true)
  for (const line of ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 !?&@#%*()[]{}.,:;\'"«»'])
    charset.append(el('p', '', line))

  const pangram = t('The quick brown fox jumps over the lazy dog.')
  const sizes = el('div', 'font-sizes')
  const samples: HTMLElement[] = []
  for (const size of [12, 16, 24, 36, 48, 72]) {
    const row = el('div', 'font-size-row')
    row.append(el('span', 'font-size-label', `${size}`))
    const sample = el('p', 'font-sample', pangram, true)
    sample.style.fontSize = `${size}px`
    samples.push(sample)
    row.append(sample)
    sizes.append(row)
  }
  field.addEventListener('input', () => samples.forEach((s) => (s.textContent = field.value || pangram)))

  sheet.append(head, field, charset, sizes)
  if (names.copyright) sheet.append(el('p', 'font-copyright', names.copyright))
  container.append(sheet)
  return {
    pageCount: 1,
    sheetNames: [],
    goTo: () => {},
    setZoom: (scale) => (sheet.style.zoom = String(scale)),
    dispose: () => document.fonts.delete(face)
  }
}
