/**
 * Plain text and source code, with line numbers and highlight.js colours.
 */
import { zoomable, type PreviewRendering } from './render'
import { t } from '../i18n'

/** Files above this are shown without colours; highlighting them would stall the window. */
const HIGHLIGHT_LIMIT = 2 * 1024 * 1024
/** Files above this show their beginning only. */
const SHOW_LIMIT = 16 * 1024 * 1024

/** highlight.js names for extensions it doesn't know as aliases. */
const LANGUAGES: Record<string, string> = {
  vue: 'xml', svelte: 'xml', plist: 'xml', jsonc: 'json', json5: 'json', cfg: 'ini', conf: 'ini', env: 'bash', properties: 'ini',
  kts: 'kotlin', mjs: 'javascript', cjs: 'javascript', h: 'c', hpp: 'cpp', cxx: 'cpp', fish: 'bash', zsh: 'bash', gql: 'graphql',
  gitignore: 'bash'
}

/**
 * Text in the encoding it was saved in: a byte-order mark decides; otherwise UTF-8,
 * falling back to Windows-1252 for older files that aren't valid UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** JSON written on one long line is laid out so it can be read; anything else is left alone. */
export function tidyJson(text: string): string {
  if (text.length > HIGHLIGHT_LIMIT || text.split('\n', 3).length > 2) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export async function highlighter() {
  return (await import('highlight.js/lib/common')).default
}

/** Colours code into `el` (an empty <code>); unknown languages stay plain. */
export async function highlightInto(el: HTMLElement, text: string, lang: string): Promise<void> {
  const hljs = await highlighter()
  const name = LANGUAGES[lang] ?? lang
  if (text.length > HIGHLIGHT_LIMIT || !name || name === 'plaintext' || !hljs.getLanguage(name)) {
    el.textContent = text
    return
  }
  // highlight.js escapes the text it's given, so its output is safe to insert.
  el.innerHTML = hljs.highlight(text, { language: name, ignoreIllegals: true }).value
  el.classList.add('hljs')
}

export async function renderText(ext: string, bytes: Uint8Array, container: HTMLElement): Promise<PreviewRendering> {
  const cut = bytes.length > SHOW_LIMIT
  let text = decodeText(cut ? bytes.subarray(0, SHOW_LIMIT) : bytes).replace(/\r\n?/g, '\n')
  if (ext === 'json') text = tidyJson(text)
  if (text.endsWith('\n')) text = text.slice(0, -1)
  const lines = text.split('\n').length

  const host = document.createElement('div')
  host.className = 'code-view'
  const gutter = document.createElement('pre')
  gutter.className = 'code-lines'
  gutter.setAttribute('aria-hidden', 'true')
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n')
  const pre = document.createElement('pre')
  pre.className = 'code-text'
  const code = document.createElement('code')
  pre.append(code)
  host.append(gutter, pre)
  container.append(host)
  if (cut) {
    const note = document.createElement('p')
    note.className = 'preview-note'
    note.textContent = t('This file is large, so Glance shows its first 16 MB.')
    container.prepend(note)
  }
  await highlightInto(code, text, ext)
  return zoomable(host)
}
