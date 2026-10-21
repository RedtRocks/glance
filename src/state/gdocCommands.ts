/**
 * What the command registry runs for documents. Kept small and free of the layout and
 * export code, which load (with state/gdoc.ts) the first time a command needs them.
 */
import * as platform from '../platform'
import { activeDoc, type GDoc } from './documents'
import { contextMenu, toast, withBusy } from './ui'
import { msg, t } from '../i18n'
import { DOC_BOARDS } from '../doc/designs'
import { findLook, loadLook } from './docLooks'
import { previewExt } from '../core/previews'
import type { GdocExport } from './gdoc'

const gdoc = () => import('./gdoc')
const PICTURES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']

export const exportAs = async (g: GDoc, format: GdocExport) => (await gdoc()).exportGdoc(g, format)
export const addBlock = async (g: GDoc, block: Record<string, unknown>) => (await gdoc()).addBlock(g, block)
export const deleteBlock = async (g: GDoc) => (await gdoc()).deleteBlock(g)
export const nudgeBlock = async (g: GDoc, dir: -1 | 1) => (await gdoc()).nudgeBlock(g, dir)

export async function addPicture(g: GDoc): Promise<void> {
  const [path] = await platform.openDialog({ multiple: false, filters: [{ name: msg('Pictures'), extensions: PICTURES }] })
  if (!path) return
  const src = g.addMedia(platform.baseName(path), await platform.readFile(path))
  const m = await gdoc()
  await m.readAspects(g)
  m.addBlock(g, { type: 'picture', src, alt: '' }, msg('Add Picture'))
}

const centre = () => ({ x: Math.round(window.innerWidth / 2 - 120), y: 120 })

/** The look's pages to add: each design, then a plain page. */
export async function pagePicker(g: GDoc): Promise<void> {
  const look = g.doc.peek().look
  const board = findLook(look) ?? (await loadLook(look))
  if (!board) return
  const m = await gdoc()
  contextMenu.value = {
    ...centre(),
    items: [
      ...board.designs.map((d, i) => ({ label: t('{n}. {role}', { n: i + 1, role: t(d.role) }), run: () => m.addPage(g, d.id) })),
      '-' as const,
      { label: t('Plain page'), run: () => m.addPage(g, `${look}.plain`) }
    ]
  }
}

export async function lookPicker(g: GDoc): Promise<void> {
  const now = g.doc.peek().look
  const m = await gdoc()
  contextMenu.value = {
    ...centre(),
    items: DOC_BOARDS.map((b) => ({ label: b.id === now ? `✓ ${t(b.look)} · ${t(b.name)}` : `${t(b.look)} · ${t(b.name)}`, run: () => void (b.id !== now && m.setLook(g, b.id)) }))
  }
}

/** A Word file open as a preview can be turned into a Glance document. */
export const canConvert = (): boolean => {
  const d = activeDoc.value
  return d?.kind === 'preview' && previewExt(d.name.value) === 'docx'
}

/** Turns the Word file on screen into a new, unsaved Glance document, saying what was left out. */
export async function convertActive(): Promise<void> {
  const d = activeDoc.value
  if (d?.kind !== 'preview' || !d.path.peek()) return
  try {
    const g = await withBusy(t('Converting…'), () => convertDocx(d.path.peek()!, d.name.peek()))
    const lost = g.lost
    toast(lost.length ? t('Converted. Left out: {what}.', { what: lost.join(', ') }) : t('Converted.'))
  } catch (e) {
    toast(t('Couldn’t convert: {error}', { error: String((e as Error).message ?? e) }), 'error')
  }
}

export async function convertDocx(path: string, name: string, look = 'essay'): Promise<{ doc: GDoc; lost: string[] }> {
  const board = await loadLook(look)
  const { importDocx } = await import('../core/doc/importDocx')
  const r = await importDocx(await platform.readFile(path), look, board?.flow ?? `${look}.plain`)
  const m = await gdoc()
  const doc = m.newGdoc(name.replace(/\.[^.]+$/, ''), r.doc, r.media)
  await m.readAspects(doc)
  return { doc, lost: r.lost }
}
