import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GDoc } from '../../state/documents'
import { contextMenu } from '../../state/ui'
import { findLook, lookInfo, looksVersion, loadLook } from '../../state/docLooks'
import { addBlock, changeGdoc, deleteBlock, editRequest, nudgeBlock, pagesOf, readAspects } from '../../state/gdoc'
import { addPicture, lookPicker, pagePicker } from '../../state/gdocCommands'
import { promptText } from '../../state/ui'
import { allBlocks, plain, runsToText, tidyRuns, type Block, type Run } from '../../core/doc/model'
import { findDocDesign, PAGE_H, PAGE_W, type TextStyle } from '../../core/doc/look'
import { joinRuns, nodesToLines, nodesToRuns, runsLength, runsToHtml, sameRuns, splitRuns, trimRuns } from '../../core/doc/richText'
import type { DocOp } from '../../core/doc/ops'
import type { Hit, PageLayout } from '../../core/doc/layout'
import { pageHtml } from '../../core/doc/html'
import { mediaUrl } from '../../state/deckMedia'
import { msg, t } from '../../i18n'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { stepZoom } from '../../state/commands'

const GAP = 24

/** A box being typed in: what it changes and where it sits over the page (page units). */
interface Editing {
  page: number
  target: Hit['target']
  section: string
  rect: { x: number; y: number; w: number; h: number }
  size: number
  font: string
  text: string
  multiline: boolean
  /** Enter starts a new paragraph after it, as in a word processor (headings, paragraphs, quotes). */
  splits: boolean
  /** Typed on the page with live bold and italic (text blocks); boxes and cells are plain text. */
  rich: boolean
  /** The block's runs when it opened, one list per line (a list's items), to tell if anything changed. */
  runs: Run[][]
  list: boolean
  ordered: boolean
  /** How the block's text looks, and the paper under it, so typing looks like the page. */
  st?: TextStyle
  bg: string
  /** Each box is a new element, so what the browser typed into the last one never carries over. */
  n: number
}

let boxes = 0

/** What a box holds now: plain text, or a rich box's lines of runs. */
type Typed = string | Run[][]

/** Characters from the start of a rich box to a point in it; a line break counts as one. */
function textOffset(root: HTMLElement, node: Node, off: number): number {
  const r = document.createRange()
  r.setStart(root, 0)
  r.setEnd(node, off)
  const w = document.createTreeWalker(r.cloneContents(), NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let n = 0
  for (let x = w.nextNode(); x; x = w.nextNode()) n += x.nodeType === 3 ? (x.nodeValue ?? '').length : x.nodeName === 'BR' ? 1 : 0
  return n
}

/** Where the selection starts and ends in a rich box, in characters. */
function caretOf(root: HTMLElement): { start: number; end: number } | null {
  const s = getSelection()
  if (!s?.rangeCount) return null
  const r = s.getRangeAt(0)
  if (!root.contains(r.startContainer)) return null
  return { start: textOffset(root, r.startContainer, r.startOffset), end: textOffset(root, r.endContainer, r.endOffset) }
}

/** Puts the caret so many characters into a rich box, or at its end. */
function placeCaret(root: HTMLElement, n: number | null): void {
  const r = document.createRange()
  let done = false
  if (n !== null) {
    let left = n
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let x = w.nextNode(); x && !done; x = w.nextNode()) {
      if (x.nodeType === 3) {
        const len = (x.nodeValue ?? '').length
        if (left <= len) {
          r.setStart(x, left)
          done = true
        } else left -= len
      } else if (x.nodeName === 'BR') {
        if (left === 0) {
          r.setStartBefore(x)
          done = true
        } else left -= 1
      }
    }
  }
  if (done) r.collapse(true)
  else {
    r.selectNodeContents(root)
    r.collapse(false)
  }
  const s = getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
}

/** Which marks the caret is in, so the B, I and U buttons light up as in Word. */
interface Marks {
  b: boolean
  i: boolean
  u: boolean
  link: boolean
}
const noMarks: Marks = { b: false, i: false, u: false, link: false }

function marksAt(root: HTMLElement | null): Marks {
  const s = getSelection()
  if (!root || !s?.anchorNode || !root.contains(s.anchorNode)) return noMarks
  const el = s.anchorNode.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode.parentElement
  return {
    b: document.queryCommandState('bold'),
    i: document.queryCommandState('italic'),
    u: document.queryCommandState('underline'),
    link: !!el?.closest('a') && root.contains(el!.closest('a'))
  }
}

const findBlock = (g: GDoc, id: string): Block | undefined => [...allBlocks(g.doc.peek())].find((x) => x.block.id === id)?.block

