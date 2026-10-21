/**
 * Document to Word (.docx): real paragraphs, headings, lists and tables people can keep
 * editing in Word. Each section is a Word section with the page's margins; its art is a
 * picture behind the text, anchored to the page, and a fixed page's text boxes are frames
 * at the boxes' places. Charts become tables of their numbers, and a look's drawings
 * become pictures.
 *
 * Only call this through a dynamic import: it pulls in docx.
 */
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Header, HeightRule, FrameAnchorType, HeadingLevel, HorizontalPositionRelativeFrom, ImageRun,
  LevelFormat, Packer, PageBreak, Paragraph, ShadingType, Table, TableAnchorType, TableCell, TableRow, TextRun, VerticalPositionRelativeFrom,
  WidthType, type FileChild, type ParagraphChild
} from 'docx'
import { PAGE_H, PAGE_W, findDocDesign, type DocBoard, type DocDesign, type TextStyle } from '../core/doc/look'
import { styleOf, tableStyleOf, boxStyleOf } from '../core/doc/layout'
import { boxValues, computeRows } from '../core/doc/calc'
import type { Block, Doc, Run, Section } from '../core/doc/model'

export interface DocxInput {
  doc: Doc
  board: DocBoard | undefined
  media: Map<string, Uint8Array>
  /** A section's page art (no text) as PNG: its first page's, and the following pages' when they differ. */
  art: (section: Section) => Promise<{ first: Uint8Array | null; rest?: Uint8Array | null }>
  /** A picture's width over its height. */
  aspect?: (src: string) => number | undefined
  title?: string
}

const TW = 20 // twips per point
const PX = 96 / 72 // pixels per point, as docx sizes pictures

const hex = (c: string | undefined) => {
  const m = /^#?([0-9a-f]{6})/i.exec(c ?? '')
  return m ? m[1].toUpperCase() : undefined
}
const align = (a: string | undefined) => (a === 'center' ? AlignmentType.CENTER : a === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT)

function runsOf(runs: Run[], st: TextStyle, palette: Record<string, string>, extra: { bold?: boolean; italics?: boolean } = {}): ParagraphChild[] {
  // A line break inside a run becomes Word's own break.
  const split = runs.flatMap((r) => r.text.split('\n').map((text, i) => ({ ...r, text, brk: i > 0 })))
  return split.filter((r) => r.text || r.brk).map((r) => {
    const run = new TextRun({
      text: st.transform === 'uppercase' ? r.text.toUpperCase() : r.text,
      ...(r.brk ? { break: 1 } : {}),
      bold: r.b || st.weight >= 600 || extra.bold,
      italics: r.i || st.italic || extra.italics,
      underline: r.u || r.href ? {} : undefined,
      color: hex((r.c && palette[r.c]) || st.colour),
      font: st.font,
      size: Math.round(st.size * 2),
      characterSpacing: st.letterSpacing ? Math.round(st.letterSpacing * TW) : undefined,
      style: r.href ? 'Hyperlink' : undefined
    })
    return r.href && /^(https?:|mailto:)/.test(r.href) ? new ExternalHyperlink({ link: r.href, children: [run] }) : run
  })
}

function para(runs: Run[], st: TextStyle, palette: Record<string, string>, opts: Partial<ConstructorParameters<typeof Paragraph>[0] & object> = {}): Paragraph {
  return new Paragraph({
    children: runsOf(runs, st, palette),
    alignment: align(st.align),
    spacing: { before: Math.round(st.before * TW), after: Math.round(st.after * TW), line: Math.round(st.lineHeight * 240) },
    ...(st.indent || st.padLeft ? { indent: { left: Math.round((st.padLeft ?? 0) * TW), ...(st.indent && st.indent < 0 ? { hanging: Math.round(-st.indent * TW) } : st.indent ? { firstLine: Math.round(st.indent * TW) } : {}) } } : {}),
    ...(st.rule ? { border: { bottom: { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(st.rule.w * 8)), color: hex(st.rule.colour) ?? '000000', space: Math.round(st.rule.gap) } } } : {}),
    ...(st.bar ? { border: { left: { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(st.bar.w * 8)), color: hex(st.bar.colour) ?? '000000', space: Math.round(st.bar.gap) } } } : {}),
    ...(st.bg ? { shading: { type: ShadingType.CLEAR, fill: hex(st.bg.colour), color: 'auto' } } : {}),
    ...opts
  } as ConstructorParameters<typeof Paragraph>[0])
}

