import { effect, signal } from '@preact/signals'
import { DEFAULT_PAGE_NUMBER_THRESHOLD } from '../core/pageControls'
import { DEFAULT_ACCENT } from '../core/theme'
import { MAX_DOTS, type Harmony } from '../core/colourWheel'

export type ThemePref = 'system' | 'light' | 'dark'
/** Wollo is the website's design (the browser version always wears it); Fluent matches Windows. */
export type LookPref = 'fluent' | 'wollo'

export interface Settings {
  theme: ThemePref
  look: LookPref
  /** Window colours from the colour wheel, #rrggbb, at most three; the first is the accent (Settings → Customise). */
  colours: string[]
  /** How the other wheel colours follow the first. */
  harmony: Harmony
  /** How strongly the colours fill the window, 0 (accent only) to 1, as in Arc or Zen. */
  strength: number
  /** Film grain over the window colours, 0 to 1. */
  grain: number
  /** Tabs across the top, or down the left side (desktop app). */
  tabs: 'top' | 'side'
  /** Tabs shrink to their icons (View → Collapse Tabs). */
  tabsCollapsed: boolean
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
  /** Reopen the files that were open when Glance last closed. */
  reopenTabs: boolean
  /** The "Make Glance your default viewer?" bar was shown and answered or closed. */
  defaultAppAsked?: boolean
  /** AI apps connected through glance-mcp may use Glance's tools (Settings → AI apps). */
  aiApps: boolean
  /** Send the anonymous daily check-in that counts installs (state/installCount.ts). */
  countInstall: boolean
}

export const DEFAULT_TOOLBAR = ['sidebar', 'pageControls', 'spacer', 'zoomOut', 'zoomIn', 'rotate', 'highlight', 'markup', 'askAi', 'search', 'overflow']

const DEFAULTS: Settings = {
  theme: 'system',
  look: 'wollo',
  colours: [DEFAULT_ACCENT],
  harmony: 'complementary',
  strength: 0,
  grain: 0,
  tabs: 'top',
  tabsCollapsed: false,
  darkPdf: false,
  pageNumberThreshold: DEFAULT_PAGE_NUMBER_THRESHOLD,
  toolbar: DEFAULT_TOOLBAR,
  shortcuts: {},
  sidebarWidth: 188,
  checkForUpdates: true,
  autosave: true,
  language: 'system',
  reopenTabs: false,
  aiApps: true,
  countInstall: true
}

const KEY = 'glance.settings.v1'

const unit = (v: unknown, fallback: number): number => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback)

/** A hand-edited or older settings file can't break the window colours. */
function withValidColours(s: Settings): Settings {
  const colours = Array.isArray(s.colours) ? s.colours.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_DOTS) : []
  return {
    ...s,
    colours: colours.length ? colours : [DEFAULT_ACCENT],
    harmony: (['complementary', 'analogous', 'triadic', 'split', 'free'] as Harmony[]).includes(s.harmony) ? s.harmony : 'free',
    strength: unit(s.strength, 0),
    grain: unit(s.grain, 0),
    tabs: s.tabs === 'side' ? 'side' : 'top',
    tabsCollapsed: s.tabsCollapsed === true
  }
}

/** Toolbar items added in later versions are appended for users with a saved toolbar. */
const ADDED_ITEMS: Record<string, string> = { highlight: 'rotate', markup: 'highlight', askAi: 'markup' }

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
      return withValidColours(saved)
    }
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULTS }
}

/**
 * The browser version shares its address with the website, whose light/dark toggle
 * keeps its choice here; the two follow each other.
 */
const SITE_THEME = 'glance-theme'
const onWeb = typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)

function withSiteTheme(s: Settings): Settings {
  if (!onWeb) return s
  try {
    const site = localStorage.getItem(SITE_THEME)
    return { ...s, theme: site === 'light' || site === 'dark' ? site : 'system' }
  } catch {
    return s
  }
}

export const settings = signal<Settings>(withSiteTheme(load()))

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
    if (onWeb) {
      if (value.theme === 'system') localStorage.removeItem(SITE_THEME)
      else localStorage.setItem(SITE_THEME, value.theme)
    }
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
