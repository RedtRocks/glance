/**
 * Context-aware Page Controls (see CONTEXT.md): previous/next only for multi-page
 * documents; the page number field only once a document is "long".
 */
export interface PageContext {
  pageCount: number
  /** Show the page number field when pageCount exceeds this (user setting, default 2). */
  pageNumberThreshold: number
}

export const DEFAULT_PAGE_NUMBER_THRESHOLD = 2

export function showPageButtons(ctx: PageContext): boolean {
  return ctx.pageCount > 1
}

export function showPageNumberField(ctx: PageContext): boolean {
  return ctx.pageCount > 1 && ctx.pageCount > ctx.pageNumberThreshold
}

/** Parses "12", "12/40" or " 7 " into a clamped 0-based index; null if not a number. */
export function parsePageInput(text: string, pageCount: number): number | null {
  const m = /^\s*(\d+)/.exec(text)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Math.min(Math.max(n, 1), pageCount) - 1
}