function tableOf(rows: string[][], header: boolean, footer: boolean, board: DocBoard | undefined, styleKey: string | undefined, width: number, float?: { x: number; y: number }): Table {
  const ts = tableStyleOf(board, styleKey)
  const n = Math.max(1, ...rows.map((r) => r.length))
  const shares = ts.cols.length === n ? ts.cols.map((c) => c.w) : Array(n).fill(1)
  const total = shares.reduce((a, b) => a + b, 0) || 1
  const widths = shares.map((s) => Math.round((s / total) * width * TW))
  const line = ts.line ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(ts.line.w * 8)), color: hex(ts.line.colour) ?? 'CCCCCC' } : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  return new Table({
    width: { size: Math.round(width * TW), type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: none, left: none, right: none, bottom: line, insideHorizontal: line, insideVertical: ts.colLine ? line : none },
    ...(float ? { float: { horizontalAnchor: TableAnchorType.PAGE, verticalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: Math.round(float.x * TW), absoluteVerticalPosition: Math.round(float.y * TW) } } : {}),
    rows: rows.map((row, r) => {
      const head = header && r === 0
      const foot = footer && r === rows.length - 1
      return new TableRow({
        tableHeader: head,
        children: Array.from({ length: n }, (_, c) => {
          const col = ts.cols[c]
          const st: TextStyle = {
            ...ts.text,
            ...(col?.size ? { size: col.size } : {}),
            ...(col?.colour ? { colour: col.colour } : {}),
            ...(col?.bold ? { weight: 700 } : {}),
            ...(head && ts.head ? { colour: ts.head.colour, size: ts.head.size, weight: ts.head.weight, transform: ts.head.transform, letterSpacing: ts.head.letterSpacing } : {}),
            ...(foot && ts.foot ? { weight: ts.foot.weight, colour: ts.foot.colour } : {}),
            align: col?.align ?? 'left', before: 0, after: 0
          }
          const lines = (row[c] ?? '').split('\n')
          return new TableCell({
            width: { size: widths[c], type: WidthType.DXA },
            margins: { left: Math.round(ts.padX * TW), right: Math.round(ts.padX * TW), top: 60, bottom: 60 },
            ...(head && ts.head?.bg ? { shading: { type: ShadingType.CLEAR, fill: hex(ts.head.bg), color: 'auto' } } : !head && ts.stripe && r % 2 === 0 ? { shading: { type: ShadingType.CLEAR, fill: hex(ts.stripe), color: 'auto' } } : {}),
            children: lines.map((l, i) => para([{ text: l }], i && col?.sub ? { ...st, size: col.sub.size, colour: col.sub.colour, weight: col.sub.weight, italic: col.sub.italic } : st, board?.palette ?? {}))
          })
        })
      })
    })
  })
}

