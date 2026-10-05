/**
 * Bridge between the UI and the Rust backend.
 *
 * Every OS interaction goes through here, so the UI can also run in a plain browser
 * (for development and automated UI tests) with graceful fallbacks.
 */

import type { ShellRequest } from '../core/explorer'
import { PREVIEWS } from '../core/previews'
import { archivePage, archivePageCount, cachedUrl, cachedUrlAsync, decodeImage, forgetCached } from './webDecode'
import { t } from '../i18n'

export type Kind = 'pdf' | 'image' | 'model' | 'postscript' | 'xps' | 'archive' | 'preview' | 'unsupported'

export interface Probe {
  path: string
  name: string
  size: number
  kind: Kind
  browserNative: boolean
  pages: number
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
/** The browser version (web/), which wears the website's Wollo design instead of Fluent. */
export const isWeb = !isTauri
const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

type Invoke = typeof import('@tauri-apps/api/core').invoke
let invokeFn: Invoke | null = null
async function invoke<T>(cmd: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<T> {
  if (!invokeFn) invokeFn = (await import('@tauri-apps/api/core')).invoke
  return invokeFn<T>(cmd, args as never, options)
}

// ---------------------------------------------------------------------------
// Browser fallback: files picked or dropped in a plain browser live in memory.
const browserFiles = new Map<string, File>()
let browserSeq = 0
export function registerBrowserFile(file: File): string {
  const key = `browser:${++browserSeq}/${file.name}`
  browserFiles.set(key, file)
  return key
}

/** Frees a file the browser version held in memory, with any pages decoded from it. */
export function forgetBrowserFile(path: string): void {
  browserFiles.delete(path)
  forgetCached(`${path}#`)
}

async function browserBytes(path: string): Promise<Uint8Array> {
  const f = browserFiles.get(path)
  if (!f) throw new Error(`Unknown file ${path}`)
  return new Uint8Array(await f.arrayBuffer())
}

/** Decodes one page with the WebAssembly decoders (web/decoder). */
async function decodeInBrowser(probe: Probe, page: number): Promise<Uint8Array> {
  const bytes = await browserBytes(probe.path)
  // A comic book archive's pages are ordinary images; the decoder sniffs them.
  if (probe.kind === 'archive') return decodeImage('', await archivePage(bytes, page))
  return decodeImage(extOf(probe.name), bytes)
}

function extOf(path: string): string {
  const m = /\.([^./\\]+)$/.exec(path)
  return m ? m[1].toLowerCase() : ''
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(0, i) : ''
}

// ---------------------------------------------------------------------------
// glance:// scheme URLs (see src-tauri/src/protocol.rs)

export function schemeUrl(route: 'file' | 'decode' | 'archive', params: Record<string, string | number>): string {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  // WebView2 exposes custom schemes as http://<scheme>.localhost.
  return isWindows ? `http://glance.localhost/${route}?${q}` : `glance://localhost/${route}?${q}`
}

/** URL an <img> can load directly for one page of an image file. */
export function imageUrl(probe: Probe, page = 0, max?: number): string {
  if (!isTauri) {
    if (probe.browserNative) {
      const f = browserFiles.get(probe.path)
      return f ? objectUrl(probe.path, f) : ''
    }
    return cachedUrl(`${probe.path}#${page}`, () => decodeInBrowser(probe, page))
  }
  if (probe.kind === 'archive') return schemeUrl('archive', { path: probe.path, page })
  if (probe.browserNative && !max) return schemeUrl('file', { path: probe.path })
  return schemeUrl('decode', { path: probe.path, page, ...(max ? { max } : {}) })
}

/** Like [`imageUrl`], but waits for a page the browser version still has to decode. */
export async function imageUrlAsync(probe: Probe, page = 0, max?: number): Promise<string> {
  if (isTauri || probe.browserNative) return imageUrl(probe, page, max)
  return cachedUrlAsync(`${probe.path}#${page}`, () => decodeInBrowser(probe, page))
}

/** One object URL per file, so repeated renders don't leak a URL each time. */
const objectUrls = new Map<string, string>()
function objectUrl(path: string, file: File): string {
  let url = objectUrls.get(path)
  if (!url) {
    url = URL.createObjectURL(file)
    objectUrls.set(path, url)
  }
  return url
}

// ---------------------------------------------------------------------------

const BROWSER_NATIVE = ['jpg', 'jpeg', 'jfif', 'pjpeg', 'png', 'apng', 'gif', 'webp', 'bmp', 'dib', 'ico', 'cur', 'svg', 'avif']

/** Formats the WebAssembly decoders handle in the browser version (web/decoder). */
const WASM_IMAGES = [
  'tif', 'tiff', 'jp2', 'j2k', 'jpf', 'jpx', 'j2c', 'jxl', 'exr', 'hdr', 'tga', 'dds', 'qoi',
  'ppm', 'pgm', 'pbm', 'pam', 'pnm', 'icns', 'psd', 'psb'
]

const RAW_IMAGES = [
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'raw', 'dng', 'pef',
  'srw', 'x3f', 'erf', 'mef', 'mos', 'mrw', 'kdc', 'dcr', '3fr', 'fff', 'iiq', 'rwl', 'gpr'
]

const MODELS = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'usdz', 'usda', 'usdc', 'dae', '3mf', '3ds']

export async function probe(path: string): Promise<Probe> {
  if (isTauri) return invoke<Probe>('probe', { path })
  const f = browserFiles.get(path)
  if (!f) throw new Error(`Unknown file ${path}`)
  const ext = extOf(f.name)
  const head = new Uint8Array(await f.slice(0, 5).arrayBuffer())
  // Files are often misnamed, so the magic bytes win, as they do in the Windows app.
  const isPdf = String.fromCharCode(...head) === '%PDF-'
  const kind: Kind = isPdf || ext === 'pdf' || ext === 'ai' ? 'pdf' : classifyExt(ext)
  const browserNative = kind === 'image' && BROWSER_NATIVE.includes(ext)
  const base = { path, name: f.name, size: f.size, kind, browserNative }
  if (kind === 'archive') return { ...base, pages: await archivePageCount(await browserBytes(path)) }
  // XPS is rendered by Windows itself; 0 pages is how the backend says "can't show this".
  return { ...base, pages: kind === 'xps' ? 0 : 1 }
}

/** Media types the share sheet needs to offer the right apps. */
function mimeOf(name: string): string {
  const ext = extOf(name)
  const types: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm', md: 'text/markdown', txt: 'text/plain', epub: 'application/epub+zip', eml: 'message/rfc822' }
  return types[ext] ?? 'application/octet-stream'
}

function classifyExt(ext: string): Kind {
  if (BROWSER_NATIVE.includes(ext) || WASM_IMAGES.includes(ext) || RAW_IMAGES.includes(ext)) return 'image'
  if (MODELS.includes(ext)) return 'model'
  if (ext === 'cbz') return 'archive'
  if (PREVIEWS.includes(ext)) return 'preview'
  if (['ps', 'eps', 'epsf', 'epsi'].includes(ext)) return 'postscript'
  if (ext === 'xps' || ext === 'oxps') return 'xps'
  return 'unsupported'
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (!isTauri) return browserBytes(path)
  const res = await fetch(schemeUrl('file', { path }))
  if (!res.ok) throw new Error(await res.text())
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * An address a <video> or <audio> element can play the file from. In the browser
 * that's the picked file itself; the app reads it into memory first. Call revoke when done.
 */
export async function mediaUrl(path: string, name: string): Promise<{ url: string; revoke: () => void }> {
  const f = browserFiles.get(path)
  const blob = f ?? new Blob([(await readFile(path)) as Uint8Array<ArrayBuffer>], { type: mimeOf(name) })
  const url = URL.createObjectURL(blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  if (!isTauri) {
    const blob = new Blob([data as BlobPart])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = baseName(path)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    return
  }
  await invoke('write_file', data, { headers: { 'x-path': encodeURIComponent(path) } })
}

export async function writeTemp(name: string, data: Uint8Array): Promise<string> {
  // The browser has no temp folder: the bytes become an in-memory file instead.
  if (!isTauri) return registerBrowserFile(new File([data as BlobPart], name, { type: mimeOf(name) }))
  return invoke<string>('write_temp', data, { headers: { 'x-name': encodeURIComponent(name) } })
}

export interface FileFilter {
  /** English, marked with msg(); translated when the dialog opens. */
  name: string
  extensions: string[]
}

export async function openDialog(options: { multiple?: boolean; filters?: FileFilter[] } = {}): Promise<string[]> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = options.multiple ?? true
      input.onchange = () => resolve([...(input.files ?? [])].map(registerBrowserFile))
      input.click()
    })
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const res = await open({ multiple: options.multiple ?? true, filters: translateFilters(options.filters) })
  if (!res) return []
  return Array.isArray(res) ? res : [res]
}

