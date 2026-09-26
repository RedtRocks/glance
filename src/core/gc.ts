/**
 * Drops every object no longer reachable from the document trailer.
 *
 * pdf-lib writes *all* objects it holds, including orphans (a replaced page's old
 * content, deleted annotations, previous incremental revisions). For privacy
 * operations that would leave the very data the user removed inside the file, so
 * every save that removes information runs this first (ADR 0005, ADR 0008).
 */
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib'

export function collectGarbage(doc: PDFDocument): number {
  const ctx = doc.context
  const reachable = new Set<string>()
  const t = ctx.trailerInfo
  const stack: (PDFObject | undefined)[] = [t.Root, t.Info, t.Encrypt, t.ID]
  while (stack.length) {
    const obj = stack.pop()
    if (!obj) continue
    if (obj instanceof PDFRef) {
      if (reachable.has(obj.tag)) continue
      reachable.add(obj.tag)
      stack.push(ctx.lookup(obj))
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v)
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i))
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict)
    }
  }
  let removed = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) {
      ctx.delete(ref)
      removed++
    }
  }
  return removed
}
