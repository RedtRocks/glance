import { effect, signal } from '@preact/signals'
import { pathKey } from '../core/paths'
import { pathPolicy } from '../platform'

export interface Bookmark {
  page: number
  label: string
  created: number
}

const KEY = 'glance.bookmarks.v1'

function load(): Record<string, Bookmark[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Windows keeps the lowercase keys bookmarks were always saved under; elsewhere case matters. */
const keyOf = (path: string): string => (pathPolicy === 'windows' ? path.toLowerCase() : pathKey(path, pathPolicy))

/** Bookmarks per file path (Preview keeps them per document too). */
export const bookmarks = signal<Record<string, Bookmark[]>>(load())

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(bookmarks.value))
  } catch {
    /* ignore */
  }
})

export function bookmarksFor(path: string | null): Bookmark[] {
  return path ? (bookmarks.value[keyOf(path)] ?? []) : []
}

export function setBookmarks(path: string, list: Bookmark[]): void {
  bookmarks.value = { ...bookmarks.value, [keyOf(path)]: list.sort((a, b) => a.page - b.page) }
}