async function blocksOf(blocks: Block[], ctx: Ctx, width: number): Promise<FileChild[]> {
  const out: FileChild[] = []
  const pal = ctx.board?.palette ?? {}
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const st = styleOf(ctx.board, b.style ?? `h${b.level}`)
        out.push(para(b.runs, st, pal, { heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.level - 1], keepNext: true }))
        break
      }
      case 'paragraph':
        out.push(para(b.runs, styleOf(ctx.board, b.style ?? 'body'), pal))
        break
      case 'quote': {
        const st = styleOf(ctx.board, b.style ?? 'quote')
        out.push(para(b.runs, st, pal, { indent: { left: 360 } }))
        if (b.cite) out.push(para([{ text: b.cite }], styleOf(ctx.board, 'cite'), pal, { indent: { left: 360 } }))
        break
      }
      case 'list': {
        const st = styleOf(ctx.board, b.style ?? 'list')
        const ref = b.ordered ? `num${++ctx.lists}` : 'bullet'
        if (b.ordered) ctx.numbered.push(ref)
        for (const item of b.items) out.push(para(item, st, pal, { numbering: { reference: ref, level: 0 }, indent: undefined }))
        break
      }
      case 'callout': {
        const bs = boxStyleOf(ctx.board, b.style ?? 'callout')
        const inner = await blocksOf(b.blocks, ctx, width - bs.pad[1] - bs.pad[3])
        out.push(new Table({
          width: { size: Math.round(width * TW), type: WidthType.DXA },
          columnWidths: [Math.round(width * TW)],
          rows: [new TableRow({ children: [new TableCell({
            children: inner.length ? (inner as Paragraph[]) : [new Paragraph('')],
            margins: { top: Math.round(bs.pad[0] * TW), right: Math.round(bs.pad[1] * TW), bottom: Math.round(bs.pad[2] * TW), left: Math.round(bs.pad[3] * TW) },
            ...(bs.bg ? { shading: { type: ShadingType.CLEAR, fill: hex(bs.bg), color: 'auto' } } : {}),
            borders: bs.border ? undefined : { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: bs.bar ? { style: BorderStyle.SINGLE, size: Math.round(bs.bar.w * 8), color: hex(bs.bar.colour) ?? '000000' } : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }
          })] })]
        }))
        out.push(new Paragraph({ spacing: { after: 0 }, children: [] }))
        break
      }
      case 'table':
        out.push(tableOf(b.rows, b.header, !!b.footer, ctx.board, b.style, width))
        out.push(new Paragraph({ children: [] }))
        break
      case 'chart':
        if (b.title) out.push(para([{ text: b.title }], styleOf(ctx.board, 'caption'), pal, { keepNext: true }))
        out.push(tableOf(b.rows, true, false, ctx.board, undefined, width))
        if (b.caption) out.push(para([{ text: b.caption }], styleOf(ctx.board, 'caption'), pal))
        break
      case 'picture': {
        const bytes = ctx.media.get(b.src)
        const type = imageType(b.src)
        if (bytes && type) {
          const w = width * (b.width ?? 1)
          const h = w / (ctx.aspect?.(b.src) ?? 1.5)
          out.push(new Paragraph({ children: [new ImageRun({ type, data: bytes, transformation: { width: w * PX, height: h * PX }, altText: { name: b.alt || b.src, description: b.alt, title: b.alt } } as never)] }))
        }
        if (b.caption) out.push(para([{ text: b.caption }], styleOf(ctx.board, 'caption'), pal))
        break
      }
      case 'art':
        if (b.caption) out.push(para([{ text: b.caption }], styleOf(ctx.board, 'caption'), pal))
        break
      case 'divider':
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 4 } }, spacing: { before: 120, after: 120 } }))
        break
      case 'columns': {
        const ws = b.widths ?? b.columns.map(() => 1 / b.columns.length)
        const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
        const cells = await Promise.all(b.columns.map(async (col, i) => new TableCell({
          width: { size: Math.round(ws[i] * width * TW), type: WidthType.DXA },
          margins: { left: i ? 120 : 0, right: i < b.columns.length - 1 ? 120 : 0 },
          children: ((await blocksOf(col, ctx, ws[i] * width - 12)) as Paragraph[]).concat(col.length ? [] : [new Paragraph('')])
        })))
        out.push(new Table({ width: { size: Math.round(width * TW), type: WidthType.DXA }, columnWidths: ws.map((w) => Math.round(w * width * TW)), borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }, rows: [new TableRow({ children: cells })] }))
        break
      }
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
    }
  }
  return out
}

const imageType = (src: string): 'png' | 'jpg' | 'gif' | 'bmp' | null => {
  const ext = src.slice(src.lastIndexOf('.') + 1).toLowerCase()
  return ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'gif' ? 'gif' : null
}

interface Ctx {
  board: DocBoard | undefined
  media: Map<string, Uint8Array>
  aspect?: (src: string) => number | undefined
  lists: number
  numbered: string[]
}

