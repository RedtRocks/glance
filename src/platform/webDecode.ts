/**
 * Image decoding for the browser version (see web/decoder) and desktop HEIF fallback.
 *
 * The desktop app decodes TIFF, camera RAW, PSD, JPEG XL and the rest in Rust. On the
 * web the same Rust code runs as WebAssembly. Non-Windows desktop apps also use
 * libheif WebAssembly for HEIF photos. Both hand back BMP bytes; nothing leaves the device.
 */

import { signal, type Signal } from '@preact/signals'
import { decodeHeif, encodeBmp, HEIF } from './heif'

interface DecoderExports {
  memory: WebAssembly.Memory
  alloc(len: number): number
  dealloc(ptr: number, len: number): void
  result_ptr(): number
  result_len(): number
  result_clear(): void
  decode_image(extPtr: number, extLen: number, dataPtr: number, dataLen: number): number
  archive_pages(dataPtr: number, dataLen: number): number
  archive_page(dataPtr: number, dataLen: number, page: number): number
}

let loading: Promise<DecoderExports> | null = null

/** Sits beside index.html (scripts/build-web.mjs puts it there); the service worker caches it. */
const WASM_URL = 'decoder.wasm'

function load(): Promise<DecoderExports> {
  loading ??= WebAssembly.instantiateStreaming(fetch(new URL(WASM_URL, document.baseURI)), {}).then(
    (w) => w.instance.exports as unknown as DecoderExports
  )
  return loading
}

/** Copies `bytes` into the module, runs `call`, and returns the result it left behind. */
async function run(bytes: Uint8Array, call: (d: DecoderExports, ptr: number, len: number) => number): Promise<Uint8Array> {
  const d = await load()
  const ptr = d.alloc(bytes.length)
  new Uint8Array(d.memory.buffer, ptr, bytes.length).set(bytes)
  try {
    const status = call(d, ptr, bytes.length)
    // The buffer is detached and replaced whenever the module grows its memory.
    const out = new Uint8Array(d.memory.buffer, d.result_ptr(), d.result_len()).slice()
    d.result_clear()
    if (status !== 0) throw new Error(new TextDecoder().decode(out))
    return out
  } finally {
    d.dealloc(ptr, bytes.length)
  }
}

function withText(d: DecoderExports, text: string, use: (ptr: number, len: number) => number): number {
  const enc = new TextEncoder().encode(text)
  const ptr = d.alloc(enc.length)
  new Uint8Array(d.memory.buffer, ptr, enc.length).set(enc)
  try {
    return use(ptr, enc.length)
  } finally {
    d.dealloc(ptr, enc.length)
  }
}

/** Decodes one image file into BMP bytes every browser can show. */
export async function decodeImage(ext: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (HEIF.includes(ext)) {
    const { width, height, rgba } = await decodeHeif(bytes)
    return encodeBmp(width, height, rgba)
  }
  return run(bytes, (d, ptr, len) => withText(d, ext, (ePtr, eLen) => d.decode_image(ePtr, eLen, ptr, len)))
}

/** Number of images inside a comic book archive. */
export async function archivePageCount(bytes: Uint8Array): Promise<number> {
  const names = new TextDecoder().decode(await run(bytes, (d, ptr, len) => d.archive_pages(ptr, len)))
  return names ? names.split('\n').length : 0
}

export async function archivePage(bytes: Uint8Array, page: number): Promise<Uint8Array> {
  return run(bytes, (d, ptr, len) => d.archive_page(ptr, len, page))
}

// ---------------------------------------------------------------------------
// Cache of decoded pages, so <img src> can stay synchronous.

interface Entry {
  /** Read during rendering, so views update as soon as the page is decoded. */
  url: Signal<string>
  ready: Promise<string>
}

const pages = new Map<string, Entry>()

function entryFor(key: string, decode: () => Promise<Uint8Array>): Entry {
  let entry = pages.get(key)
  if (!entry) {
    const url = signal('')
    const ready = decode().then((bmp) => (url.value = URL.createObjectURL(new Blob([bmp as BlobPart], { type: 'image/bmp' }))))
    entry = { url, ready }
    pages.set(key, entry)
    // The caller that awaits `ready` reports the failure; nothing else should.
    void ready.catch(() => undefined)
  }
  return entry
}

/** Blob URL for a decoded page; empty until it is ready, then filled in. */
export function cachedUrl(key: string, decode: () => Promise<Uint8Array>): string {
  return entryFor(key, decode).url.value
}

/** The same URL, for callers that fetch the bytes rather than show them. */
export function cachedUrlAsync(key: string, decode: () => Promise<Uint8Array>): Promise<string> {
  return entryFor(key, decode).ready
}

/** Drops the decoded pages of a file that is being closed. */
export function forgetCached(prefix: string): void {
  for (const [key, entry] of pages) {
    if (!key.startsWith(prefix)) continue
    if (entry.url.peek()) URL.revokeObjectURL(entry.url.peek())
    pages.delete(key)
  }
}
