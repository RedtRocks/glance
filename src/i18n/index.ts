/**
 * Translations. Every piece of UI text goes through `t()`, written in English:
 *
 *   t('Save changes automatically')
 *   t('Exported {file}', { file: name })
 *   t('{count, plural, one {# page} other {# pages}}', { count })
 *
 * The English text is the key, so English needs no catalog. Other languages live in
 * locales/<code>.json as { "English text": "translation" }; `npm run i18n <code>`
 * creates or updates one. Missing or empty entries fall back to English.
 *
 * Text defined outside a component (command labels, menu names) is marked with
 * `msg()` so the tooling finds it, and translated with `t()` where it's shown.
 *
 * Glance follows the Windows display language (WebView2 reports it as the browser
 * language) unless the user picks one in Settings.
 */
import { computed, effect } from '@preact/signals'
import { settings } from '../state/settings'
import { format, pseudoMessage, resolveLocale, type Vars } from './format'

export type { Vars } from './format'

/** Windows' own pseudo-locale tag. Accented, lengthened text for spotting untranslated or clipped UI. */
export const PSEUDO = 'qps-ploc'

const catalogs: Record<string, Record<string, string>> = { en: {} }
for (const [path, mod] of Object.entries(import.meta.glob<{ default: Record<string, string> }>('./locales/*.json', { eager: true }))) {
  catalogs[path.slice('./locales/'.length, -'.json'.length)] = mod.default
}

/** Language codes with a catalog, English first. */
export const LANGUAGES = Object.keys(catalogs).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)))

function systemLanguages(): readonly string[] {
  return typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
}

/** The language the UI is shown in. */
export const locale = computed(() => {
  const pref = settings.value.language
  if (pref === PSEUDO) return PSEUDO
  return resolveLocale(pref && pref !== 'system' ? [pref] : systemLanguages(), LANGUAGES)
})

/** Locale for dates and numbers; undefined keeps Windows' regional format when the UI is English. */
export const intlLocale = computed(() => (locale.value === 'en' || locale.value === PSEUDO ? undefined : locale.value))

/** Translates English UI text into the current language, filling in placeholders. */
export function t(message: string, vars?: Vars): string {
  const loc = locale.value
  if (loc === PSEUDO) return pseudoMessage(message, vars)
  return format(catalogs[loc]?.[message] || message, vars, loc)
}

/** Marks text for translation without translating it yet. Pass the result to `t()` when showing it. */
export function msg(message: string): string {
  return message
}

/** A language's name in that language ("Deutsch"), for the language picker. */
export function languageName(code: string): string {
  if (code === PSEUDO) return 'Pseudo-locale (for testing)'
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
  } catch {
    return code
  }
}

if (typeof document !== 'undefined') {
  effect(() => {
    document.documentElement.lang = locale.value === PSEUDO ? 'en' : locale.value
  })
}
