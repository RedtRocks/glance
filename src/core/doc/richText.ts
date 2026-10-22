/**
 * Typing on the page with live bold and italic: runs to the HTML the typing box shows, the
 * box's nodes back to runs, and splitting runs where Enter is pressed. No DOM needed: the
 * walk takes anything shaped like a node, so it is tested with plain objects.
 */
import { tidyRuns, type Run } from './model'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Runs as the typing box's HTML; a line break in the text is a <br>. */
export function runsToHtml(runs: Run[]): string {
  return runs.map((r) => {
    let s = esc(r.text).replace(/\n/g, '<br>')
    if (!s) return ''
    if (r.c) s = `<span data-c="${esc(r.c)}">${s}</span>`
    if (r.href) s = `<a href="${esc(r.href)}">${s}</a>`
    if (r.u) s = `<u>${s}</u>`
    if (r.i) s = `<i>${s}</i>`
    if (r.b) s = `<b>${s}</b>`
    return s
  }).join('')
}

/** The few parts of a DOM node the walk reads. */
export interface NodeLike {
  nodeType: number
  nodeName: string
  nodeValue?: string | null
  childNodes: ArrayLike<NodeLike>
  getAttribute?(name: string): string | null
  style?: { fontWeight?: string; fontStyle?: string; textDecoration?: string; textDecorationLine?: string }
}

type Marks = Omit<Run, 'text'>

/** What an element adds to (or takes off) the marks of the text inside it. */
function marksOf(el: NodeLike, m: Marks): Marks {
  const out = { ...m }
  const name = el.nodeName.toUpperCase()
  if (name === 'B' || name === 'STRONG') out.b = true
  if (name === 'I' || name === 'EM') out.i = true
  if (name === 'U') out.u = true
  if (name === 'A') {
    const href = el.getAttribute?.('href')
    if (href && /^(https?:|mailto:)/.test(href)) out.href = href
  }
  const c = el.getAttribute?.('data-c')
  if (c && /^\w{1,20}$/.test(c)) out.c = c
  // Bold and italic set by the browser's own commands, as inline styles.
  const st = el.style
  if (st?.fontWeight) out.b = st.fontWeight === 'bold' || st.fontWeight === 'bolder' || Number(st.fontWeight) >= 600
  if (st?.fontStyle) out.i = st.fontStyle === 'italic' || st.fontStyle === 'oblique'
  const deco = st?.textDecorationLine || st?.textDecoration
  if (deco) out.u = deco.includes('underline')
  return out
}

const clean = (m: Marks): Marks => ({
  ...(m.b ? { b: true } : {}),
  ...(m.i ? { i: true } : {}),
  ...(m.u ? { u: true } : {}),
  ...(m.href ? { href: m.href } : {}),
  ...(m.c ? { c: m.c } : {})
})

const BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'])

/**
 * The typing box's lines as runs. Browsers put each new line of a list in its own <div>,
 * or a <br>; both start a line. A trailing <br> the browser keeps in an empty line is not one.
 */
export function nodesToLines(root: NodeLike): Run[][] {
  const lines: Run[][] = [[]]
  const walk = (n: NodeLike, m: Marks) => {
    if (n.nodeType === 3) {
      const text = (n.nodeValue ?? '').replace(/ /g, ' ').replace(/​/g, '')
      if (text) lines[lines.length - 1].push({ text, ...clean(m) })
      return
    }
    if (n.nodeType !== 1) return
    const name = n.nodeName.toUpperCase()
    if (name === 'BR') {
      lines.push([])
      return
    }
    const block = BLOCKS.has(name)
    if (block && lines[lines.length - 1].length) lines.push([])
    const inner = marksOf(n, m)
    for (const c of Array.from(n.childNodes)) walk(c, inner)
    if (block && lines[lines.length - 1].length) lines.push([])
  }
  for (const c of Array.from(root.childNodes)) walk(c, {})
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop()
  return lines.map(tidyRuns)
}

/** The box as one block of runs; its lines are joined with line breaks. */
export function nodesToRuns(root: NodeLike): Run[] {
  const lines = nodesToLines(root)
  return tidyRuns(lines.flatMap((l, i) => (i ? [{ text: '\n' }, ...l] : l)))
}

export const runsLength = (runs: Run[]): number => runs.reduce((n, r) => n + r.text.length, 0)

/** Runs cut at a character offset: what comes before it and what comes after. */
export function splitRuns(runs: Run[], at: number): [Run[], Run[]] {
  const before: Run[] = []
  const after: Run[] = []
  let n = 0
  for (const r of runs) {
    const end = n + r.text.length
    if (end <= at) before.push(r)
    else if (n >= at) after.push(r)
    else {
      before.push({ ...r, text: r.text.slice(0, at - n) })
      after.push({ ...r, text: r.text.slice(at - n) })
    }
    n = end
  }
  return [tidyRuns(before), tidyRuns(after)]
}

/** Two blocks' runs made into one, as Backspace at the start of a paragraph does. */
export const joinRuns = (a: Run[], b: Run[]): Run[] => tidyRuns([...a, ...b])

/** Whether two sets of runs say the same thing with the same marks. */
export const sameRuns = (a: Run[], b: Run[]): boolean => JSON.stringify(tidyRuns(a)) === JSON.stringify(tidyRuns(b))

/** Line breaks at the end of a block are never wanted; the browser can leave one behind. */
export function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }))
  while (out.length && /\n$/.test(out[out.length - 1].text)) {
    const last = out[out.length - 1]
    last.text = last.text.replace(/\n+$/, '')
    if (!last.text) out.pop()
  }
  return tidyRuns(out)
}
