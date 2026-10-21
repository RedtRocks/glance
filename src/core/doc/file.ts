/**
 * The .gdoc file (ADR 0018): a zip with document.json and the pictures under media/.
 * A document may come from anyone, so reading checks every section and block and keeps
 * what it can: a bad block costs that block, not the whole document.
 */
import JSZip from 'jszip'
import { DOC_VERSION, allBlocks, type Block, type Doc, type Section } from './model'
import { DOC_DESIGN_ID, findDocDesign, type DocBoard } from './look'
import { DocError, applyDocOps } from './ops'

export const DOC_EXTENSION = 'gdoc'
const DOC_JSON = 'document.json'

export interface DocFile {
  doc: Doc
  /** media/… path to the file's bytes. */
  media: Map<string, Uint8Array>
}

export interface DocReadResult extends DocFile {
  warnings: string[]
}

export async function writeDoc({ doc, media }: DocFile): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(DOC_JSON, JSON.stringify(doc, null, 1))
  const used = usedDocMedia(doc)
  for (const [path, bytes] of media) if (used.has(path)) zip.file(path, bytes, { compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.glance.document+zip' })
}

/** Reads a .gdoc. `loadLook` loads the look it names (the app's template boards). */
export async function readDoc(bytes: Uint8Array, loadLook?: (id: string) => Promise<DocBoard | undefined>): Promise<DocReadResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new DocError('not a Glance document (not a zip file)')
  }
  const entry = zip.file(DOC_JSON)
  if (!entry) throw new DocError(`not a Glance document (no ${DOC_JSON})`)
  let raw: unknown
  try {
    raw = JSON.parse(await entry.async('string'))
  } catch {
    throw new DocError(`${DOC_JSON} is not valid JSON`)
  }
  const look = typeof (raw as { look?: unknown })?.look === 'string' ? (raw as { look: string }).look : ''
  const board = loadLook && look ? await loadLook(look) : undefined
  const { doc, warnings } = parseDoc(raw, board)
  const media = new Map<string, Uint8Array>()
  for (const path of usedDocMedia(doc)) {
    const file = zip.file(path)
    if (file) media.set(path, await file.async('uint8array'))
    else warnings.push(`The picture ${path} is missing from the file.`)
  }
  return { doc, media, warnings }
}

/**
 * Checks a document.json that came from outside. Every block is put through the same
 * checks as an AI app's addBlocks, one at a time, so a bad one is left out with a reason.
 */
export function parseDoc(raw: unknown, board: DocBoard | undefined): { doc: Doc; warnings: string[] } {
  const warnings: string[] = []
  const obj = (raw ?? {}) as { version?: unknown; look?: unknown; sections?: unknown }
  if (typeof obj !== 'object' || !Array.isArray(obj.sections)) throw new DocError('not a Glance document (no sections list)')
  if (typeof obj.version === 'number' && obj.version > DOC_VERSION) warnings.push('This document was made by a newer Glance; some of it may not show.')
  const look = typeof obj.look === 'string' && /^[A-Za-z][\w-]{0,40}$/.test(obj.look) ? obj.look : board?.id ?? 'essay'
  if (!board) warnings.push(`This Glance doesn't have the look ${look}; the text shows plainly.`)
  const looks = (id: string) => (id === look ? board : undefined)
  const seen = new Set<string>()
  let doc: Doc = { version: DOC_VERSION, look, sections: [] }
  obj.sections.forEach((x: unknown, i: number) => {
    const s = (x ?? {}) as Partial<Record<keyof Section, unknown>>
    if (typeof s.design !== 'string' || !DOC_DESIGN_ID.test(s.design)) {
      warnings.push(`Section ${i + 1} names no design and was left out.`)
      return
    }
    let id = typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : ''
    if (!id || seen.has(id)) {
      let n = seen.size + 1
      while (seen.has(`p${n}`)) n++
      id = `p${n}`
    }
    seen.add(id)
    const texts: Record<string, string> = {}
    for (const [k, v] of Object.entries((s.texts ?? {}) as Record<string, unknown>)) if (/^[\w-]{1,40}$/.test(k) && typeof v === 'string') texts[k] = v
    const tables: Record<string, string[][]> = {}
    for (const [k, v] of Object.entries((s.tables ?? {}) as Record<string, unknown>)) {
      if (/^[\w-]{1,40}$/.test(k) && Array.isArray(v)) tables[k] = v.filter(Array.isArray).map((r: unknown[]) => r.map((c) => (typeof c === 'string' ? c : String(c ?? ''))))
    }
    const d = findDocDesign(board, s.design)
    const section: Section = { id, design: s.design, texts, tables }
    if (Array.isArray(s.blocks) || d?.flow) section.blocks = []
    doc.sections.push(section)
    if (!Array.isArray(s.blocks)) return
    for (const [n, b] of (s.blocks as unknown[]).entries()) {
      try {
        doc = applyDocOps(doc, [{ op: 'addBlocks', section: id, blocks: [b] }], looks).doc
        // Keep the file's own id when it is sound and unused.
        const added = doc.sections.find((z) => z.id === id)!.blocks!.at(-1)!
        keepIds(added, b, new Set([...allBlocks(doc)].map((z) => z.block.id)))
      } catch (e) {
        if (!(e instanceof DocError)) throw e
        warnings.push(`Section ${i + 1}, block ${n + 1}: left out (${e.message.replace(/^Operation 1 \(addBlocks\): /, '')}).`)
      }
    }
  })
  return { doc, warnings }
}

/** Gives a checked block (and the blocks inside it) back the ids the file had, where sound and unused. */
function keepIds(b: Block, raw: unknown, used: Set<string>) {
  const want = (raw as { id?: unknown })?.id
  if (typeof want === 'string' && /^[\w-]{1,40}$/.test(want) && !used.has(want)) {
    used.delete(b.id)
    b.id = want
    used.add(want)
  }
  const r = raw as { blocks?: unknown[]; columns?: unknown[][] }
  if (b.type === 'callout' && Array.isArray(r.blocks)) b.blocks.forEach((x, i) => keepIds(x, r.blocks![i], used))
  if (b.type === 'columns' && Array.isArray(r.columns)) b.columns.forEach((c, i) => c.forEach((x, j) => Array.isArray(r.columns![i]) && keepIds(x, r.columns![i][j], used)))
}

export function usedDocMedia(doc: Doc): Set<string> {
  const used = new Set<string>()
  for (const { block } of allBlocks(doc)) if (block.type === 'picture') used.add(block.src)
  return used
}
