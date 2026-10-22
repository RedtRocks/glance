/**
 * The designed templates' designs (src/deck/designs), loaded a board at a time when a deck
 * or the start screen needs them. Views read `designsVersion` so they redraw once a
 * board arrives.
 */
import { signal } from '@preact/signals'
import { BOARDS, BOARD_LOADERS } from '../deck/designs'
import { t } from '../i18n'
import { boardOf, type Board, type BoardInfo, type Design, type DesignLookup } from '../core/deck/design'

const boards = new Map<string, Board>()
const loading = new Map<string, Promise<Board | undefined>>()
const byId = new Map<string, Design>()

/**
 * A design's sample text in the person's language. Samples are messages, except the few
 * with braces (code on a slide), which t() would read as placeholders; those stay as they are.
 */
export const sampleText = (s: string): string => (/[{}]/.test(s) ? s : t(s))

/** Bumped each time a board loads. */
export const designsVersion = signal(0)

/** A loaded design, or undefined if its board isn't loaded (or doesn't exist). */
export const findDesign: DesignLookup = (id) => byId.get(id)

export const boardInfo = (id: string): BoardInfo | undefined => BOARDS.find((b) => b.id === id)

export function loadedBoard(id: string): Board | undefined {
  return boards.get(id)
}

export function loadBoard(id: string): Promise<Board | undefined> {
  const have = boards.get(id)
  if (have) return Promise.resolve(have)
  const loader = BOARD_LOADERS[id]
  if (!loader) return Promise.resolve(undefined)
  let p = loading.get(id)
  if (!p) {
    p = loader().then((board) => {
      boards.set(id, board)
      for (const d of board.designs) byId.set(d.id, d)
      designsVersion.value++
      // Text is fitted by measuring it in its font, so redraw once the fonts are in.
      if (typeof document !== 'undefined' && document.fonts) {
        void Promise.all(board.fonts.map((f) => document.fonts.load(`${f.italic ? 'italic ' : ''}${f.weight} 16px '${f.family}'`).catch(() => []))).then(() => designsVersion.value++)
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

/** Loads the boards these designs belong to, and returns the lookup. */
export async function loadDesigns(ids: Iterable<string>): Promise<DesignLookup> {
  await Promise.all([...new Set([...ids].map(boardOf))].map(loadBoard))
  return findDesign
}

/** Every board, for the AI tools that list them. */
export async function loadAllBoards(): Promise<Board[]> {
  const all = await Promise.all(BOARDS.map((b) => loadBoard(b.id)))
  return all.filter((b): b is Board => !!b)
}
