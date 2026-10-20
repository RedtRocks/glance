/**
 * Templates: designed decks to start from (src/deck/designs, built from the template
 * boards by scripts/build-templates.mjs). A template's slides come with sample text in
 * the person's language, for them or the AI to replace.
 */
import { BOARDS } from '../deck/designs'
import type { BoardInfo } from '../core/deck/design'
import type { Deck } from '../core/deck/model'
import { boardDeck } from '../core/deck/template'
import { loadBoard, sampleText } from './designs'

export type Template = BoardInfo

export const TEMPLATES: Template[] = BOARDS

/** A new deck from a template, in the person's language, or null if there's no such template. */
export async function templateDeck(id: string): Promise<Deck | null> {
  const board = await loadBoard(id)
  return board ? boardDeck(board, sampleText) : null
}
