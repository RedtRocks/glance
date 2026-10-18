/**
 * The .gdeck file (ADR 0018): a zip with deck.json and the pictures under media/.
 * A deck may come from anyone, so reading checks every slide and keeps what it can:
 * a bad slot or a missing picture costs that slot, not the whole deck.
 */
import JSZip from 'jszip'
import { DECK_VERSION, isLayout, type Deck, type Slide } from './model'
import { DeckError, slotValue } from './ops'

export const DECK_EXTENSION = 'gdeck'
const DECK_JSON = 'deck.json'
export interface DeckFile {
  deck: Deck
  /** media/… path to the file's bytes. */
  media: Map<string, Uint8Array>
}

export interface ReadResult extends DeckFile {
  /** What was left out, in words the person (or an AI app) can act on. */
  warnings: string[]
}

export async function writeDeck({ deck, media }: DeckFile): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(DECK_JSON, JSON.stringify(deck, null, 1))
  // Only pictures a slide uses are kept, so deleting a slide also drops its pictures.
  const used = usedMedia(deck)
  for (const [path, bytes] of media) if (used.has(path)) zip.file(path, bytes, { compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.glance.deck+zip' })
}

export async function readDeck(bytes: Uint8Array): Promise<ReadResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new DeckError('not a Glance deck (not a zip file)')
  }
  const entry = zip.file(DECK_JSON)
  if (!entry) throw new DeckError(`not a Glance deck (no ${DECK_JSON})`)
  let raw: unknown
  try {
    raw = JSON.parse(await entry.async('string'))
  } catch {
    throw new DeckError(`${DECK_JSON} is not valid JSON`)
  }
  const { deck, warnings } = parseDeck(raw)
  const media = new Map<string, Uint8Array>()
  for (const path of usedMedia(deck)) {
    const file = zip.file(path)
    if (file) media.set(path, await file.async('uint8array'))
    else warnings.push(`The picture ${path} is missing from the file.`)
  }
  return { deck, media, warnings }
}

/** Checks a deck.json that came from outside, keeping every slide and slot that is sound. */
export function parseDeck(raw: unknown): { deck: Deck; warnings: string[] } {
  const warnings: string[] = []
  const obj = (raw ?? {}) as { version?: unknown; theme?: unknown; slides?: unknown }
  if (typeof obj !== 'object' || !Array.isArray(obj.slides)) throw new DeckError('not a Glance deck (no slides list)')
  const version = typeof obj.version === 'number' ? obj.version : DECK_VERSION
  if (version > DECK_VERSION) warnings.push('This deck was made by a newer Glance; some of it may not show.')
  const seen = new Set<string>()
  const slides: Slide[] = []
  obj.slides.forEach((s: unknown, i: number) => {
    const raw = (s ?? {}) as Partial<Record<keyof Slide, unknown>>
    if (typeof raw.layout !== 'string' || !isLayout(raw.layout)) {
      warnings.push(`Slide ${i + 1} has a layout this Glance doesn't know (${String(raw.layout)}) and was left out.`)
      return
    }
    let id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : ''
    if (!id || seen.has(id)) id = freshId(seen)
    seen.add(id)
    const slide: Slide = { id, layout: raw.layout, slots: {}, notes: typeof raw.notes === 'string' ? raw.notes : '', hidden: raw.hidden === true }
    for (const [name, value] of Object.entries((raw.slots ?? {}) as Record<string, unknown>)) {
      // Slots are saved as { kind, value }; unwrap them so slotValue checks the value.
      const inner = value && typeof value === 'object' && 'value' in value ? (value as { value: unknown }).value : value
      try {
        slide.slots[name] = slotValue(slide.layout, name, inner)
      } catch (e) {
        if (!(e instanceof DeckError)) throw e
        warnings.push(`Slide ${i + 1}: left out ${name} (${e.message}).`)
      }
    }
    slides.push(slide)
  })
  return { deck: { version: DECK_VERSION, theme: typeof obj.theme === 'string' && obj.theme ? obj.theme : 'wollo', slides }, warnings }
}

export function usedMedia(deck: Deck): Set<string> {
  const used = new Set<string>()
  for (const slide of deck.slides) for (const v of Object.values(slide.slots)) if (v.kind === 'image') used.add(v.value.src)
  return used
}

function freshId(seen: Set<string>): string {
  let n = seen.size + 1
  while (seen.has(`s${n}`)) n++
  return `s${n}`
}
