/**
 * PowerPoint 97-2003 presentations (.ppt), read far enough to show each slide's
 * text in order: titles, bullets and text boxes. Pictures, shapes and layout are
 * left to PowerPoint. Format: [MS-PPT] inside a compound file ([MS-CFB], read with
 * @kenjiuno/msgreader's reader, already used for .msg).
 */
import { Reader } from '@kenjiuno/msgreader/lib/Reader'

export interface PptText {
  /** A title (or centred title) placeholder. */
  title: boolean
  paragraphs: string[]
}

export interface PptSlide {
  texts: PptText[]
}

export interface Presentation {
  /** Slide size in points. */
  width: number
  height: number
  slides: PptSlide[]
}

/** A readable reason the file can't be shown. */
export class PptError extends Error {}

interface Rec {
  type: number
  instance: number
  /** Body start and end in the stream. */
  start: number
  end: number
}

const T = {
  document: 0x03e8,
  documentAtom: 0x03e9,
  slide: 0x03ee,
  slideListWithText: 0x0ff0,
  slidePersistAtom: 0x03f3,
  textHeaderAtom: 0x0f9f,
  textCharsAtom: 0x0fa0,
  textBytesAtom: 0x0fa8,
  outlineTextRefAtom: 0x0f9e,
  userEditAtom: 0x0ff5,
  persistDirectoryAtom: 0x1772,
  cryptSession: 0x2f14
}

export function readPpt(bytes: Uint8Array): Presentation {
  const cfb = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  try {
    cfb.parse()
  } catch {
    throw new PptError('not-ppt')
  }
  const root = cfb.rootFolder()
  const s = root.readFile('PowerPoint Document')
  const user = root.readFile('Current User')
  if (!s || !user || user.length < 20) throw new PptError('not-ppt')
  const v = new DataView(s.buffer, s.byteOffset, s.byteLength)
  const header = (at: number): Rec | null => {
    if (at < 0 || at + 8 > s.length) return null
    const verInst = v.getUint16(at, true)
    const len = v.getUint32(at + 4, true)
    return { type: v.getUint16(at + 2, true), instance: verInst >> 4, start: at + 8, end: Math.min(at + 8 + len, s.length) }
  }
  const children = (r: Rec): Rec[] => {
    const out: Rec[] = []
    for (let at = r.start; at + 8 <= r.end; ) {
      const c = header(at)
      if (!c) break
      out.push(c)
      at = c.end
    }
    return out
  }

  // Newest edit first; each names its persist directory (object id → stream offset).
  const offsets = new Map<number, number>()
  let edit = header(new DataView(user.buffer, user.byteOffset, user.byteLength).getUint32(16, true))
  let docRef = 0
  for (let guard = 0; edit && edit.type === T.userEditAtom && guard < 1000; guard++) {
    if (edit.end - edit.start < 20) break
    if (!docRef) docRef = v.getUint32(edit.start + 16, true)
    if (edit.end - edit.start >= 32 && v.getUint32(edit.start + 28, true) !== 0) {
      // An encryption session key: the slides are encrypted.
      throw new PptError('encrypted')
    }
    const dir = header(v.getUint32(edit.start + 12, true))
    if (dir && dir.type === T.persistDirectoryAtom) {
      for (let at = dir.start; at + 4 <= dir.end; ) {
        const entry = v.getUint32(at, true)
        const first = entry & 0xfffff
        const count = entry >>> 20
        at += 4
        for (let k = 0; k < count && at + 4 <= dir.end; k++, at += 4) if (!offsets.has(first + k)) offsets.set(first + k, v.getUint32(at, true))
      }
    }
    const last = v.getUint32(edit.start + 8, true)
    edit = last ? header(last) : null
  }

  const doc = header(offsets.get(docRef) ?? -1)
  if (!doc || doc.type !== T.document) throw new PptError('not-ppt')
  const parts = children(doc)
  const docAtom = parts.find((r) => r.type === T.documentAtom)
  // Master units: 576 per inch.
  const width = docAtom ? (v.getInt32(docAtom.start, true) * 72) / 576 : 720
  const height = docAtom ? (v.getInt32(docAtom.start + 4, true) * 72) / 576 : 540

  const text = (r: Rec): string =>
    r.type === T.textCharsAtom
      ? new TextDecoder('utf-16le').decode(s.subarray(r.start, r.end))
      : new TextDecoder('windows-1252').decode(s.subarray(r.start, r.end))
  const toText = (type: number, raw: string): PptText => ({
    title: type === 0 || type === 6,
    paragraphs: raw.split('\r').map((p) => p.replace(/\x0b/g, '\n').replace(/[\x00-\x08\x0c\x0e-\x1f]/g, ''))
  })

  // The slide list: each slide's id, plus the placeholder text kept beside it.
  const list = parts.find((r) => r.type === T.slideListWithText && r.instance === 0)
  const slides: PptSlide[] = []
  let outline: PptText[] = []
  let current: number | null = null
  const finish = (): void => {
    if (current === null) return
    slides.push(slideFrom(current, outline))
    outline = []
  }
  const slideFrom = (persist: number, placeholders: PptText[]): PptSlide => {
    const rec = header(offsets.get(persist) ?? -1)
    if (!rec || rec.type !== T.slide) return { texts: placeholders }
    const texts: PptText[] = []
    // Text boxes in the slide's drawing, in order; a reference pulls in a placeholder's text.
    const walk = (r: Rec, depth: number): void => {
      let type = 4
      for (const c of children(r)) {
        if (c.type === T.textHeaderAtom) type = v.getUint32(c.start, true)
        else if (c.type === T.textCharsAtom || c.type === T.textBytesAtom) texts.push(toText(type, text(c)))
        else if (c.type === T.outlineTextRefAtom) {
          const p = placeholders[v.getInt32(c.start, true)]
          if (p) texts.push(p)
        } else if ((v.getUint16(c.start - 8, true) & 0xf) === 0xf && depth < 12) walk(c, depth + 1)
      }
    }
    walk(rec, 0)
    // Placeholders the drawing didn't reference (older writers): keep them too.
    for (const p of placeholders) if (!texts.includes(p)) texts.push(p)
    return { texts }
  }
  if (list) {
    let type = 4
    for (const r of children(list)) {
      if (r.type === T.slidePersistAtom) {
        finish()
        current = v.getUint32(r.start, true)
      } else if (r.type === T.textHeaderAtom) type = v.getUint32(r.start, true)
      else if (r.type === T.textCharsAtom || r.type === T.textBytesAtom) outline.push(toText(type, text(r)))
    }
    finish()
  }
  if (!slides.length) throw new PptError('empty')
  return { width: width > 0 ? width : 720, height: height > 0 ? height : 540, slides }
}
