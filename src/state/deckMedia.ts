/** Object URLs for a deck's pictures, made once per picture and freed when the deck closes. */
import type { DeckDoc } from './documents'

const urls = new WeakMap<DeckDoc, Map<string, string>>()

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }

export function mediaUrl(doc: DeckDoc, src: string): string | null {
  const bytes = doc.media.get(src)
  if (!bytes) return null
  let map = urls.get(doc)
  if (!map) urls.set(doc, (map = new Map()))
  let url = map.get(src)
  if (!url) {
    const type = TYPES[src.slice(src.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
    url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
    map.set(src, url)
  }
  return url
}

export function releaseMedia(doc: DeckDoc): void {
  for (const url of urls.get(doc)?.values() ?? []) URL.revokeObjectURL(url)
  urls.delete(doc)
}