export async function saveDialog(defaultPath: string, filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri) return defaultPath
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath, filters: translateFilters(filters) })
}

function translateFilters(filters?: FileFilter[]): FileFilter[] | undefined {
  return filters?.map((f) => ({ ...f, name: t(f.name) }))
}

// i18n-ignore: the product name as the default window title
export async function confirmDialog(message: string, title = 'Glance', okLabel?: string): Promise<boolean> {
  if (!isTauri) return window.confirm(message)
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(message, { title, kind: 'warning', okLabel: okLabel ?? t('OK'), cancelLabel: t('Cancel') })
}

// i18n-ignore: the product name as the default window title
export async function messageDialog(message: string, title = 'Glance'): Promise<void> {
  if (!isTauri) {
    window.alert(message)
    return
  }
  const { message: show } = await import('@tauri-apps/plugin-dialog')
  await show(message, { title })
}

export async function initialFiles(): Promise<string[]> {
  return isTauri ? invoke<string[]>('initial_files') : []
}

/** "main" for the first window; windows opened later have their own labels. */
export async function windowLabel(): Promise<string> {
  if (!isTauri) return 'main'
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().label
}

export async function windowMaterial(): Promise<'mica' | 'solid'> {
  return isTauri ? invoke<'mica' | 'solid'>('window_material') : 'solid'
}

