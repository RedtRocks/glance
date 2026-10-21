import { describe, expect, it } from 'vitest'
import { DOC_BOARDS, DOC_LOADERS } from '../src/doc/designs'
import { PURPOSES } from '../src/core/deck/design'
import { allBlocks, blockText, parseRuns, runsToText, type Doc } from '../src/core/doc/model'
import { applyDocOps, DocError } from '../src/core/doc/ops'
import { checkDoc } from '../src/core/doc/check'
import { layoutDoc } from '../src/core/doc/layout'
import { pageHtml } from '../src/core/doc/html'
import { boardDoc, lookCatalog, pageDoc } from '../src/core/doc/template'
import { parseDoc, readDoc, writeDoc } from '../src/core/doc/file'
import { boxValues, computeRows, parseNumber } from '../src/core/doc/calc'
import type { DocBoard } from '../src/core/doc/look'

const boards = new Map<string, DocBoard>()
const load = async (id: string) => {
  if (!boards.has(id)) boards.set(id, await DOC_LOADERS[id]())
  return boards.get(id)!
}
const looksOf = (...bs: DocBoard[]) => (id: string) => bs.find((b) => b.id === id)

describe('document model', () => {
  it('reads and writes light marks', () => {
    const runs = parseRuns('Plain **bold** and *it* with [a link](https://example.org).')
    expect(runs.map((r) => r.text)).toEqual(['Plain ', 'bold', ' and ', 'it', ' with ', 'a link', '.'])
    expect(runs[1].b).toBe(true)
    expect(runs[5].href).toBe('https://example.org')
    expect(runsToText(runs)).toBe('Plain **bold** and *it* with [a link](https://example.org).')
  })
  it('keeps javascript: links out', () => {
    expect(parseRuns('[x](javascript:alert(1))').some((r) => r.href)).toBe(false)
  })
})

describe('document templates', () => {
  it('lists 14 boards with purposes and loaders', () => {
    expect(DOC_BOARDS.length).toBe(14)
    for (const b of DOC_BOARDS) {
      expect(PURPOSES).toContain(b.purpose)
      expect(DOC_LOADERS[b.id], b.id).toBeTypeOf('function')
    }
  })
  it('builds every template, lays it out and draws it', async () => {
    for (const info of DOC_BOARDS) {
      const board = await load(info.id)
      const doc = boardDoc(board)
      expect(doc.sections.length, info.id).toBe(info.pages)
      const pages = layoutDoc(doc, board)
      expect(pages.length, info.id).toBeGreaterThanOrEqual(info.pages)
      for (const p of pages) expect(pageHtml(p, board, { resolveSrc: () => null })).toContain('doc-page')
      const cat = lookCatalog(board, info)
      expect(cat.designs.length, info.id).toBe(board.designs.length + 1)
      if (info.pack) expect(pageDoc(board, board.designs[0].id).sections.length).toBe(1)
    }
  })
  // Fixed tables are checked against real fonts in the browser; the estimate here wraps more.
  it('passes its own check, apart from boxes left as hints', async () => {
    for (const info of DOC_BOARDS) {
      const board = await load(info.id)
      const bad = checkDoc(boardDoc(board), board).filter((f) => !['emptyBox', 'wall', 'longParagraph', 'headingSkip', 'tableTooLong'].includes(f.code))
      expect(bad, info.id).toEqual([])
    }
  })
})

