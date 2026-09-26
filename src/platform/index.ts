/**
 * Bridge between the UI and the Rust backend.
 *
 * Every OS interaction goes through here, so the UI can also run in a plain browser
 * (for development and automated UI tests) with graceful fallbacks.
 */

export type Kind = 'pdf' | 'image' | 'model' | 'postscript' | 'xps' | 'archive' | 'unsupported'

export interface Probe {
  path: string
  name: string
  size: number
  kind: Kind
  browserNative: boolean
  pages: number
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
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
    const f = browserFiles.get(probe.path)
    return f ? URL.createObjectURL(f) : ''
  }
  if (probe.kind === 'archive') return schemeUrl('archive', { path: probe.path, page })
  if (probe.browserNative && !max) return schemeUrl('file', { path: probe.path })
  return schemeUrl('decode', { path: probe.path, page, ...(max ? { max } : {}) })
}

// ---------------------------------------------------------------------------

const BROWSER_NATIVE = ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif']

export async function probe(path: string): Promise<Probe> {
  if (isTauri) return invoke<Probe>('probe', { path })
  const f = browserFiles.get(path)
  if (!f) throw new Error(`Unknown file ${path}`)
  const ext = extOf(f.name)
  const head = new Uint8Array(await f.slice(0, 5).arrayBuffer())
  const isPdf = String.fromCharCode(...head) === '%PDF-'
  const kind: Kind = isPdf || ext === 'pdf' ? 'pdf' : BROWSER_NATIVE.includes(ext) ? 'image' : 'unsupported'
  return { path, name: f.name, size: f.size, kind, browserNative: kind === 'image', pages: 1 }
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (!isTauri) {
    const f = browserFiles.get(path)
    if (!f) throw new Error(`Unknown file ${path}`)
    return new Uint8Array(await f.arrayBuffer())
  }
  const res = await fetch(schemeUrl('file', { path }))
  if (!res.ok) throw new Error(await res.text())
  return new Uint8Array(await res.arrayBuffer())
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
  return invoke<string>('write_temp', data, { headers: { 'x-name': encodeURIComponent(name) } })
}

export interface FileFilter {
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
  const res = await open({ multiple: options.multiple ?? true, filters: options.filters })
  if (!res) return []
  return Array.isArray(res) ? res : [res]
}

export async function saveDialog(defaultPath: string, filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri) return defaultPath
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath, filters })
}

export async function confirmDialog(message: string, title = 'Glance', okLabel = 'OK'): Promise<boolean> {
  if (!isTauri) return window.confirm(message)
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' })
}

export async function messageDialog(message: string, title = 'Glance'): Promise<void> {
  if (!isTauri) {
    window.alert(message)
    return
  }
  const { message: msg } = await import('@tauri-apps/plugin-dialog')
  await msg(message, { title })
}

export async function initialFiles(): Promise<string[]> {
  return isTauri ? invoke<string[]>('initial_files') : []
}

export async function windowMaterial(): Promise<'mica' | 'solid'> {
  return isTauri ? invoke<'mica' | 'solid'>('window_material') : 'solid'
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
  const url = `index.html#open=${encodeURIComponent(JSON.stringify(paths))}`
  new WebviewWindow(label, { url, title: 'Glance', width: 1100, height: 800, transparent: false })
}

/** Second launches (Open with, Send to) forward their files here. */
export async function onOpenFiles(cb: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<string[]>('open-files', (e) => cb(e.payload))
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
export async function saveImage(path: string, format: string, width: number, height: number, rgba: Uint8ClampedArray, quality = 92): Promise<void> {
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
      'x-quality': String(quality)
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
