/**
 * The document check (glance_doc_check): what an AI app has to fix before the person
 * sees the document. Each finding names the section, block or box and says what to do,
 * in words a model can act on.
 */
import { allBlocks, blockText, plain, type Doc } from './model'
import { findDocDesign, type DocBoard } from './look'
import { estimate, layoutDoc, type Measure } from './layout'

export type DocFindingCode =
  | 'empty' | 'unknownLook' | 'unknownDesign' | 'emptyBox' | 'tooLong' | 'tableTooLong'
  | 'emptyBlock' | 'headingSkip' | 'missingAlt' | 'raggedTable' | 'longParagraph' | 'wall'

export interface DocFinding {
  code: DocFindingCode
  section?: string
  block?: string
  box?: string
  detail: string
}

/** Past this many words a paragraph reads as a wall; split it. */
const LONG_PARAGRAPH = 220
/** This many paragraphs in a row without a heading, list or picture reads as a wall too. */
const WALL = 9

export function checkDoc(doc: Doc, board: DocBoard | undefined, measure: Measure = estimate): DocFinding[] {
  if (!doc.sections.length) return [{ code: 'empty', detail: 'The document has no pages. Add one with addSection.' }]
  if (!board) return [{ code: 'unknownLook', detail: `This Glance doesn't have the look ${doc.look}. Pick one from glance_templates with setLook.` }]
  const out: DocFinding[] = []
  for (const s of doc.sections) {
    const d = findDocDesign(board, s.design)
    if (!d) {
      out.push({ code: 'unknownDesign', section: s.id, detail: `Section ${s.id} uses design ${s.design}, which doesn't exist. Delete it and add a design from glance_templates.` })
      continue
    }
    for (const t of d.texts) {
      if (d.auto?.[t.name] || d.calcs?.[t.name]) continue
      const text = s.texts[t.name] ?? ''
      // A flowing section's later boxes (running headers) may stay empty; a fixed page's may not.
      if (!text.trim() && !d.flow) out.push({ code: 'emptyBox', section: s.id, box: t.name, detail: `Fill ${t.name} on ${s.id} (it shows "${t.sample.slice(0, 60)}" as a hint), or delete the page.` })
      else if (text.length > t.maxChars) out.push({ code: 'tooLong', section: s.id, box: t.name, detail: `${t.name} on ${s.id} has ${text.length} characters; it fits ${t.maxChars}. Shorten it.` })
    }
    if (!s.blocks) continue
    let run = 0
    let level = 0
    for (const { block: b } of allBlocks({ ...doc, sections: [s] })) {
      const at = { section: s.id, block: b.id }
      if (b.type === 'heading') {
        if (b.level > level + 1 && level > 0) out.push({ ...at, code: 'headingSkip', detail: `Heading ${b.id} is level ${b.level} after a level ${level}; use level ${level + 1}.` })
        level = b.level
      }
      const text = blockText(b).trim()
      if (['heading', 'paragraph', 'quote', 'list'].includes(b.type) && !text) out.push({ ...at, code: 'emptyBlock', detail: `Block ${b.id} is empty. Write it or delete it.` })
      if (b.type === 'paragraph') {
        const words = plain(b.runs).split(/\s+/).filter(Boolean).length
        if (words > LONG_PARAGRAPH) out.push({ ...at, code: 'longParagraph', detail: `Paragraph ${b.id} has ${words} words. Split it into paragraphs of under ${LONG_PARAGRAPH}.` })
        if (++run === WALL) out.push({ ...at, code: 'wall', detail: `${WALL} paragraphs in a row up to ${b.id}. Break them up with a heading, a list, a callout or a picture.` })
      } else if (b.type !== 'divider') run = 0
      if (b.type === 'picture' && !b.alt.trim()) out.push({ ...at, code: 'missingAlt', detail: `Describe picture ${b.id} (alt) for people who can't see it.` })
      if ((b.type === 'table' || b.type === 'chart') && new Set(b.rows.map((r) => r.length)).size > 1) {
        out.push({ ...at, code: 'raggedTable', detail: `The rows of ${b.id} have different numbers of cells. Give every row ${Math.max(...b.rows.map((r) => r.length))}.` })
      }
    }
  }
  for (const page of layoutDoc(doc, board, { measure })) {
    for (const what of page.overflow) out.push({ code: 'tableTooLong', section: page.section, detail: `The ${what} on ${page.section} has more rows than the page fits. Remove rows or add another page for the rest.` })
  }
  return out
}
