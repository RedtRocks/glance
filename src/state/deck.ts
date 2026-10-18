/**
 * Opening, saving and creating decks (.gdeck, ADR 0018). The zip code loads only when a
 * deck is opened or saved, so it stays off the startup path.
 */
import * as platform from '../platform'
import { addDoc, DeckDoc } from './documents'
import * as versions from './versions'
import { toast, withBusy } from './ui'
import { msg, t } from '../i18n'
import type { Deck, LayoutId } from '../core/deck/model'
import { DeckError, type ApplyResult, type DeckOp } from '../core/deck/ops'

const deckFile = () => import('../core/deck/file')

export async function openDeck(probe: platform.Probe): Promise<DeckDoc> {
  const { readDeck } = await deckFile()
  const { deck, media, warnings } = await readDeck(await platform.readFile(probe.path))
  const doc = new DeckDoc(probe.name, probe.path)
  doc.deck.value = deck
  for (const [path, bytes] of media) doc.media.set(path, bytes)
  addDoc(doc)
  // Say what was left out once, in one toast; the details are what an AI app would need.
  if (warnings.length) toast(t('{count, plural, one {# part of this deck couldn’t be read and was left out.} other {# parts of this deck couldn’t be read and were left out.}}', { count: warnings.length }), 'error')
  return doc
}

/** A new, unsaved deck: from a starting deck (a template or an AI app's outline) or empty. */
export function newDeck(name = t('Untitled deck'), start?: Deck, media?: Map<string, Uint8Array>): DeckDoc {
  const doc = new DeckDoc(`${name}.gdeck`, null)
  if (start) doc.deck.value = start
  for (const [path, bytes] of media ?? []) doc.media.set(path, bytes)
  addDoc(doc)
  return doc
}

export async function deckBytes(doc: DeckDoc): Promise<Uint8Array> {
  const { writeDeck } = await deckFile()
  return writeDeck({ deck: doc.deck.peek(), media: doc.media })
}

export async function saveDeck(doc: DeckDoc, opts: { auto?: boolean } = {}): Promise<void> {
  const path = doc.path.peek()
  if (!path) return opts.auto ? undefined : saveDeckAs(doc)
  const disk = await versions.checkDisk(doc, path, !!opts.auto)
  if (disk === 'cancel') return
  if (disk === 'copy') return saveDeckAs(doc)
  await versions.beforeOverwrite(doc, path)
  const run = async () => {
    const bytes = await deckBytes(doc)
    await platform.writeFile(path, bytes)
    return bytes
  }
  const bytes = opts.auto ? await run() : await withBusy(t('Saving…'), run)
  doc.dirty.value = false
  await versions.rememberStamp(doc)
  await versions.afterWrite(path, opts.auto ? msg('Autosaved') : msg('Saved'), bytes)
  if (!opts.auto) toast(t('Saved'))
}

export async function saveDeckAs(doc: DeckDoc): Promise<void> {
  const base = doc.name.peek().replace(/\.[^.]+$/, '')
  const target = await platform.saveDialog(`${base}.gdeck`, [{ name: msg('Glance deck'), extensions: ['gdeck'] }])
  if (!target) return
  await versions.afterWrite(target, msg('Before replacing')).catch(() => undefined)
  const bytes = await withBusy(t('Saving…'), async () => {
    const b = await deckBytes(doc)
    await platform.writeFile(target, b)
    return b
  })
  const old = doc.path.peek()
  doc.path.value = target
  doc.name.value = platform.baseName(target)
  doc.dirty.value = false
  if (old) void platform.releaseFile(old)
  void platform.claimFile(target)
  await versions.rememberStamp(doc)
  await versions.afterWrite(target, msg('Saved'), bytes)
  toast(t('Saved'))
}

// ---------------------------------------------------------------------------
// Editing slides: the slide list, menus and shortcuts all come through here.

/** Applies `ops` as one undo step, saying why in a toast when they can't apply. */
export function change(doc: DeckDoc, label: string, ops: DeckOp[]): ApplyResult | null {
  try {
    return doc.apply(label, ops)
  } catch (e) {
    if (!(e instanceof DeckError)) throw e
    toast(t('Couldn’t change the deck: {error}', { error: e.message }), 'error')
    return null
  }
}

/** The slides an action applies to: the picked ones, or else the one on screen. */
export function targetIds(doc: DeckDoc): string[] {
  const slides = doc.deck.peek().slides
  const picked = doc.selection.peek().filter((id) => slides.some((s) => s.id === id))
  if (picked.length) return picked
  const current = slides[doc.current.peek()]
  return current ? [current.id] : []
}

const indexOf = (doc: DeckDoc, id: string) => doc.deck.peek().slides.findIndex((s) => s.id === id)

export function goToSlide(doc: DeckDoc, id: string): void {
  const i = indexOf(doc, id)
  if (i >= 0) doc.current.value = i
}

export function addSlide(doc: DeckDoc, layout: LayoutId = 'bullets'): void {
  const current = doc.deck.peek().slides[doc.current.peek()]
  const r = change(doc, msg('Add Slide'), [{ op: 'add', layout, after: current?.id }])
  if (r) {
    doc.selection.value = []
    goToSlide(doc, r.added[0])
  }
}

