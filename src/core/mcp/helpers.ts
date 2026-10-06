/** Pure helpers for the AI tools (src/state/mcpTools.ts): page lists, output paths, search. */
import { SENSITIVE_PATTERNS, termRegex } from '../findText'
import { ToolError } from './protocol'

/**
 * Pages like "1-3,7,10-" (numbered from 1) as sorted, unique 0-based indices.
 * Empty or missing means every page.
 */
export function parsePages(spec: string | undefined, count: number): number[] {
  if (spec === undefined || !spec.trim() || /^\s*all\s*$/i.test(spec)) return [...Array(count).keys()]
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(p)
    if (!m || (!m[1] && !m[3])) throw new ToolError(`"${p}" isn't a page or page range (use something like "1-3,7")`)
    const from = m[1] ? Number(m[1]) : 1
    const to = m[2] ? (m[3] ? Number(m[3]) : count) : from
    if (from < 1 || to < from || to > count) throw new ToolError(`pages "${p}" are outside 1-${count}`)
    for (let i = from; i <= to; i++) out.add(i - 1)
  }
  return [...out].sort((a, b) => a - b)
}

/** One-based page from a tool argument, checked against the document. */
export function pageIndex(page: unknown, count: number): number {
  const n = page === undefined || page === null ? 1 : Number(page)
  if (!Number.isInteger(n) || n < 1 || n > count) throw new ToolError(`page ${String(page)} doesn't exist (the file has ${count} page${count === 1 ? '' : 's'})`)
  return n - 1
}

const sep = /[\\/]/

export function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

/** Paths compare like Windows does: case-insensitive, either slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.split(sep).filter(Boolean).join('/').toLowerCase()
  return norm(a) === norm(b)
}

export function extension(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
}

/**
 * Checks where a tool may write: an absolute path that isn't one of its inputs (tools
 * never change the files they're given) and doesn't exist unless overwriting.
 */
export function checkOutput(output: string, inputs: string[], exists: boolean, overwrite: boolean): void {
  if (!isAbsolute(output)) throw new ToolError(`output_path must be an absolute path: ${output}`)
  if (inputs.some((i) => samePath(i, output))) throw new ToolError('output_path must be a new file: Glance never overwrites the file it reads from')
  if (exists && !overwrite) throw new ToolError(`${output} already exists (pass overwrite: true to replace it)`)
}

export function checkInput(path: unknown): string {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new ToolError(`path must be an absolute path: ${String(path)}`)
  return path
}

/** split's part names: "C:\out\Report.pdf" → "C:\out\Report 1.pdf", "Report 2.pdf", … */
export function partPath(output: string, n: number): string {
  const m = /^(.*?)(\.[^.\\/]+)?$/.exec(output)!
  return `${m[1]} ${n}${m[2] ?? ''}`
}

export interface SearchArgs {
  terms?: string[]
  patterns?: string[]
  regex?: string
  match_case?: boolean
  whole_word?: boolean
}

/** The regexes a redaction search runs. Throws when nothing was asked for. */
export function searchRegexes(args: SearchArgs): RegExp[] {
  const out: RegExp[] = []
  for (const term of args.terms ?? []) {
    const r = termRegex(term, args.match_case ?? false, args.whole_word ?? true)
    if (r) out.push(r)
  }
  for (const id of args.patterns ?? []) {
    const p = SENSITIVE_PATTERNS.find((s) => s.id === id)
    if (!p) throw new ToolError(`unknown pattern "${id}"`)
    out.push(new RegExp(p.re.source, p.re.flags))
  }
  if (args.regex) {
    try {
      out.push(new RegExp(args.regex, 'gu'))
    } catch (e) {
      throw new ToolError(`regex: ${(e as Error).message}`)
    }
  }
  if (!out.length) throw new ToolError('say what to redact: terms, patterns or regex')
  return out
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface OcrLine {
  words: ({ text: string } & Box)[]
}

/**
 * Matches in OCR'd lines (words joined by spaces), each with the boxes of the words
 * it touches.
 */
export function matchOcrLines(lines: OcrLine[], regexes: RegExp[]): { text: string; boxes: Box[] }[] {
  const out: { text: string; boxes: Box[] }[] = []
  for (const line of lines) {
    const starts: number[] = []
    let text = ''
    for (const w of line.words) {
      if (text) text += ' '
      starts.push(text.length)
      text += w.text
    }
    for (const re of regexes) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      for (const m of text.matchAll(g)) {
        if (!m[0]) continue
        const a = m.index!
        const b = a + m[0].length
        const boxes = line.words.filter((w, i) => starts[i] < b && starts[i] + w.text.length > a).map(({ x, y, w, h }) => ({ x, y, w, h }))
        if (boxes.length) out.push({ text: m[0], boxes })
      }
    }
  }
  return out
}

/** Base64 of bytes, in chunks so large images don't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