/** A fixed page's text boxes as frames at their places. */
function frames(d: DocDesign, s: Section, board: DocBoard | undefined): Paragraph[] {
  const values = d.calcs ? boxValues(d, s) : {}
  return d.texts.flatMap((t) => {
    const text = values[t.name] ?? s.texts[t.name] ?? ''
    if (!text.trim() || d.auto?.[t.name]) return []
    const st: TextStyle = { font: t.font, size: t.size, weight: t.weight, italic: t.italic, colour: t.colour, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, transform: t.transform as TextStyle['transform'], align: t.align as TextStyle['align'], before: 0, after: 0 }
    const p = para([{ text }], st, board?.palette ?? {}, {
      frame: {
        type: 'absolute',
        position: { x: Math.round(t.x * TW), y: Math.round(t.y * TW) },
        width: Math.round(t.w * TW),
        // At least the box's height: where Word sets the text wider, the frame grows rather than cutting it off.
        height: Math.round(t.h * TW),
        rule: HeightRule.ATLEAST,
        anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE }
      }
    })
    return [p]
  })
}

export async function docToDocx({ doc, board, media, art, aspect, title }: DocxInput): Promise<Uint8Array> {
  const ctx: Ctx = { board, media, aspect, lists: 0, numbered: [] }
  const body = styleOf(board, 'body')
  const sections = []
  for (const s of doc.sections) {
    const d = findDocDesign(board, s.design)
    const flow = d?.flow ?? { x: 56, y: 56, w: PAGE_W - 112, h: PAGE_H - 112 }
    const children: FileChild[] = []
    // The art sits in the page header, behind the text, so it repeats on every page the section fills.
    const pngs = await art(s)
    const behind = (png: Uint8Array) => new Header({ children: [new Paragraph({ children: [new ImageRun({
      type: 'png', data: png, transformation: { width: PAGE_W * PX, height: PAGE_H * PX },
      floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true },
      altText: { name: 'Page art', description: '', title: '' }
    } as never)] })] })
    const rest = pngs.rest === undefined ? pngs.first : pngs.rest
    const headers = pngs.first || rest ? { first: pngs.first ? behind(pngs.first) : new Header({ children: [] }), default: rest ? behind(rest) : new Header({ children: [] }) } : undefined
    if (d) children.push(...frames(d, s, board))
    if (d) {
      for (const region of d.tables) {
        const rows = computeRows(region, s.tables[region.name] ?? [])
        if (rows.length || region.header) children.push(tableOf(region.header ? [region.header, ...rows] : rows, !!region.header, false, board, undefined, region.w, { x: region.x, y: region.y }))
      }
    }
    if (s.blocks) children.push(...(await blocksOf(s.blocks, ctx, flow.w)))
    if (!children.length) children.push(new Paragraph(''))
    sections.push({
      ...(headers ? { headers } : {}),
      properties: {
        titlePage: !!headers,
        page: {
          size: { width: Math.round(PAGE_W * TW), height: Math.round(PAGE_H * TW) },
          margin: { top: Math.round(flow.y * TW), left: Math.round(flow.x * TW), right: Math.round((PAGE_W - flow.x - flow.w) * TW), bottom: Math.round((PAGE_H - flow.y - flow.h) * TW) }
        }
      },
      children
    })
  }
  const h = (n: 1 | 2 | 3) => {
    const st = styleOf(board, `h${n}`)
    return { run: { font: st.font, size: Math.round(st.size * 2), bold: st.weight >= 600, italics: st.italic, color: hex(st.colour) } }
  }
  const file = new Document({
    creator: 'Glance',
    title: title ?? '',
    styles: {
      default: {
        document: { run: { font: body.font, size: Math.round(body.size * 2), color: hex(body.colour) } },
        heading1: h(1),
        heading2: h(2),
        heading3: h(3)
      }
    },
    numbering: {
      config: [
        { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
        ...ctx.numbered.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] }))
      ]
    },
    sections
  })
  return new Uint8Array(await Packer.toArrayBuffer(file))
}
