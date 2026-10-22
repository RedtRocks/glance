import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GDoc } from '../../state/documents'
import { contextMenu } from '../../state/ui'
import { findLook, lookInfo, looksVersion, loadLook } from '../../state/docLooks'
import { addBlock, changeGdoc, deleteBlock, editRequest, nudgeBlock, pagesOf, readAspects } from '../../state/gdoc'
import { addPicture, lookPicker, pagePicker } from '../../state/gdocCommands'
import { allBlocks, runsToText, type Block } from '../../core/doc/model'
import { findDocDesign, PAGE_H, PAGE_W } from '../../core/doc/look'
import type { DocOp } from '../../core/doc/ops'
import type { Hit, PageLayout } from '../../core/doc/layout'
import { pageHtml } from '../../core/doc/html'
import { mediaUrl } from '../../state/deckMedia'
import { msg, t } from '../../i18n'
import { Icon } from '../Icon'
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

/** The ops that put typed text back into a block. */
function editOps(g: GDoc, e: Editing, text: string): DocOp[] {
  const tg = e.target
  if (tg.kind === 'box') return [{ op: 'setText', section: e.section, box: tg.name, text }]
  if (tg.kind === 'cell') return [{ op: 'setCell', section: e.section, table: tg.table, row: tg.row, col: tg.col, text }]
  if (tg.kind !== 'block') return []
  const b = findBlock(g, tg.id)
  if (!b) return []
  if ((b.type === 'table' || b.type === 'chart') && tg.row !== undefined && tg.col !== undefined) return [{ op: 'setCell', id: b.id, row: tg.row, col: tg.col, text }]
  const keep = { ...('style' in b && b.style ? { style: b.style } : {}) }
  switch (b.type) {
    case 'heading':
      return [{ op: 'replaceBlock', id: b.id, block: { type: 'heading', level: b.level, text, ...keep } }]
    case 'paragraph':
      return [{ op: 'replaceBlock', id: b.id, block: { type: 'paragraph', text, ...keep, ...(b.icon ? { icon: b.icon } : {}) } }]
    case 'quote':
      return [{ op: 'replaceBlock', id: b.id, block: { type: 'quote', text, ...keep, ...(b.cite ? { cite: b.cite } : {}) } }]
    case 'list': {
      const items = text.split('\n').filter((l) => l.trim())
      return items.length ? [{ op: 'replaceBlock', id: b.id, block: { type: 'list', ordered: b.ordered, items, ...keep } }] : [{ op: 'deleteBlocks', ids: [b.id] }]
    }
    default:
      return []
  }
}