/** True in the Microsoft Store (MSIX) build, which the Store keeps up to date. */
export async function isStorePackage(): Promise<boolean> {
  return isTauri ? invoke<boolean>('store_package') : false
}

export async function showWindow(): Promise<void> {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().show()
}

export async function setWindowTitle(title: string): Promise<void> {
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTitle(title)
  } else {
    document.title = title
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (!isTauri) {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  await w.setFullscreen(!(await w.isFullscreen()))
}

export async function openNewWindow(paths: string[]): Promise<void> {
  if (!isTauri) return
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = `doc-${Date.now()}`
  // zoomHotkeysEnabled also turns on touchpad pinch in WebView2; see core/pageZoom.
  const url = `index.html#open=${encodeURIComponent(JSON.stringify(paths))}`
  new WebviewWindow(label, { url, title: 'Glance' /* i18n-ignore: product name */, width: 1100, height: 800, transparent: false, zoomHotkeysEnabled: true })
}

/** Second launches (Open with, Send to) forward their files here. */
export async function onOpenFiles(cb: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<string[]>('open-files', (e) => cb(e.payload))
}

/**
 * Explorer's right-click verbs (Combine into PDF, Remove Location Info). Requests that
 * arrived before the listener existed are delivered right after it is registered.
 */
export async function onShellRequest(cb: (r: ShellRequest) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<ShellRequest>('shell-request', (e) => cb(e.payload))
  for (const r of await invoke<ShellRequest[]>('take_shell_requests')) cb(r)
  return unlisten
}

/** `name` in `dir`, numbered ("name 2.pdf") if a file already has that name. */
export async function uniquePath(dir: string, name: string): Promise<string> {
  return invoke<string>('unique_path', { dir, name })
}

export interface DropEvent {
  type: 'enter' | 'over' | 'drop' | 'leave'
  paths: string[]
  /** CSS pixels relative to the viewport. */
  x: number
  y: number
}

/** Files dragged in from Explorer (or from another Glance window's Drag Out). */
export async function onFileDrop(cb: (e: DropEvent) => void): Promise<() => void> {
  if (!isTauri) {
    const handler = (ev: DragEvent): void => {
      ev.preventDefault()
      const type = ev.type === 'drop' ? 'drop' : ev.type === 'dragleave' ? 'leave' : 'over'
      const paths = type === 'drop' ? [...(ev.dataTransfer?.files ?? [])].map(registerBrowserFile) : []
      cb({ type, paths, x: ev.clientX, y: ev.clientY })
    }
    const types = ['dragover', 'drop', 'dragleave'] as const
    types.forEach((t) => window.addEventListener(t, handler))
    return () => types.forEach((t) => window.removeEventListener(t, handler))
  }
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload
    const dpr = window.devicePixelRatio || 1
    const pos = 'position' in p ? p.position : { x: 0, y: 0 }
    cb({
      type: p.type,
      paths: 'paths' in p ? p.paths : [],
      x: pos.x / dpr,
      y: pos.y / dpr
    })
  })
}

