/**
 * What the open file is, for guided AI requests (core/ai/guide.ts). Each kind of file
 * Glance makes registers how to describe its open tab: decks here, documents and
 * spreadsheets where they are built (registerGuideContext).
 */
import type { FileContext } from '../core/ai/guide'
import { deckContext } from '../core/ai/deckContext'
import { DeckDoc, type Doc } from './documents'
import { boardInfo, findDesign } from './designs'

type Provider = (doc: Doc) => FileContext | null

const providers: Provider[] = []

export function registerGuideContext(p: Provider): void {
  providers.push(p)
}

registerGuideContext((doc) => {
  if (!(doc instanceof DeckDoc)) return null
  const path = doc.path.peek()
  return deckContext(
    doc.deck.peek(),
    { tab: doc.id, name: doc.name.peek(), path: path && !path.startsWith('browser:') ? path : undefined, selected: doc.selection.peek(), current: doc.current.peek() },
    findDesign,
    boardInfo
  )
})

/** The context for a guided request, or null when the tab isn't a file Glance makes. */
export function fileContext(doc: Doc | null | undefined): FileContext | null {
  if (!doc) return null
  for (const p of providers) {
    const ctx = p(doc)
    if (ctx) return ctx
  }
  return null
}
