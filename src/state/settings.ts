import { effect, signal } from '@preact/signals'
import { DEFAULT_PAGE_NUMBER_THRESHOLD } from '../core/pageControls'

export type ThemePref = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePref
  /** Invert PDF pages while the app is dark (Preview's "dark appearance for PDFs"). */
  darkPdf: boolean
  /** Page number field appears when a document has more pages than this. */
  pageNumberThreshold: number
  /** Toolbar item ids in order; see ui/toolbarItems.ts. */
  toolbar: string[]
  /** Shortcut overrides: command id → combos. */
  shortcuts: Record<string, string[]>
  sidebarWidth: number
  checkForUpdates: boolean
}

export const DEFAULT_TOOLBAR = ['sidebar', 'pageControls', 'spacer', 'zoomOut', 'zoomIn', 'rotate', 'search', 'overflow']

const DEFAULTS: Settings = {
  theme: 'system',
  darkPdf: false,
  pageNumberThreshold: DEFAULT_PAGE_NUMBER_THRESHOLD,
  toolbar: DEFAULT_TOOLBAR,
  shortcuts: {},
  sidebarWidth: 188,
  checkForUpdates: true
}

const KEY = 'glance.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULTS }
}

export const settings = signal<Settings>(load())

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch }
}

export function resetToolbar(): void {
  updateSettings({ toolbar: [...DEFAULT_TOOLBAR] })
}

effect(() => {
  const value = settings.value
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
})

// Resolved theme, following the OS unless overridden.
const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null
const systemDark = signal(media?.matches ?? false)
media?.addEventListener('change', (e) => (systemDark.value = e.matches))

export function isDark(): boolean {
  const t = settings.value.theme
  return t === 'dark' || (t === 'system' && systemDark.value)
}