/** Starts an OS drag of a file out of the window (Drag Out). */
export async function dragOut(filePath: string, iconPath: string): Promise<void> {
  if (!isTauri) return
  const { startDrag } = await import('@crabnebula/tauri-plugin-drag')
  await startDrag({ item: [filePath], icon: iconPath })
}

export async function revealInExplorer(path: string): Promise<void> {
  if (!isTauri) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path)
}

export async function openUrl(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener')
    return
  }
  const { openUrl: open } = await import('@tauri-apps/plugin-opener')
  await open(url)
}

export async function convertPostscript(path: string): Promise<string> {
  // Ghostscript is a separate program, so the browser version can't convert.
  if (!isTauri) throw new Error('ghostscript-missing')
  return invoke<string>('convert_postscript', { path })
}

export async function readClipboardImage(): Promise<{ rgba: Uint8Array; width: number; height: number } | null> {
  if (!isTauri) return null
  const { readImage } = await import('@tauri-apps/plugin-clipboard-manager')
  try {
    const img = await readImage()
    const { width, height } = await img.size()
    return { rgba: await img.rgba(), width, height }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Saved signatures (encrypted with Windows DPAPI in the backend)

export interface SavedSignature {
  id: string
  name: string
  created: number
  /** Base64 PNG. */
  png: string
}

const BROWSER_SIGS = 'glance.dev.signatures'

export async function listSignatures(): Promise<SavedSignature[]> {
  if (isTauri) return invoke<SavedSignature[]>('signatures_list')
  try {
    return JSON.parse(sessionStorage.getItem(BROWSER_SIGS) ?? '[]')
  } catch {
    return []
  }
}

export async function saveSignature(name: string, pngBase64: string): Promise<SavedSignature> {
  if (isTauri) return invoke<SavedSignature>('signature_save', { name, png: pngBase64 })
  const sig = { id: `sig-${Date.now().toString(16)}`, name, created: Date.now(), png: pngBase64 }
  sessionStorage.setItem(BROWSER_SIGS, JSON.stringify([...(await listSignatures()), sig]))
  return sig
}

export async function deleteSignature(id: string): Promise<void> {
  if (isTauri) return invoke('signature_delete', { id })
  sessionStorage.setItem(BROWSER_SIGS, JSON.stringify((await listSignatures()).filter((s) => s.id !== id)))
}

// ---------------------------------------------------------------------------
// Image editing backends

/** U²-Net-p subject mask: 320×320 RGB in, 320×320 mask out (see src-tauri/src/subject.rs). */
export async function subjectMask(rgb: Uint8Array): Promise<Uint8Array> {
  const res = await invoke<ArrayBuffer>('subject_mask', rgb)
  return new Uint8Array(res)
}

/** Encodes RGBA pixels natively and writes them to `path` in `format`. */
/** Target color space for exported images; pixels are converted from sRGB and the ICC profile embedded. */
export type ColorProfile = 'srgb' | 'p3' | 'adobergb' | 'gray'

export async function saveImage(path: string, format: string, width: number, height: number, rgba: Uint8ClampedArray, quality = 92, profile?: ColorProfile): Promise<void> {
  if (!isTauri) {
    const c = new OffscreenCanvas(width, height)
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
    const type = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
    const blob = await c.convertToBlob({ type, quality: quality / 100 })
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return
  }
  await invoke('save_image', new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    headers: {
      'x-path': encodeURIComponent(path),
      'x-format': format,
      'x-width': String(width),
      'x-height': String(height),
      'x-quality': String(quality),
      ...(profile ? { 'x-profile': profile } : {})
    }
  })
}

export async function copyPngToClipboard(png: Uint8Array): Promise<void> {
  if (!isTauri) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })])
    return
  }
  const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager')
  await writeImage(png)
}

