import { signal } from '@preact/signals'
import type { ComponentChildren } from 'preact'

export interface DialogButton<T> {
  label: string
  value: T
  primary?: boolean
}

export interface DialogRequest {
  title: string
  body: ComponentChildren
  buttons: DialogButton<unknown>[]
  /** When set, the dialog shows a text field and resolves with its value for the primary button. */
  input?: { label: string; password?: boolean; initial?: string }
  resolve: (value: unknown) => void
}

export const dialog = signal<DialogRequest | null>(null)

/** Fluent-style content dialog. Resolves with the clicked button's value (or null on Esc). */
export function showDialog<T>(opts: Omit<DialogRequest, 'resolve' | 'buttons'> & { buttons: DialogButton<T>[] }): Promise<T | null> {
  return new Promise((resolve) => {
    dialog.value = { ...opts, resolve: resolve as (v: unknown) => void } as DialogRequest
  })
}

export async function promptText(title: string, label: string, opts: { password?: boolean; initial?: string; ok?: string } = {}): Promise<string | null> {
  const res = await showDialog<string | null>({
    title,
    body: null,
    input: { label, password: opts.password, initial: opts.initial },
    buttons: [
      { label: 'Cancel', value: null },
      { label: opts.ok ?? 'OK', value: '__input__', primary: true }
    ]
  })
  return res
}

export async function alertDialog(title: string, body: ComponentChildren): Promise<void> {
  await showDialog({ title, body, buttons: [{ label: 'OK', value: true, primary: true }] })
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}
export const toasts = signal<Toast[]>([])
let toastSeq = 0
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: ++toastSeq, text, kind }
  toasts.value = [...toasts.value, t]
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), kind === 'error' ? 7000 : 3500)
}

export const busy = signal<string | null>(null)
export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  busy.value = label
  try {
    return await fn()
  } finally {
    busy.value = null
  }
}

export const findQuery = signal('')
export const findOpen = signal(false)
export const settingsOpen = signal(false)
export const customizeOpen = signal(false)
export const menuOpen = signal<string | null>(null)
export const sidebarVisible = signal(true)
export const slideshow = signal(false)

export interface ContextMenuItem {
  label: string
  run?: () => unknown
  disabled?: boolean
  /** Nested items (one level), e.g. "Copy to ▸ document". */
  items?: ContextMenuItem[]
}
/** Right-click menu; '-' entries are separators. */
export const contextMenu = signal<{ x: number; y: number; items: (ContextMenuItem | '-')[] } | null>(null)

/** Tools → Remove Sensitive Text (search-and-redact). */
export const redactTextOpen = signal(false)

/** Tools → Show Inspector (Ctrl+I). */
export const inspectorOpen = signal(false)

/** File → Clean Up PDF. */
export const cleanupOpen = signal(false)

/** File → Create Collage. */
export const collageOpen = signal(false)
