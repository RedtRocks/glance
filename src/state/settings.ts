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
  /** Release tag the user chose to skip ("v0.3.0"). */
  skippedVersion?: string
  /** Save edits automatically a few seconds after they stop (earlier versions stay in the history). */
  autosave: boolean
  /** UI language code, or 'system' to follow Windows. See i18n/index.ts. */
  language: string
}

export const DEFAULT_TOOLBAR = ['sidebar', 'pageControls', 'spacer', 'zoomOut', 'zoomIn', 'rotate', 'highlight', 'markup', 'search', 'overflow']

const DEFAULTS: Settings = {
  theme: 'system',
  darkPdf: false,
  pageNumberThreshold: DEFAULT_PAGE_NUMBER_THRESHOLD,
  toolbar: DEFAULT_TOOLBAR,
  shortcuts: {},
  sidebarWidth: 188,
  checkForUpdates: true,
  autosave: true,
  language: 'system'
}

const KEY = 'glance.settings.v1'

/** Toolbar items added in later versions are appended for users with a saved toolbar. */
const ADDED_ITEMS: Record<string, string> = { highlight: 'rotate', markup: 'highlight' }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = { ...DEFAULTS, ...JSON.parse(raw) } as Settings & { seenItems?: string[] }
      const seen = new Set(saved.seenItems ?? [])
      for (const [item, after] of Object.entries(ADDED_ITEMS)) {
        if (seen.has(item) || saved.toolbar.includes(item)) continue
        const i = saved.toolbar.indexOf(after)
        saved.toolbar.splice(i >= 0 ? i + 1 : saved.toolbar.length - 1, 0, item)
      }
      saved.seenItems = [...new Set([...seen, ...Object.keys(ADDED_ITEMS)])]
      return saved
    }
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