/** What an empty block shows while it waits to be typed in; only on screen, never saved or exported. */
function hintOf(b: Block | undefined): string | null {
  if (!b) return null
  if ((b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote') && !runsToText(b.runs).trim()) return b.type === 'heading' ? t('Heading') : t('Type here')
  if (b.type === 'list' && !b.items.some((i) => runsToText(i).trim())) return t('List item')
  return null
}

/** The text a block is typed as: light marks for runs, one line per list item. */
function blockEditText(b: Block, row?: number, col?: number): string | null {
  switch (b.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return runsToText(b.runs)
    case 'list':
      return b.items.map(runsToText).join('\n')
    case 'table':
    case 'chart':
      return row !== undefined && col !== undefined ? b.rows[row]?.[col] ?? '' : null
    default:
      return null
  }
}

/** The ops that put what was typed back into a block. */
function editOps(g: GDoc, e: Editing, typed: Typed): DocOp[] {
  const tg = e.target
  const text = typeof typed === 'string' ? typed : typed.map(plain).join('\n')
  if (tg.kind === 'box') return [{ op: 'setText', section: e.section, box: tg.name, text }]
  if (tg.kind === 'cell') return [{ op: 'setCell', section: e.section, table: tg.table, row: tg.row, col: tg.col, text }]
  if (tg.kind !== 'block') return []
  const b = findBlock(g, tg.id)
  if (!b) return []
  if ((b.type === 'table' || b.type === 'chart') && tg.row !== undefined && tg.col !== undefined) return [{ op: 'setCell', id: b.id, row: tg.row, col: tg.col, text }]
  const lines = typeof typed === 'string' ? typed.split('\n').map((l) => [{ text: l }]) : typed
  const runs = trimRuns(tidyRuns(lines.flatMap((l, i) => (i ? [{ text: '\n' }, ...l] : l))))
  const keep = { ...('style' in b && b.style ? { style: b.style } : {}) }
  switch (b.type) {
    case 'heading':
      return [{ op: 'replaceBlock', id: b.id, block: { type: 'heading', level: b.level, runs, ...keep } }]
    case 'paragraph':
      return [{ op: 'replaceBlock', id: b.id, block: { type: 'paragraph', runs, ...keep, ...(b.icon ? { icon: b.icon } : {}) } }]
    case 'quote':
      return [{ op: 'replaceBlock', id: b.id, block: { type: 'quote', runs, ...keep, ...(b.cite ? { cite: b.cite } : {}) } }]
    case 'list': {
      const items = lines.filter((l) => plain(l).trim())
      return items.length ? [{ op: 'replaceBlock', id: b.id, block: { type: 'list', ordered: b.ordered, items, ...keep } }] : [{ op: 'deleteBlocks', ids: [b.id] }]
    }
    default:
      return []
  }
}

/** A block's lines of runs, as its rich box starts out. */
function linesOf(b: Block): Run[][] {
  if (b.type === 'list') return b.items.length ? b.items : [[{ text: '' }]]
  if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote') return [b.runs]
  return []
}

/** The HTML a rich box starts with: each list item on a line of its own. */
const boxHtml = (e: Editing): string => (e.list ? e.runs.map((l) => `<div>${runsToHtml(l) || '<br>'}</div>`).join('') : runsToHtml(e.runs[0] ?? []))

function PageView({ g, page, scale, selected }: { g: GDoc; page: PageLayout; scale: number; selected: string | null }) {
  const board = findLook(g.doc.value.look)
  const media = g.mediaVersion.value
  const html = useMemo(() => pageHtml(page, board, { resolveSrc: (src) => mediaUrl(g, src), placeholder: (s) => (/[{}]/.test(s) ? s : t(s)) }), [page, board, media])
  const hints = page.hits.flatMap((h) => {
    if (h.target.kind !== 'block' || !h.target.first || h.target.row !== undefined) return []
    const text = hintOf(findBlock(g, h.target.id))
    return text ? [{ h, text }] : []
  })
  const marks = selected ? page.hits.filter((h) => (h.target.kind === 'block' && h.target.id === selected) || (h.target.kind === 'box' && `box:${h.target.name}` === selected)) : []
  return (
    <div class="doc-frame" style={{ width: `${PAGE_W * scale}px`, height: `${PAGE_H * scale}px` }} data-page-index={page.number - 1}>
      <div class="doc-frame-inner" style={{ transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html }} />
      {hints.map(({ h, text }, i) => (
        <div key={`hint${i}`} class="doc-hint" style={{ left: `${h.x * scale}px`, top: `${h.y * scale}px`, width: `${h.w * scale}px`, height: `${h.h * scale}px`, fontSize: `${Math.min(h.h * 0.7, 16) * scale}px` }}>
          {text}
        </div>
      ))}
      {marks.map((h, i) => (
        <div key={i} class="doc-selected" style={{ left: `${h.x * scale - 3}px`, top: `${h.y * scale - 3}px`, width: `${h.w * scale + 6}px`, height: `${h.h * scale + 6}px` }} />
      ))}
    </div>
  )
}

/** The document editor: every page down the screen, typed into where it is clicked. */
export function DocView({ doc: g }: { doc: GDoc }) {
  const stage = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const rich = useRef<HTMLDivElement>(null)
  const [marks, setMarks] = useState<Marks>(noMarks)
  // A dialog (the link's address) is open over a rich box: leaving it then is not leaving the box.
  const holding = useRef(false)
  // Letters typed between Enter and the next block's box opening, so a fast typist loses none.
  const queued = useRef<string | null>(null)
  const queue = () => {
    queued.current = ''
    setTimeout(() => (queued.current = null), 1000)
  }
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (queued.current === null || (ev.target as HTMLElement | null)?.closest?.('.doc-typing') || ev.ctrlKey || ev.metaKey || ev.altKey || ev.key.length !== 1) return
      ev.preventDefault()
      ev.stopPropagation()
      queued.current += ev.key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const [width, setWidth] = useState(0)
  const [editing, setEditingState] = useState<Editing | null>(null)
  const open = useRef<Editing | null>(null)
  const setEditing = (e: Editing | null) => {
    open.current = e
    setEditingState(e)
  }
  const data = g.doc.value
  const lv = looksVersion.value
  const mv = g.mediaVersion.value
  const board = findLook(data.look)
  const lookName = lookInfo(data.look)?.look
  useEffect(() => {
    void loadLook(data.look)
    void readAspects(g)
  }, [data.look])
  const pages = useMemo(() => (board ? pagesOf(g) : []), [data, board, lv, mv])
  useEffect(() => {
    g.pageCount.value = Math.max(1, pages.length)
  }, [pages.length])

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setEditing(null), [g.historyVersion.value])
  // Where the caret goes in the box that opens next; the end of its text unless a key says otherwise.
  const caret = useRef<number | null>(null)
  // Focused as soon as it is on screen, before the next key arrives.
  useLayoutEffect(() => {
    const r = rich.current
    if (r && editing?.rich) {
      r.focus({ preventScroll: true })
      placeCaret(r, caret.current)
      caret.current = null
      if (queued.current) document.execCommand('insertText', false, queued.current)
      queued.current = null
      const follow = () => setMarks(marksAt(rich.current))
      follow()
      document.addEventListener('selectionchange', follow)
      return () => {
        document.removeEventListener('selectionchange', follow)
        setMarks(noMarks)
      }
    }
    const el = box.current
    if (!el) return
    el.focus()
    const n = Math.min(caret.current ?? el.value.length, el.value.length)
    el.setSelectionRange(n, n)
    caret.current = null
    if (queued.current) el.setRangeText(queued.current, n, n, 'end')
    queued.current = null
  }, [editing])
  const html = useMemo(() => (editing?.rich ? boxHtml(editing) : ''), [editing])

  // Fits the page's width, up to about its printed size.
  const fit = Math.max(0.2, Math.min(1.3, (width - 2 * GAP) / PAGE_W))
  const scale = fit * g.zoom.value

  // The page strip and Go commands move `current`; scroll to it when it changes from outside.
  const scrolling = useRef(false)
  useEffect(() => {
    const el = stage.current
    const target = el?.querySelector<HTMLElement>(`[data-page-index="${g.current.value}"]`)
    if (!el || !target || scrolling.current) return
    el.scrollTo({ top: target.offsetTop - GAP, behavior: 'smooth' })
  }, [g.current.value])
  const onScroll = () => {
    const el = stage.current
    if (!el) return
    const n = Math.round((el.scrollTop + el.clientHeight / 3) / (PAGE_H * scale + GAP) - 0.5)
    const i = Math.max(0, Math.min(pages.length - 1, n))
    if (i !== g.current.peek()) {
      scrolling.current = true
      g.current.value = i
      queueMicrotask(() => (scrolling.current = false))
    }
  }

  /** What the open box holds now. */
  const typed = (e: Editing): Typed => {
    if (!e.rich) return (box.current?.value ?? e.text).replace(/\n+$/, '')
    const r = rich.current
    if (!r) return e.runs
    return e.list ? nodesToLines(r) : [trimRuns(nodesToRuns(r))]
  }
  const unchanged = (e: Editing, v: Typed) => (typeof v === 'string' ? v === e.text : v.length === e.runs.length && v.every((l, i) => sameRuns(l, e.runs[i])))

  const commit = (e: Editing | null) => {
    if (!e || open.current !== e) return
    const v = typed(e)
    setEditing(null)
    if (unchanged(e, v)) return
    const ops = editOps(g, e, v)
    if (ops.length) changeGdoc(g, msg('Typing'), ops)
  }

  /** Enter: the text after the caret moves into a new paragraph, which opens for typing. */
  const split = (e: Editing) => {
    const r = rich.current
    if (open.current !== e || e.target.kind !== 'block' || !r) return
    const id = e.target.id
    const runs = nodesToRuns(r)
    const at = caretOf(r) ?? { start: runsLength(runs), end: runsLength(runs) }
    const before = trimRuns(splitRuns(runs, at.start)[0])
    const after = splitRuns(runs, at.end)[1]
    setEditing(null)
    const edit = sameRuns(before, e.runs[0] ?? []) ? [] : editOps(g, e, [before])
    // An empty paragraph already waiting below is where the typing goes next.
    const list = g.doc.peek().sections.find((x) => x.id === e.section)?.blocks ?? []
    const next = list[list.findIndex((x) => x.id === id) + 1]
    if (!runsLength(after) && next && next.type === 'paragraph' && hintOf(next)) {
      if (edit.length) changeGdoc(g, msg('Typing'), edit)
      caret.current = 0
      g.selection.value = { section: e.section, block: next.id }
      queue()
      editRequest.value = next.id
      return
    }
    const ops: DocOp[] = [...edit, { op: 'addBlocks', section: e.section, after: id, blocks: [{ type: 'paragraph', runs: after }] }]
    const added = changeGdoc(g, msg('Typing'), ops)?.added.at(-1)
    if (!added) return
    caret.current = 0
    g.selection.value = { section: e.section, block: added }
    queue()
    editRequest.value = added
  }

  /** Backspace in an empty block: it goes, and the block before it opens for typing. */
  const removeEmpty = (e: Editing) => {
    if (open.current !== e || e.target.kind !== 'block') return
    const id = e.target.id
    const list = g.doc.peek().sections.find((x) => x.id === e.section)?.blocks ?? []
    const i = list.findIndex((b) => b.id === id)
    const prev = i > 0 ? list[i - 1] : undefined
    setEditing(null)
    if (!changeGdoc(g, msg('Delete Block'), [{ op: 'deleteBlocks', ids: [id] }])) return
    g.selection.value = { section: e.section, ...(prev ? { block: prev.id } : {}) }
    if (!prev || blockEditText(prev) === null) return
    queue()
    editRequest.value = prev.id
  }

  /** The text block before or after a block, skipping none: tables, pictures and the like stop the move. */
  const neighbour = (e: Editing, dir: -1 | 1): Block | undefined => {
    if (e.target.kind !== 'block') return undefined
    const id = e.target.id
    const list = g.doc.peek().sections.find((x) => x.id === e.section)?.blocks ?? []
    return list[list.findIndex((b) => b.id === id) + dir]
  }
  const typable = (b: Block | undefined): b is Extract<Block, { type: 'heading' | 'paragraph' | 'quote' }> => !!b && (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote')

  /** Up at the start of a box or Down at its end: on to the block before or after, as in a word processor. */
  const step = (e: Editing, dir: -1 | 1): boolean => {
    const next = neighbour(e, dir)
    if (!next || blockEditText(next) === null || next.type === 'table' || next.type === 'chart') return false
    caret.current = dir < 0 ? null : 0
    commit(e)
    g.selection.value = { section: e.section, block: next.id }
    queue()
    editRequest.value = next.id
    return true
  }

  /** Backspace at the start joins the block onto the one before; Delete at the end pulls the next one in. */
  const join = (e: Editing, dir: -1 | 1): boolean => {
    if (open.current !== e || e.target.kind !== 'block' || !rich.current) return false
    const here = findBlock(g, e.target.id)
    const other = neighbour(e, dir)
    if (!typable(here) || !typable(other)) return false
    const [first, second] = dir < 0 ? [other, here] : [here, other]
    const mine = trimRuns(nodesToRuns(rich.current))
    const a = dir < 0 ? other.runs : mine
    const b = dir < 0 ? mine : other.runs
    const keep = (x: typeof first) => ({ ...(x.style ? { style: x.style } : {}), ...(x.type === 'heading' ? { level: x.level } : {}) })
    setEditing(null)
    const r = changeGdoc(g, msg('Typing'), [
      { op: 'replaceBlock', id: first.id, block: { type: first.type, runs: joinRuns(a, b), ...keep(first) } },
      { op: 'deleteBlocks', ids: [second.id] }
    ])
    if (!r) return true
    caret.current = runsLength(a)
    g.selection.value = { section: e.section, block: first.id }
    queue()
    editRequest.value = first.id
    return true
  }

  const startEdit = (page: PageLayout, hit: Hit) => {
    const tg = hit.target
    const section = page.section
    if (tg.kind === 'empty') {
      void addBlock(g, { type: 'paragraph', text: '' })
      return
    }
    if (tg.kind === 'box') {
      g.selection.value = { section, box: tg.name }
      const d = findDocDesign(board, page.design?.id ?? '')
      const tb = d?.texts.find((x) => x.name === tg.name)
      if (!tb || d?.auto?.[tg.name] || d?.calcs?.[tg.name]) return
      const s = g.doc.peek().sections.find((x) => x.id === section)
      setEditing({ page: page.number - 1, target: tg, section, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, size: tb.size, font: tb.font, text: s?.texts[tg.name] ?? '', multiline: true, splits: false, rich: false, runs: [], list: false, ordered: false, bg: '#ffffff', n: ++boxes })
      return
    }
    if (tg.kind === 'cell') {
      g.selection.value = { section }
      // The region's hits count its header row; the section's rows don't hold it.
      const region = page.design?.tables.find((x) => x.name === tg.table)
      const row = tg.row - (region?.header ? 1 : 0)
      if (row < 0 || region?.calc?.some((c) => c.col === tg.col)) return
      const s = g.doc.peek().sections.find((x) => x.id === section)
      const target = { ...tg, row }
      setEditing({ page: page.number - 1, target, section, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, size: region?.style.text.size ?? 10, font: region?.style.text.font ?? 'Urbanist', text: s?.tables[tg.table]?.[row]?.[tg.col] ?? '', multiline: true, splits: false, rich: false, runs: [], list: false, ordered: false, bg: '#ffffff', n: ++boxes })
      return
    }
    g.selection.value = { section, block: tg.id }
    const b = findBlock(g, tg.id)
    if (!b) return
    const text = blockEditText(b, tg.row, tg.col)
    if (text === null) return
    // The block's whole extent on this page, so the typing covers what it replaces.
    const all = tg.row !== undefined ? [hit] : page.hits.filter((h) => h.target.kind === 'block' && h.target.id === tg.id && h.target.row === undefined)
    const x = Math.min(...all.map((h) => h.x))
    const y = Math.min(...all.map((h) => h.y))
    const rect = { x, y, w: Math.max(...all.map((h) => h.x + h.w)) - x, h: Math.max(...all.map((h) => h.y + h.h)) - y }
    const st = board?.styles[('style' in b && b.style) || (b.type === 'heading' ? `h${b.level}` : b.type === 'quote' ? 'quote' : b.type === 'list' ? 'list' : 'body')] ?? board?.styles.body
    const isRich = tg.row === undefined && (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote' || b.type === 'list')
    setEditing({
      page: page.number - 1,
      target: tg,
      section,
      rect,
      size: tg.row !== undefined ? 10 : st?.size ?? 11,
      font: st?.font ?? 'Urbanist',
      text,
      multiline: b.type !== 'heading' && tg.row === undefined,
      splits: tg.row === undefined && (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote'),
      rich: isRich,
      runs: isRich ? linesOf(b) : [],
      list: b.type === 'list',
      ordered: b.type === 'list' && b.ordered,
      ...(isRich && st ? { st } : {}),
      bg: st?.bg?.colour ?? (/^(#|rgb|hsl)/.test(page.bg) ? page.bg : '#ffffff'),
      n: ++boxes
    })
  }

  // A block just added from the toolbar opens for typing once it is laid out.
  useEffect(() => {
    const id = editRequest.value
    if (!id) return
    const page = pages.find((p) => p.hits.some((h) => h.target.kind === 'block' && h.target.id === id))
    const hit = page?.hits.find((h) => h.target.kind === 'block' && h.target.id === id)
    if (!page || !hit) return
    editRequest.value = null
    const el = stage.current
    if (el) el.scrollTop = Math.max(0, offsetOf(page.number - 1) + hit.y * scale - el.clientHeight / 3)
    startEdit(page, hit)
  }, [pages, editRequest.value])

  const onPageClick = (ev: MouseEvent) => {
    const frame = (ev.target as HTMLElement).closest<HTMLElement>('.doc-frame')
    if (!frame) return
    const page = pages[Number(frame.dataset.pageIndex)]
    if (!page) return
    const r = frame.getBoundingClientRect()
    const x = (ev.clientX - r.left) / scale
    const y = (ev.clientY - r.top) / scale
    // The smallest target under the click: a cell before its table, a block before the frame.
    const under = page.hits.filter((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h).sort((a, b) => a.w * a.h - b.w * b.h)
    if (!under.length) {
      g.selection.value = { section: page.section }
      // Below the last block of flowing text: type there, as in a word processor.
      const s = g.doc.peek().sections.find((x) => x.id === page.section)
      const last = s?.blocks?.at(-1)
      const lastPage = pages.filter((p) => p.section === page.section).at(-1)
      const bottom = Math.max(0, ...page.hits.filter((h) => h.target.kind === 'block').map((h) => h.y + h.h))
      if (!s?.blocks || lastPage !== page || y < bottom) return
      if (last && hintOf(last) && last.type !== 'list') {
        const at = page.hits.find((h) => h.target.kind === 'block' && h.target.id === last.id)
        if (at) return startEdit(page, at)
      }
      g.selection.value = { section: page.section, ...(last ? { block: last.id } : {}) }
      void addBlock(g, { type: 'paragraph', text: '' })
      return
    }
    startEdit(page, under[0])
  }

  const sel = g.selection.value
  const selectedBlock = sel?.block ? findBlock(g, sel.block) : undefined
  const selKey = sel?.block ?? (sel?.box ? `box:${sel.box}` : null)
  const offsetOf = (i: number) => GAP + i * (PAGE_H * scale + GAP)

  const styleMenu = (e: MouseEvent) => {
    const id = g.selection.peek()?.block
    const b = id ? findBlock(g, id) : undefined
    if (!b || (b.type !== 'heading' && b.type !== 'paragraph' && b.type !== 'quote')) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const as = (block: Record<string, unknown>) => () => {
      const now = findBlock(g, b.id)
      if (now && 'runs' in now) changeGdoc(g, msg('Change Style'), [{ op: 'replaceBlock', id: b.id, block: { ...block, runs: now.runs } }])
    }
    const named = Object.keys(board?.styles ?? {}).filter((k) => !/^(h[1-3]|body|list|quote|cite|caption)$/.test(k))
    contextMenu.value = {
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: t('Heading 1'), run: as({ type: 'heading', level: 1 }) },
        { label: t('Heading 2'), run: as({ type: 'heading', level: 2 }) },
        { label: t('Heading 3'), run: as({ type: 'heading', level: 3 }) },
        { label: t('Paragraph'), run: as({ type: 'paragraph' }) },
        { label: t('Quote'), run: as({ type: 'quote' }) },
        ...(named.length ? ['-' as const, ...named.map((k) => ({ label: board?.styleHints[k] ? `${k} · ${board.styleHints[k].slice(0, 40)}` : k, run: as({ type: 'paragraph', style: k }) }))] : [])
      ]
    }
  }
  const insertMenu = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    contextMenu.value = {
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: t('Heading'), run: () => void addBlock(g, { type: 'heading', level: 2, text: '' }) },
        { label: t('Paragraph'), run: () => void addBlock(g, { type: 'paragraph', text: '' }) },
        { label: t('Bulleted list'), run: () => void addBlock(g, { type: 'list', items: [''] }) },
        { label: t('Numbered list'), run: () => void addBlock(g, { type: 'list', ordered: true, items: [''] }) },
        { label: t('Quote'), run: () => void addBlock(g, { type: 'quote', text: '' }) },
        { label: t('Table'), run: () => void addBlock(g, { type: 'table', header: true, rows: [['', '', ''], ['', '', '']] }) },
        '-',
        { label: t('Picture…'), run: () => void addPicture(g) }
      ]
    }
  }

  /** Bold, italic and underline on the picked words (or what is typed next), as Word's buttons do. */
  const mark = (cmd: 'bold' | 'italic' | 'underline') => {
    if (!rich.current || !editing?.rich) return
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand(cmd)
    setMarks(marksAt(rich.current))
  }

  /** Ctrl+K and the link button: the picked words become a link, or the address itself is added. */
  const link = async () => {
    const r = rich.current
    const e = editing
    if (!r || !e?.rich) return
    const s = getSelection()
    const range = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null
    const a = (s?.anchorNode?.nodeType === 1 ? (s.anchorNode as Element) : s?.anchorNode?.parentElement)?.closest('a')
    holding.current = true
    const url = await promptText(t('Link'), t('Web address'), { initial: a?.getAttribute('href') ?? 'https://', ok: t('Add link') })
    // Back in the box only once the key that closed the dialog is done, or its Enter lands here.
    await new Promise((done) => setTimeout(done))
    holding.current = false
    if (open.current !== e) return
    r.focus({ preventScroll: true })
    if (range) {
      s?.removeAllRanges()
      s?.addRange(range)
    }
    if (url === null) return
    const href = url.trim()
    if (!href || href === 'https://') {
      if (a) {
        const pick = document.createRange()
        pick.selectNodeContents(a)
        s?.removeAllRanges()
        s?.addRange(pick)
        document.execCommand('unlink')
      }
      return
    }
    const safe = /^(https?:|mailto:)/i.test(href) ? href : /^[^\s@]+@[^\s@]+$/.test(href) ? `mailto:${href}` : `https://${href}`
    if (range && !range.collapsed) document.execCommand('createLink', false, safe)
    else document.execCommand('insertHTML', false, runsToHtml([{ text: href, href: safe }]))
    setMarks(marksAt(r))
  }

  /** The bulleted-list button: a paragraph becomes a list, one item a line, or a list goes back to paragraphs. */
  const toggleList = () => {
    const e = open.current
    if (e) commit(e)
    const id = g.selection.peek()?.block
    const b = id ? findBlock(g, id) : undefined
    const section = g.selection.peek()?.section
    if (!b || !section) return
    if (b.type === 'list') {
      const [first, ...rest] = b.items
      const r = changeGdoc(g, msg('Paragraphs'), [
        { op: 'replaceBlock', id: b.id, block: { type: 'paragraph', runs: first ?? [{ text: '' }] } },
        ...(rest.length ? [{ op: 'addBlocks' as const, section, after: b.id, blocks: rest.map((runs) => ({ type: 'paragraph', runs })) }] : [])
      ])
      if (r) editRequest.value = b.id
      return
    }
    if (b.type !== 'paragraph' && b.type !== 'heading' && b.type !== 'quote') return
    const items: Run[][] = [[]]
    for (const run of b.runs) {
      run.text.split('\n').forEach((part, i) => {
        if (i) items.push([])
        if (part) items[items.length - 1].push({ ...run, text: part })
      })
    }
    const r = changeGdoc(g, msg('Bulleted List'), [{ op: 'replaceBlock', id: b.id, block: { type: 'list', items: items.map((l) => (l.length ? l : [{ text: '' }])) } }])
    if (r) editRequest.value = b.id
  }

  /** Keys in a rich box: marks, links, and moving between blocks the way a word processor does. */
  const onRichKey = (ev: KeyboardEvent, e: Editing) => {
    ev.stopPropagation()
    const r = ev.currentTarget as HTMLDivElement
    const mod = ev.ctrlKey || ev.metaKey
    const key = ev.key.toLowerCase()
    if (ev.key === 'Escape') return commit(e)
    if (mod && key === 'z' && !ev.shiftKey && unchanged(e, typed(e))) {
      // Nothing typed in this box yet: Ctrl+Z undoes the document's last change, as in Word.
      ev.preventDefault()
      setEditing(null)
      return void g.undo()
    }
    if (mod && !ev.shiftKey && !ev.altKey && (key === 'b' || key === 'i' || key === 'u')) {
      ev.preventDefault()
      return mark(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline')
    }
    if (mod && key === 'k') {
      ev.preventDefault()
      return void link()
    }
    if (ev.key === 'Enter' && !ev.shiftKey && e.splits) {
      ev.preventDefault()
      return split(e)
    }
    if (ev.key === 'Enter' && ev.shiftKey && !e.multiline) {
      ev.preventDefault()
      return
    }
    const at = caretOf(r)
    const lines = e.list ? nodesToLines(r) : null
    const empty = lines ? lines.every((l) => !plain(l).trim()) : !runsLength(nodesToRuns(r))
    const anchor = getSelection()?.anchorNode
    const inLast = !!anchor && !!r.lastChild && (r.lastChild === anchor || r.lastChild.contains(anchor))
    if (ev.key === 'Enter' && !ev.shiftKey && lines && at && at.start === at.end && inLast && r.childNodes.length > 1 && !(r.lastChild?.textContent ?? '').trim()) {
      // Enter on an empty last item ends the list and starts a paragraph under it, as in Word.
      ev.preventDefault()
      return endList(e, lines)
    }
    if (ev.key === 'Backspace' && empty && e.target.kind === 'block') {
      ev.preventDefault()
      return removeEmpty(e)
    }
    if (!at || at.start !== at.end) return
    const end = textOffset(r, r, r.childNodes.length)
    const done =
      (!e.list && ev.key === 'Backspace' && at.start === 0 && join(e, -1)) ||
      (!e.list && ev.key === 'Delete' && at.start === end && join(e, 1)) ||
      (ev.key === 'ArrowUp' && at.start === 0 && step(e, -1)) ||
      (ev.key === 'ArrowDown' && at.start >= end && step(e, 1))
    if (done) ev.preventDefault()
  }

  /** The list keeps its other items, and a new paragraph under it opens for typing. */
  const endList = (e: Editing, keep: Run[][]) => {
    if (open.current !== e || e.target.kind !== 'block') return
    const id = e.target.id
    setEditing(null)
    const r = changeGdoc(g, msg('Typing'), [...editOps(g, e, keep), { op: 'addBlocks', section: e.section, after: id, blocks: [{ type: 'paragraph', text: '' }] }])
    const added = r?.added.at(-1)
    if (!added) return
    caret.current = 0
    g.selection.value = { section: e.section, block: added }
    queue()
    editRequest.value = added
  }

  const blockLabel = (b: Block) => b.type === 'heading' ? t('Heading {n}', { n: b.level }) : b.type === 'paragraph' ? (b.style && b.style !== 'body' ? b.style : t('Paragraph')) : b.type === 'quote' ? t('Quote') : b.type === 'list' ? t('List') : b.type === 'table' ? t('Table') : b.type === 'picture' ? t('Picture') : b.type === 'chart' ? t('Chart') : t('Block')
  const tableOps = selectedBlock?.type === 'table' ? selectedBlock : null
  const textual = !!selectedBlock && (selectedBlock.type === 'heading' || selectedBlock.type === 'paragraph' || selectedBlock.type === 'quote')
  // Marks only apply while typing in a block; the buttons keep the caret where it is.
  const formatButton = (icon: IconName, label: string, on: boolean, run: () => void, off = !editing?.rich) => (
    <button class={`deck-bar-button sheet-tool${on ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={on} disabled={off} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon name={icon} size={18} />
    </button>
  )
  const ai = g.aiChange.value
  const flowing = data.sections.some((s) => s.blocks)

  return (
    <div class="deck-view doc-view">
      <div class="deck-bar" role="toolbar" aria-label={t('Document')}>
        <button class="deck-bar-button" title={t('Change look')} onClick={() => void lookPicker(g)}>
          <Icon name="paintBrush" size={16} />
          {lookName ? t(lookName) : data.look}
        </button>
        <span class="deck-bar-gap" />
        {flowing && (
          <>
            <button class="deck-bar-button" onClick={styleMenu} disabled={!textual}>
              {selectedBlock ? blockLabel(selectedBlock) : t('Paragraph')}
              <Icon name="down" size={12} />
            </button>
            <span class="sheet-tool-sep" />
            {formatButton('bold', t('Bold (Ctrl+B)'), marks.b, () => mark('bold'))}
            {formatButton('italic', t('Italic (Ctrl+I)'), marks.i, () => mark('italic'))}
            {formatButton('underlineText', t('Underline (Ctrl+U)'), marks.u, () => mark('underline'))}
            {formatButton('link', t('Link (Ctrl+K)'), marks.link, () => void link())}
            {formatButton('bulletList', t('Bulleted list'), selectedBlock?.type === 'list', toggleList, !textual && selectedBlock?.type !== 'list')}
            <span class="sheet-tool-sep" />
            <button class="deck-bar-button" onClick={insertMenu}>
              {t('Insert')}
              <Icon name="down" size={12} />
            </button>
          </>
        )}
        <button class="deck-bar-button" onClick={() => void pagePicker(g)}><Icon name="addPage" size={16} />{t('Page')}</button>
        {selectedBlock && (
          <>
            <span class="deck-bar-gap" />
            {tableOps && <button class="deck-bar-button" onClick={() => changeGdoc(g, msg('Add Row'), [{ op: 'addRow', id: tableOps.id, cells: tableOps.rows[0].map(() => '') }])}>{t('Add row')}</button>}
            {tableOps && tableOps.rows.length > 1 && <button class="deck-bar-button" onClick={() => changeGdoc(g, msg('Delete Row'), [{ op: 'deleteRow', id: tableOps.id, row: tableOps.rows.length - 1 }])}>{t('Remove row')}</button>}
            <button class="deck-bar-button" aria-label={t('Move up')} title={t('Move up')} onClick={() => nudgeBlock(g, -1)}><Icon name="up" size={16} /></button>
            <button class="deck-bar-button" aria-label={t('Move down')} title={t('Move down')} onClick={() => nudgeBlock(g, 1)}><Icon name="down" size={16} /></button>
            <button class="deck-bar-button" aria-label={t('Delete')} title={t('Delete')} onClick={() => deleteBlock(g)}><Icon name="trash" size={16} /></button>
          </>
        )}
        <span class="doc-bar-fill" />
        <button class="deck-bar-button" aria-label={t('Zoom out')} title={t('Zoom out')} onClick={() => (g.zoom.value = stepZoom(g.zoom.value, -1))}><Icon name="zoomOut" size={16} /></button>
        <span class="doc-zoom">{Math.round(scale * 100)}%</span>
        <button class="deck-bar-button" aria-label={t('Zoom in')} title={t('Zoom in')} onClick={() => (g.zoom.value = stepZoom(g.zoom.value, 1))}><Icon name="zoomIn" size={16} /></button>
      </div>
      {ai && (
        <div class="doc-ai-bar" role="status">
          <Icon name="sparkle" size={16} />
          <span>{t('An AI app changed this document: {what}', { what: ai.label })}</span>
          <button class="primary" onClick={() => (g.aiChange.value = null)}>{t('Keep')}</button>
          <button onClick={() => g.undoAiChange()}>{t('Undo')}</button>
        </div>
      )}
      <div class="doc-stage" ref={stage} onScroll={onScroll}>
        {!board && <div class="deck-empty"><p>{t('Loading the look…')}</p></div>}
        <div class="doc-pages" onClick={onPageClick}>
          {width > 0 && pages.map((p) => <PageView key={`${p.section}-${p.number}`} g={g} page={p} scale={scale} selected={selKey} />)}
        </div>
        {editing?.rich && (
          <div
            key={editing.n}
            ref={rich}
            class={`doc-typing doc-rich${editing.list ? (editing.ordered ? ' doc-rich-list ordered' : ' doc-rich-list') : ''}`}
            contentEditable
            role="textbox"
            aria-multiline={editing.multiline || editing.list}
            aria-label={t('Document text')}
            spellcheck
            style={{
              left: `${(width - PAGE_W * scale) / 2 + editing.rect.x * scale - 4}px`,
              top: `${offsetOf(editing.page) + editing.rect.y * scale - 4}px`,
              width: `${editing.rect.w * scale + 8}px`,
              minHeight: `${editing.rect.h * scale + 8}px`,
              fontSize: `${editing.size * scale}px`,
              fontFamily: `'${editing.font}', Urbanist, sans-serif`,
              background: editing.bg,
              ...(editing.st
                ? {
                    color: editing.st.colour,
                    fontWeight: editing.st.weight,
                    fontStyle: editing.st.italic ? 'italic' : 'normal',
                    lineHeight: editing.st.lineHeight,
                    letterSpacing: `${editing.st.letterSpacing * scale}px`,
                    textAlign: editing.st.align,
                    ...(editing.st.transform ? { textTransform: editing.st.transform } : {})
                  }
                : {})
            }}
            dangerouslySetInnerHTML={{ __html: html }}
            onBlur={() => {
              if (!holding.current) commit(editing)
            }}
            onPaste={(ev) => {
              // Pasted text comes in plain, in the page's own font, as Word's "keep text only".
              ev.preventDefault()
              const text = ev.clipboardData?.getData('text/plain') ?? ''
              document.execCommand('insertText', false, editing.list ? text : text.replace(/\r?\n+/g, editing.multiline ? '\n' : ' '))
            }}
            onKeyDown={(ev) => onRichKey(ev as unknown as KeyboardEvent, editing)}
          />
        )}
        {editing && !editing.rich && (
          <textarea
            key={editing.n}
            ref={box}
            class="doc-typing"
            aria-label={t('Document text')}
            spellcheck
            style={{
              left: `${(width - PAGE_W * scale) / 2 + editing.rect.x * scale - 4}px`,
              top: `${offsetOf(editing.page) + editing.rect.y * scale - 4}px`,
              width: `${editing.rect.w * scale + 8}px`,
              minHeight: `${editing.rect.h * scale + 8}px`,
              fontSize: `${editing.size * scale}px`,
              fontFamily: `'${editing.font}', Urbanist, sans-serif`
            }}
            defaultValue={editing.text}
            onBlur={() => commit(editing)}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              const el = e.currentTarget
              // Escape leaves the box and keeps what was typed, as in Word.
              if (e.key === 'Escape') commit(editing)
              else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && el.value === editing.text) {
                // Nothing typed in this box yet: Ctrl+Z undoes the document's last change, as in Word.
                e.preventDefault()
                setEditing(null)
                void g.undo()
              } else if (e.key === 'Enter' && !e.shiftKey && !editing.multiline) {
                e.preventDefault()
                commit(editing)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