/** Wraps the picked text in a mark (Ctrl+B, Ctrl+I) the way it is typed: **bold**, *italic*. */
function wrapSelection(el: HTMLTextAreaElement, mark: string): void {
  const { selectionStart: a, selectionEnd: b, value } = el
  if (a === b) return
  el.value = value.slice(0, a) + mark + value.slice(a, b) + mark + value.slice(b)
  el.setSelectionRange(a + mark.length, b + mark.length)
}

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
  useEffect(() => {
    box.current?.focus()
  }, [editing])

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

  const commit = (e: Editing | null, text: string) => {
    if (!e || open.current !== e) return
    setEditing(null)
    const next = text.replace(/\n+$/, '')
    if (next === e.text) return
    const ops = editOps(g, e, next)
    if (ops.length) changeGdoc(g, msg('Typing'), ops)
  }

  /** Enter: the text after the caret moves into a new paragraph, which opens for typing. */
  const split = (e: Editing, el: HTMLTextAreaElement) => {
    if (open.current !== e || e.target.kind !== 'block') return
    const id = e.target.id
    const before = el.value.slice(0, el.selectionStart).replace(/\n+$/, '')
    const after = el.value.slice(el.selectionEnd).replace(/^\n+/, '')
    setEditing(null)
    const edit = before !== e.text ? editOps(g, e, before) : []
    // An empty paragraph already waiting below is where the typing goes next.
    const list = g.doc.peek().sections.find((x) => x.id === e.section)?.blocks ?? []
    const next = list[list.findIndex((x) => x.id === id) + 1]
    if (!after && next && next.type === 'paragraph' && hintOf(next)) {
      if (edit.length) changeGdoc(g, msg('Typing'), edit)
      g.selection.value = { section: e.section, block: next.id }
      editRequest.value = next.id
      return
    }
    const ops: DocOp[] = [...edit, { op: 'addBlocks', section: e.section, after: id, blocks: [{ type: 'paragraph', text: after }] }]
    const r = changeGdoc(g, msg('Typing'), ops)
    const added = r?.added.at(-1)
    if (!added) return
    g.selection.value = { section: e.section, block: added }
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
    if (prev && blockEditText(prev) !== null) editRequest.value = prev.id
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
      setEditing({ page: page.number - 1, target: tg, section, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, size: tb.size, font: tb.font, text: s?.texts[tg.name] ?? '', multiline: true, splits: false })
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
      setEditing({ page: page.number - 1, target, section, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, size: region?.style.text.size ?? 10, font: region?.style.text.font ?? 'Urbanist', text: s?.tables[tg.table]?.[row]?.[tg.col] ?? '', multiline: true, splits: false })
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
    setEditing({ page: page.number - 1, target: tg, section, rect, size: tg.row !== undefined ? 10 : st?.size ?? 11, font: st?.font ?? 'Urbanist', text, multiline: b.type !== 'heading' && tg.row === undefined, splits: tg.row === undefined && (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote') })
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
    const b = selectedBlock
    if (!b || (b.type !== 'heading' && b.type !== 'paragraph')) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const as = (block: Record<string, unknown>) => () => changeGdoc(g, msg('Change Style'), [{ op: 'replaceBlock', id: b.id, block: { ...block, text: runsToText(b.runs) } }])
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
  const blockLabel = (b: Block) => b.type === 'heading' ? t('Heading {n}', { n: b.level }) : b.type === 'paragraph' ? (b.style && b.style !== 'body' ? b.style : t('Paragraph')) : b.type === 'quote' ? t('Quote') : b.type === 'list' ? t('List') : b.type === 'table' ? t('Table') : b.type === 'picture' ? t('Picture') : b.type === 'chart' ? t('Chart') : t('Block')
  const tableOps = selectedBlock?.type === 'table' ? selectedBlock : null
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
            <button class="deck-bar-button" onClick={() => void addBlock(g, { type: 'heading', level: 2, text: '' })}>{t('Heading')}</button>
            <button class="deck-bar-button" onClick={() => void addBlock(g, { type: 'paragraph', text: '' })}>{t('Paragraph')}</button>
            <button class="deck-bar-button" onClick={() => void addBlock(g, { type: 'list', items: [''] })}>{t('List')}</button>
            <button class="deck-bar-button" onClick={() => void addBlock(g, { type: 'table', header: true, rows: [['', '', ''], ['', '', '']] })}>{t('Table')}</button>
            <button class="deck-bar-button" onClick={() => void addPicture(g)}><Icon name="image" size={16} />{t('Picture')}</button>
          </>
        )}
        <button class="deck-bar-button" onClick={() => void pagePicker(g)}><Icon name="addPage" size={16} />{t('Page')}</button>
        {selectedBlock && (
          <>
            <span class="deck-bar-gap" />
            <button class="deck-bar-button" onClick={styleMenu} disabled={selectedBlock.type !== 'heading' && selectedBlock.type !== 'paragraph'}>
              {blockLabel(selectedBlock)}
              <Icon name="down" size={12} />
            </button>
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
        {editing && (
          <textarea
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
            onBlur={(e) => commit(editing, (e.currentTarget as HTMLTextAreaElement).value)}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              const el = e.currentTarget
              // Escape leaves the box and keeps what was typed, as in Word.
              if (e.key === 'Escape') commit(editing, el.value)
              else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
                e.preventDefault()
                wrapSelection(el, e.key === 'b' ? '**' : '*')
              } else if (e.key === 'Enter' && !e.shiftKey && editing.splits && editing.target.kind === 'block') {
                e.preventDefault()
                split(editing, el)
              } else if (e.key === 'Enter' && !e.shiftKey && !editing.multiline) {
                e.preventDefault()
                commit(editing, el.value)
              } else if (e.key === 'Backspace' && !el.value && editing.splits && editing.target.kind === 'block') {
                e.preventDefault()
                removeEmpty(editing)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
