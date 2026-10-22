/**
 * What the Ask AI composer suggests for a deck, document or spreadsheet: a placeholder with
 * an example that fits what is selected, and a few starts the person can finish. A chip
 * ending in "…" fills the box for them to complete; the others are whole requests.
 */
import type { FileContext } from '../../core/ai/guide'
import { t } from '../../i18n'

export interface ComposerHints {
  placeholder: string
  chips: string[]
}

export function composerHints(ctx: FileContext | null): ComposerHints | null {
  if (!ctx) return null
  const sel = ctx.selection
  switch (ctx.kind) {
    case 'deck': {
      const slides = sel?.kind === 'deck' ? sel.slides : []
      const placeholder = slides.length > 1
        ? t('Say what to change on these {count} slides, like “make them shorter”', { count: slides.length })
        : slides.length === 1
          ? t('Say what to change on slide {number}, like “make the title punchier”', { number: slides[0].number })
          : t('Say what to change, like “add a slide about prices”')
      return { placeholder, chips: [t('Make it shorter'), t('Add a slide about …'), t('Turn this into a table'), t('Make the words punchier')] }
    }
    case 'document': {
      const blocks = sel?.kind === 'document' ? sel.blocks.length : 0
      const placeholder = blocks
        ? t('Say what to change in the selected text, like “make it friendlier”')
        : t('Say what to change, like “add a section about costs”')
      return { placeholder, chips: [t('Rewrite in a friendlier tone'), t('Add a table of …'), t('Make it shorter'), t('Add a section about …')] }
    }
    case 'spreadsheet': {
      const range = sel?.kind === 'spreadsheet' ? sel.range : ''
      const placeholder = range
        ? t('Say what to do with {range}, like “chart this column”', { range })
        : t('Say what to change, like “add a total row”')
      return { placeholder, chips: [t('Add a total row'), t('Chart this column'), t('Fix the formula errors'), t('Add a drop-down for …')] }
    }
  }
}

/** A chip's text in the box: an unfinished one ends with a space after its words, ready to type on. */
export const chipText = (chip: string): string => (chip.endsWith('…') ? chip.slice(0, -1).trimEnd() + ' ' : chip)
