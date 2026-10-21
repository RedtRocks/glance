/**
 * The document looks (src/doc/designs), loaded one at a time when a document or the start
 * screen needs them. Views read `looksVersion` so they redraw once a look arrives.
 */
import { signal } from '@preact/signals'
import { DOC_BOARDS, DOC_LOADERS } from '../doc/designs'
import type { DocBoard, DocBoardInfo } from '../core/doc/look'
import { clearMeasures } from '../doc/measure'

const looks = new Map<string, DocBoard>()
const loading = new Map<string, Promise<DocBoard | undefined>>()

/** Bumped each time a look (or its fonts) loads. */
export const looksVersion = signal(0)

export const lookInfo = (id: string): DocBoardInfo | undefined => DOC_BOARDS.find((b) => b.id === id)

/** A loaded look, or undefined. */
export const findLook = (id: string): DocBoard | undefined => looks.get(id)

const fontsOf = (board: DocBoard) =>
  Promise.all(board.fonts.map((f) => document.fonts.load(`${f.italic ? 'italic ' : ''}${f.weight} 16px '${f.family}'`).catch(() => [])))

export function loadLook(id: string): Promise<DocBoard | undefined> {
  const have = looks.get(id)
  if (have) return Promise.resolve(have)
  const loader = DOC_LOADERS[id]
  if (!loader) return Promise.resolve(undefined)
  let p = loading.get(id)
  if (!p) {
    p = loader().then((board) => {
      looks.set(id, board)
      looksVersion.value++
      // Lines break by measuring text in its font, so lay out again once the fonts are in.
      if (typeof document !== 'undefined' && document.fonts) {
        void fontsOf(board).then(() => {
          clearMeasures()
          looksVersion.value++
        })
      }
      return board
    }, (e) => {
      loading.delete(id)
      throw e
    })
    loading.set(id, p)
  }
  return p
}

/** Waits for a look and its fonts, for exports and AI renders that must measure right. */
export async function loadLookWithFonts(id: string): Promise<DocBoard | undefined> {
  const board = await loadLook(id)
  if (board && typeof document !== 'undefined' && document.fonts) {
    await fontsOf(board)
    clearMeasures()
  }
  return board
}