// ---------------------------------------------------------------------------
// Installed fonts for text boxes (see src-tauri/src/fonts.rs)

/** Common Windows families, for the browser build where fonts can't be enumerated. */
const BROWSER_FONTS = ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Times New Roman', 'Trebuchet MS', 'Verdana']
let fontList: Promise<string[]> | null = null

export function listFonts(): Promise<string[]> {
  fontList ??= isTauri
    ? invoke<{ family: string }[]>('fonts_list').then((l) => l.map((f) => f.family)).catch(() => [])
    : Promise.resolve(BROWSER_FONTS)
  return fontList
}

/** The regular face of an installed family, ready to embed in a PDF; null if unavailable. */
export async function fontBytes(family: string): Promise<Uint8Array | null> {
  if (!isTauri) return null
  try {
    const buf = await invoke<ArrayBuffer>('font_bytes', { family })
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

/**
 * Runs `canClose` when the user closes the window (title bar, Alt+F4, taskbar);
 * the window stays open if it resolves false.
 */
export async function onCloseRequested(canClose: () => Promise<boolean>, hasUnsaved: () => boolean): Promise<() => void> {
  if (!isTauri) {
    // Browsers can't await a dialog on unload; they show their own "leave site?" prompt.
    const guard = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) e.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  // Tauri awaits the handler and destroys the window unless it was prevented.
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await canClose())) event.preventDefault()
  })
}

// ---------------------------------------------------------------------------
// Windows shell hand-offs (see src-tauri/src/shell.rs)

/** Shows the Windows "Open with" picker for the file. */
export async function openWith(path: string): Promise<void> {
  if (!isTauri) throw new Error(t('Open With is available in the Windows app.'))
  await invoke('open_with', { path })
}

/** Whether Windows opens PDFs, and JPEG and PNG images, with Glance. */
export async function defaultAppStatus(): Promise<{ pdf: boolean; images: boolean }> {
  return isTauri ? invoke('default_app_status') : { pdf: false, images: false }
}

/**
 * Opens Glance's page in Windows Settings → Apps → Default apps. Windows doesn't let
 * apps make themselves the default; the user confirms there (one "Set default" button
 * on Windows 11).
 */
export async function openDefaultAppsSettings(): Promise<void> {
  if (!isTauri) throw new Error(t('Default apps can be set in the Windows app.'))
  await invoke('open_default_apps_settings')
}

/** Uses the image bytes (JPEG/PNG/BMP) as the desktop background or the lock screen. */
export async function setWallpaper(bytes: Uint8Array, ext: string, target: 'desktop' | 'lock'): Promise<void> {
  if (!isTauri) throw new Error(t('Setting the background is available in the Windows app.'))
  await invoke('set_wallpaper', bytes, { headers: { 'x-target': target, 'x-ext': ext } })
}

// ---------------------------------------------------------------------------
// Image metadata (see src-tauri/src/metadata.rs)

export interface ImageMetadata {
  groups: { title: string; fields: { label: string; value: string }[] }[]
  location: [number, number] | null
  has_location: boolean
  can_remove_location: boolean
  color_profile: string | null
}

export async function imageMetadata(path: string): Promise<ImageMetadata | null> {
  if (!isTauri) return null
  return invoke<ImageMetadata>('image_metadata', { path })
}

/** Rewrites each file without GPS data. Returns messages for files that failed. */
export async function removeLocation(paths: string[]): Promise<string[]> {
  if (!isTauri) throw new Error(t('Removing location is available in the Windows app.'))
  return invoke<string[]>('remove_location', { paths })
}

// ---------------------------------------------------------------------------
// Text recognition with the Windows OCR engine (see src-tauri/src/ocr.rs)