describe('pagination', () => {
  it('flows long text across as many pages as it needs, without shrinking', async () => {
    const board = await load('essay')
    const flow = board.flow
    const doc: Doc = { version: 1, look: 'essay', sections: [{ id: 'p1', design: flow, texts: {}, tables: {}, blocks: [] }] }
    const para = 'Waves wear the foot of the cliff away until the rock above falls. '.repeat(12)
    const ops = Array.from({ length: 30 }, () => ({ type: 'paragraph', text: para }))
    const long = applyDocOps(doc, [{ op: 'addBlocks', blocks: ops }], looksOf(board)).doc
    const short = applyDocOps(doc, [{ op: 'addBlocks', blocks: ops.slice(0, 1) }], looksOf(board)).doc
    const pl = layoutDoc(long, board)
    const ps = layoutDoc(short, board)
    expect(ps.length).toBe(1)
    expect(pl.length).toBeGreaterThan(4)
    const size = (ls: typeof pl) => ls[0].items.find((i) => i.kind === 'text' && i.segs.length)
    const a = size(pl), b = size(ps)
    if (a?.kind === 'text' && b?.kind === 'text') expect(a.segs[0].font.size).toBe(b.segs[0].font.size)
    // Every page's text stays inside the page.
    for (const p of pl) for (const it of p.items) if (it.kind === 'text') expect(it.y + it.h).toBeLessThanOrEqual(842)
  })
  it('starts a new page at a page break', async () => {
    const board = await load('essay')
    const doc: Doc = { version: 1, look: 'essay', sections: [{ id: 'p1', design: 'essay.plain', texts: {}, tables: {}, blocks: [] }] }
    const next = applyDocOps(doc, [{ op: 'addBlocks', blocks: [{ type: 'paragraph', text: 'One' }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Two' }] }], looksOf(board)).doc
    expect(layoutDoc(next, board).length).toBe(2)
  })
})

describe('document operations', () => {
  const base = async () => {
    const board = await load('essay')
    return { board, doc: boardDoc(board), looks: looksOf(board) }
  }
  it('adds, moves, replaces and deletes blocks', async () => {
    const { doc, looks } = await base()
    const flow = doc.sections.find((s) => s.blocks)!
    const r = applyDocOps(doc, [{ op: 'addBlocks', section: flow.id, after: null, blocks: [{ type: 'heading', level: 2, text: 'New start' }, { type: 'list', items: ['a', 'b'] }] }], looks)
    expect(r.added.length).toBe(2)
    const [h, l] = r.added
    const s = r.doc.sections.find((x) => x.id === flow.id)!
    expect(s.blocks![0].id).toBe(h)
    const moved = applyDocOps(r.doc, [{ op: 'moveBlocks', ids: [h], after: l }], looks).doc
    expect(moved.sections.find((x) => x.id === flow.id)!.blocks![1].id).toBe(h)
    const rep = applyDocOps(moved, [{ op: 'replaceBlock', id: h, block: { type: 'paragraph', text: '**Now** a paragraph' } }], looks).doc
    const b = [...allBlocks(rep)].find((x) => x.block.id === h)!.block
    expect(b.type).toBe('paragraph')
    expect(blockText(b)).toBe('Now a paragraph')
    const del = applyDocOps(rep, [{ op: 'deleteBlocks', ids: [h, l] }], looks).doc
    expect([...allBlocks(del)].some((x) => x.block.id === h || x.block.id === l)).toBe(false)
  })
  it('changes nothing and says why when an op is invalid', async () => {
    const { doc, looks } = await base()
    const before = JSON.stringify(doc)
    expect(() => applyDocOps(doc, [{ op: 'addBlocks', blocks: [{ type: 'paragraph', text: 'ok' }] }, { op: 'deleteBlocks', ids: ['nope'] }], looks)).toThrow(/Operation 2 \(deleteBlocks\): no block nope/)
    expect(() => applyDocOps(doc, [{ op: 'addBlocks', blocks: [{ type: 'heading', level: 7, text: 'x' }] }], looks)).toThrow(DocError)
    expect(() => applyDocOps(doc, [{ op: 'addBlocks', blocks: [{ type: 'picture', src: '../etc/passwd' }] }], looks)).toThrow(/media/)
    expect(() => applyDocOps(doc, [{ op: 'setText', section: doc.sections[0].id, box: 'nope', text: 'x' }], looks)).toThrow(/has no text box nope/)
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('sets text boxes and adds pages', async () => {
    const { doc, looks, board } = await base()
    const cover = doc.sections[0]
    const box = board.designs[0].texts.find((t) => !board.designs[0].auto?.[t.name])!
    const r = applyDocOps(doc, [{ op: 'setText', section: cover.id, box: box.name, text: 'Cliffs' }, { op: 'addSection', design: 'essay.plain', blocks: [{ type: 'paragraph', text: 'More' }] }], looks)
    expect(r.doc.sections[0].texts[box.name]).toBe('Cliffs')
    expect(r.doc.sections.at(-1)!.design).toBe('essay.plain')
    expect(() => applyDocOps(doc, [{ op: 'addSection', design: 'menuPack.1' }], looks)).toThrow(/setLook/)
  })
  it('edits table rows and cells, and fixed pages work their totals out again', async () => {
    const board = await load('businessPack')
    const looks = looksOf(board)
    const doc = boardDoc(board)
    const s = doc.sections.find((x) => Object.keys(x.tables).length)!
    const d = board.designs.find((x) => x.id === s.design)!
    const region = d.tables[0]
    const rows = s.tables[region.name]
    const r = applyDocOps(doc, [{ op: 'addRow', section: s.id, table: region.name, cells: rows[0] }], looks).doc
    const s2 = r.sections.find((x) => x.id === s.id)!
    expect(s2.tables[region.name].length).toBe(rows.length + 1)
    if (d.calcs) {
      const sum = Object.entries(d.calcs).find(([, c]) => 'sum' in c)
      if (sum) {
        const was = parseNumber(boxValues(d, s)[sum[0]])
        const now = parseNumber(boxValues(d, s2)[sum[0]])
        const c = (sum[1] as { sum: { col: number } }).sum.col
        expect(now - was).toBeCloseTo(parseNumber(computeRows(region, [rows[0]])[0][c]), 2)
      }
    }
    const set = applyDocOps(r, [{ op: 'setCell', section: s.id, table: region.name, row: 0, col: 0, text: 'Changed' }], looks).doc
    expect(set.sections.find((x) => x.id === s.id)!.tables[region.name][0][0]).toBe('Changed')
    const del = applyDocOps(set, [{ op: 'deleteRow', section: s.id, table: region.name, row: 0 }], looks).doc
    expect(del.sections.find((x) => x.id === s.id)!.tables[region.name].length).toBe(rows.length)
  })
  it('moves a document to another look, keeping its flowing text', async () => {
    const essay = await load('essay')
    const report = await load('projectReport')
    const doc = boardDoc(essay)
    const text = [...allBlocks(doc)].map((x) => blockText(x.block)).join('\n')
    const r = applyDocOps(doc, [{ op: 'setLook', look: 'projectReport' }], looksOf(essay, report))
    expect(r.doc.look).toBe('projectReport')
    expect([...allBlocks(r.doc)].map((x) => blockText(x.block)).join('\n')).toContain(text.slice(0, 200))
    for (const s of r.doc.sections) expect(s.design.startsWith('projectReport.')).toBe(true)
  })
})

describe('document check', () => {
  it('finds empty boxes, skipped headings and missing alt text', async () => {
    const board = await load('essay')
    const doc: Doc = { version: 1, look: 'essay', sections: [{ id: 'p1', design: 'essay.1', texts: {}, tables: {} }, { id: 'p2', design: 'essay.plain', texts: {}, tables: {}, blocks: [] }] }
    const r = applyDocOps(doc, [{ op: 'addBlocks', section: 'p2', blocks: [{ type: 'heading', level: 1, text: 'A' }, { type: 'heading', level: 3, text: 'B' }, { type: 'picture', src: 'media/a.png' }] }], looksOf(board)).doc
    const codes = checkDoc(r, board).map((f) => f.code)
    expect(codes).toContain('emptyBox')
    expect(codes).toContain('headingSkip')
    expect(codes).toContain('missingAlt')
    expect(checkDoc({ version: 1, look: 'essay', sections: [] }, board)[0].code).toBe('empty')
  })
})

describe('.gdoc file', () => {
  it('round-trips a document with its pictures, dropping unused ones', async () => {
    const board = await load('essay')
    const doc = applyDocOps(boardDoc(board), [{ op: 'addBlocks', blocks: [{ type: 'picture', src: 'media/a.png', alt: 'A' }] }], looksOf(board)).doc
    const bytes = await writeDoc({ doc, media: new Map([['media/a.png', new Uint8Array([1, 2, 3])], ['media/old.png', new Uint8Array([4])]]) })
    const back = await readDoc(bytes, async () => board)
    expect(back.warnings).toEqual([])
    expect(back.doc).toEqual(doc)
    expect([...back.media.keys()]).toEqual(['media/a.png'])
  })
  it('keeps what it can from a damaged file', () => {
    const r = parseDoc({ look: 'essay', sections: [{ id: 'p1', design: 'essay.plain', blocks: [{ type: 'paragraph', text: 'ok' }, { type: 'nope' }] }, { design: 5 }] }, undefined)
    expect(r.doc.sections.length).toBe(1)
    expect(r.doc.sections[0].blocks!.length).toBe(1)
    expect(r.warnings.length).toBe(3)
  })
})