export function duplicateSlides(doc: DeckDoc): void {
  const ids = targetIds(doc)
  if (!ids.length) return
  const r = change(doc, msg('Duplicate Slide'), ids.map((id) => ({ op: 'duplicate', id })))
  if (r) {
    doc.selection.value = r.added
    goToSlide(doc, r.added[0])
  }
}

export function deleteSlides(doc: DeckDoc): void {
  const ids = targetIds(doc)
  if (!ids.length) return
  if (change(doc, msg('Delete Slide'), [{ op: 'delete', ids }])) doc.selection.value = []
}

export function toggleHidden(doc: DeckDoc): void {
  const ids = targetIds(doc)
  const slides = doc.deck.peek().slides
  const hide = ids.some((id) => !slides.find((s) => s.id === id)?.hidden)
  if (ids.length) change(doc, hide ? msg('Hide Slide') : msg('Show Slide'), [{ op: 'hide', ids, hidden: hide }])
}

/** Moves slides to just after `after` (null: to the start), keeping them picked and on screen. */
export function moveSlides(doc: DeckDoc, ids: string[], after: string | null): void {
  if (after !== null && ids.includes(after)) return
  if (change(doc, msg('Move Slide'), [{ op: 'move', ids, after }])) goToSlide(doc, ids[0])
}

/** One place up or down, as Alt+Up and Alt+Down do. */
export function nudgeSlides(doc: DeckDoc, dir: -1 | 1): void {
  const ids = targetIds(doc)
  const slides = doc.deck.peek().slides
  const at = ids.map((id) => indexOf(doc, id)).sort((a, b) => a - b)
  if (!at.length || (dir < 0 && at[0] === 0) || (dir > 0 && at.at(-1) === slides.length - 1)) return
  const rest = slides.filter((s) => !ids.includes(s.id))
  // The slide before the block, moved by one: up puts it after the one two back.
  const first = at[0] - (dir < 0 ? 1 : 0)
  const restBefore = slides.slice(0, first).filter((s) => !ids.includes(s.id)).length
  const anchor = dir < 0 ? restBefore - 1 : restBefore
  moveSlides(doc, ids, anchor < 0 ? null : rest[anchor].id)
}

export function setSlideLayout(doc: DeckDoc, layout: LayoutId): void {
  const ids = targetIds(doc)
  const r = change(doc, msg('Change Layout'), ids.map((id) => ({ op: 'setLayout', id, layout })))
  const lost = r?.dropped.reduce((n, d) => n + d.slots.length, 0) ?? 0
  if (lost) toast(t('{count, plural, one {# part didn’t fit the new layout. Undo to get it back.} other {# parts didn’t fit the new layout. Undo to get them back.}}', { count: lost }))
}

// ---------------------------------------------------------------------------
// Exports: PDF, PowerPoint and pictures (ADR 0018). The engines load only when used.

export type DeckExport = 'pdf' | 'pptx' | 'png'

export async function deckFontBytes(): Promise<Uint8Array> {
  const { default: url } = await import('../styles/fonts/urbanist.woff2?url')
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

export async function exportBytes(doc: DeckDoc, format: 'pdf' | 'pptx'): Promise<Uint8Array> {
  const deck = doc.deck.peek()
  if (format === 'pdf') return (await import('../deck/exportPdf')).deckToPdf(deck, doc.media, { regular: await deckFontBytes() })
  return (await import('../deck/exportPptx')).deckToPptx(deck, doc.media)
}

/** PNG of every shown slide, 1920 wide, named "<deck> 01.png" and so on. */
export async function exportPictures(doc: DeckDoc, first: string): Promise<number> {
  const { slideCanvas } = await import('../deck/raster')
  const deck = doc.deck.peek()
  const shown = deck.slides.filter((s) => !s.hidden)
  const stem = first.replace(/(\s*\d+)?\.png$/i, '')
  for (const [i, slide] of shown.entries()) {
    const c = await slideCanvas(deck, slide, doc.media, 1920)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) continue
    const path = shown.length === 1 ? `${stem}.png` : `${stem} ${String(i + 1).padStart(2, '0')}.png`
    await platform.writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  }
  return shown.length
}

export async function exportDeck(doc: DeckDoc, format: DeckExport): Promise<void> {
  const base = doc.name.peek().replace(/\.[^.]+$/, '')
  const filter = { pdf: { name: msg('PDF document'), extensions: ['pdf'] }, pptx: { name: msg('PowerPoint presentation'), extensions: ['pptx'] }, png: { name: msg('PNG pictures'), extensions: ['png'] } }[format]
  const target = await platform.saveDialog(`${base}.${format}`, [filter])
  if (!target) return
  try {
    if (format === 'png') {
      const n = await withBusy(t('Exporting…'), () => exportPictures(doc, target))
      toast(t('{count, plural, one {Exported # slide as a picture} other {Exported # slides as pictures}}', { count: n }))
      return
    }
    const bytes = await withBusy(t('Exporting…'), () => exportBytes(doc, format))
    await platform.writeFile(target, bytes)
    toast(t('Exported {file}', { file: platform.baseName(target) }))
  } catch (e) {
    console.error(e)
    toast(t('Couldn’t export: {error}', { error: String((e as Error).message ?? e) }), 'error')
  }
}