export interface OcrResult {
  lines: { text: string; words: { text: string; x: number; y: number; w: number; h: number }[] }[]
  language: string
}

export const ocrAvailable = isTauri && isWindows

/** Largest image side the OCR engine accepts. */
export async function ocrMaxDimension(): Promise<number> {
  return ocrAvailable ? invoke<number>('ocr_max_dimension') : 0
}

/** Recognizes text in RGBA pixels. */
export async function ocrImage(rgba: Uint8ClampedArray, width: number, height: number): Promise<OcrResult> {
  if (!ocrAvailable) throw new Error(t('Text recognition uses the Windows OCR engine, available in the Windows app.'))
  const bgra = new Uint8Array(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    bgra[i] = rgba[i + 2]
    bgra[i + 1] = rgba[i + 1]
    bgra[i + 2] = rgba[i]
    bgra[i + 3] = 255
  }
  return invoke<OcrResult>('ocr_image', bgra, { headers: { 'x-width': String(width), 'x-height': String(height) } })
}

// ---------------------------------------------------------------------------
// Scanners (Windows.Devices.Scanners, see src-tauri/src/scan.rs)

export interface ScannerInfo {
  id: string
  name: string
  sources: ('flatbed' | 'feeder')[]
}

export const scanAvailable = isTauri && isWindows

export async function listScanners(): Promise<ScannerInfo[]> {
  return scanAvailable ? invoke<ScannerInfo[]>('scanners_list') : []
}

/** Scans with the device's own driver; returns the image files written and the resolution used. */
export async function scan(id: string, source: 'auto' | 'flatbed' | 'feeder', dpi: number): Promise<{ files: string[]; dpi: number }> {
  if (!scanAvailable) throw new Error(t('Scanning is available in the Windows app.'))
  return invoke('scan', { id, source, dpi })
}

export async function copyText(text: string): Promise<void> {
  if (isTauri) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } else {
    await navigator.clipboard.writeText(text)
  }
}

// ---------------------------------------------------------------------------
// Version history (see src-tauri/src/history.rs)

export interface VersionInfo {
  id: string
  /** ms since epoch */
  time: number
  size: number
  label: string
}

/** Browser build: an in-memory history, so the UI can be exercised without the backend. */
const memHistory = new Map<string, { info: VersionInfo; bytes: Uint8Array }[]>()

export const historyAvailable = true

export async function historyRecord(path: string, bytes: Uint8Array, label: string): Promise<VersionInfo | null> {
  if (!isTauri) {
    const list = memHistory.get(path) ?? []
    const last = list.at(-1)
    if (last && last.bytes.length === bytes.length && last.bytes.every((b, i) => b === bytes[i])) return null
    const time = Math.max(Date.now(), (last?.info.time ?? 0) + 1)
    const info = { id: time.toString(16), time, size: bytes.length, label }
    memHistory.set(path, [...list, { info, bytes: bytes.slice() }])
    return info
  }
  return invoke<VersionInfo | null>('history_record', bytes, { headers: { 'x-path': encodeURIComponent(path), 'x-label': encodeURIComponent(label) } })
}

/** Records the file as it is on disk right now. */
export async function historyRecordFile(path: string, label: string): Promise<VersionInfo | null> {
  if (!isTauri) return historyRecord(path, await readFile(path), label)
  return invoke<VersionInfo | null>('history_record_file', { path, label })
}

export async function historyList(path: string): Promise<VersionInfo[]> {
  if (!isTauri) return (memHistory.get(path) ?? []).map((v) => v.info).reverse()
  return invoke<VersionInfo[]>('history_list', { path })
}

export async function historyRead(path: string, id: string): Promise<Uint8Array> {
  if (!isTauri) {
    const v = memHistory.get(path)?.find((x) => x.info.id === id)
    if (!v) throw new Error(t('That version no longer exists.'))
    return v.bytes.slice()
  }
  return new Uint8Array(await invoke<ArrayBuffer>('history_read', { path, id }))
}

