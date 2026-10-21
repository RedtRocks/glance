import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument } from '@cantoo/pdf-lib'
import { DOC_LOADERS } from '../src/doc/designs'
import { boardDoc } from '../src/core/doc/template'
import { layoutDoc } from '../src/core/doc/layout'
import { applyDocOps } from '../src/core/doc/ops'
import { docToPdf } from '../src/doc/exportPdf'
import { docToDocx } from '../src/doc/exportDocx'

const font = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, `../src/styles/fonts/${name}.woff2`)))
const FILES: Record<string, string> = {
  'Urbanist|false': 'urbanist', 'Fraunces|false': 'fraunces', 'Fraunces|true': 'fraunces-italic', 'Bricolage Grotesque|false': 'bricolage-grotesque',
  'Space Grotesk|false': 'space-grotesk', 'Caveat|false': 'caveat', 'DM Serif Display|false': 'dm-serif-display', 'DM Serif Display|true': 'dm-serif-display-italic'
}
const fonts = {
  regular: font('urbanist'),
  file: async (family: string, italic: boolean) => {
    const name = FILES[`${family}|${italic}`] ?? FILES[`${family}|false`]
    return name ? { bytes: font(name), italic: italic && !!FILES[`${family}|true`] } : null
  }
}
// A 4 by 2 picture stands in for the art, which a browser draws (raster.ts).
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGElEQVR4nGNIFvqWLPTt/wmG/ycYGJA5AKOiDMma1gVAAAAAAElFTkSuQmCC', 'base64'))

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join('').replace(/\s+/g, ' '))
  }
  await doc.loadingTask.destroy()
  return pages
}

async function sample(id: string) {
  const board = await DOC_LOADERS[id]()
  const doc = applyDocOps(boardDoc(board), [{ op: 'addBlocks', blocks: [
    { type: 'heading', level: 2, text: 'Exported heading' },
    { type: 'list', ordered: true, items: ['First point', 'Second point'] },
    { type: 'table', rows: [['Name', 'Score'], ['Ada', '12']] },
    { type: 'paragraph', text: 'See [the site](https://example.org) for **more**.' }
  ] }], (x) => (x === board.id ? board : undefined)).doc
  return { board, doc }
}

describe('document to PDF', () => {
  it('draws every laid-out page on A4 with the text as real text', async () => {
    for (const id of ['essay', 'businessPack', 'labReport']) {
      const { board, doc } = await sample(id)
      const pages = layoutDoc(doc, board)
      const bytes = await docToPdf({ pages, art: async () => png, fonts, title: 'T' })
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount(), id).toBe(pages.length)
      expect(pdf.getPage(0).getSize()).toEqual({ width: 595, height: 842 })
      const text = (await pdfText(bytes)).join(' ')
      expect(text, id).toContain('Exported heading')
      expect(text, id).toContain('Second point')
    }
  }, 60000)
})

describe('document to Word', () => {
  it('writes real headings, lists, tables, frames and page art', async () => {
    const { board, doc } = await sample('businessPack')
    const bytes = await docToDocx({ doc, board, media: new Map(), art: async () => png, title: 'T' })
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Exported heading')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('<w:numPr>')
    expect(xml).toContain('w:framePr')
    expect(xml).toContain('behindDoc="1"')
    expect(xml).toMatch(/<w:hyperlink /)
    expect((xml.match(/<w:sectPr/g) ?? []).length).toBe(doc.sections.length)
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('Heading2')
  })
})