/** Deletes some versions, or all of them. Returns how many were removed. */
export async function historyDelete(path: string, ids?: string[]): Promise<number> {
  if (!isTauri) {
    const list = memHistory.get(path) ?? []
    const left = ids ? list.filter((v) => !ids.includes(v.info.id)) : []
    memHistory.set(path, left)
    return list.length - left.length
  }
  return invoke<number>('history_delete', { path, ids: ids ?? null })
}

export async function historyRename(from: string, to: string): Promise<void> {
  if (!isTauri) {
    memHistory.set(to, [...(memHistory.get(to) ?? []), ...(memHistory.get(from) ?? [])])
    memHistory.delete(from)
    return
  }
  await invoke('history_rename', { from, to })
}

// ---------------------------------------------------------------------------
// One window per file, and noticing changes by other apps (see src-tauri/src/files.rs)

/** Claims the file for this window; returns the label of the window that already has it. */
export async function claimFile(path: string): Promise<string | null> {
  if (!isTauri) return null
  return invoke<string | null>('claim_file', { path })
}

export async function releaseFile(path: string): Promise<void> {
  if (isTauri) await invoke('release_file', { path }).catch(() => undefined)
}

/** Brings the owning window forward and shows the file there. */
export async function focusFile(label: string, path: string): Promise<void> {
  if (isTauri) await invoke('focus_file', { label, path })
}

export async function onActivateFile(cb: (path: string) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return getCurrentWebviewWindow().listen<string>('activate-file', (e) => cb(e.payload))
}

export interface FileStamp {
  modified: number
  size: number
}

export async function fileStamp(path: string): Promise<FileStamp | null> {
  if (!isTauri) return null
  return invoke<FileStamp>('file_stamp', { path }).catch(() => null)
}

/** Opens the Windows share sheet for these files. */
export async function shareFiles(paths: string[], title: string): Promise<void> {
  if (!isTauri) {
    const files = paths.map((p) => browserFiles.get(p)).filter((f): f is File => !!f)
    // The phone's share sheet where there is one (WhatsApp, Mail, Files); a download elsewhere.
    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files, title })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') throw e
      }
      return
    }
    for (const f of files) await writeFile(f.name, new Uint8Array(await f.arrayBuffer()))
    return
  }
  await invoke('share_files', { paths, title })
}

// ---------------------------------------------------------------------------
// Certificate-based PDF signatures (src-tauri/src/certsig.rs)

export interface SignatureCheck {
  integrity: 'intact' | 'modified' | 'invalid'
  trust: 'trusted' | 'untrusted' | 'revoked' | 'expired' | 'unknown'
  detail: string
  signer: string
  email: string
  issuer: string
  signingTime: number | null
  timestamp: number | null
  timestampAuthority: string
  revocationChecked: boolean
  certificate: string
}

/** Checking uses the Windows certificate store, so only the Windows app can do it. */
export const signatureCheckAvailable = isTauri && isWindows

/** Checks a CMS signature blob against the data it signs (or, for `sha1`, that data's SHA-1). */
export async function verifyPdfSignature(kind: 'detached' | 'sha1' | 'timestamp', cms: Uint8Array, data: Uint8Array, claimedTime: number | null): Promise<SignatureCheck> {
  const body = new Uint8Array(4 + cms.length + data.length)
  new DataView(body.buffer).setUint32(0, cms.length, true)
  body.set(cms, 4)
  body.set(data, 4 + cms.length)
  const headers: Record<string, string> = { 'x-kind': kind }
  if (claimedTime !== null) headers['x-claimed-time'] = String(claimedTime)
  return invoke<SignatureCheck>('verify_pdf_signature', body, { headers })
}

/** Opens the Windows certificate dialog for a base64 DER certificate. */
export async function showCertificate(der: string): Promise<void> {
  await invoke('show_certificate', { der })
}

export interface SigningCertificate {
  thumbprint: string
  name: string
}

/** The Windows certificate picker (Personal store); null when cancelled. */
export async function pickSigningCertificate(): Promise<SigningCertificate | null> {
  return invoke<SigningCertificate | null>('pick_signing_certificate')
}

/** A detached CMS signature over `data` with the chosen certificate. */
export async function signWithCertificate(thumbprint: string, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('sign_with_certificate', data, { headers: { 'x-thumbprint': thumbprint } }))
}
