/**
 * Update notifications (ADR 0009): at most once a day, and only when enabled,
 * Glance asks GitHub for the latest release. Nothing is downloaded or sent;
 * the user decides whether to download, skip that version, or turn checks off.
 * The Microsoft Store build never checks: the Store updates it.
 */
import { signal } from '@preact/signals'
import { isNewer } from '../core/version'
import { countDownloads } from '../core/downloads'
import * as platform from '../platform'
import { settings } from './settings'

const RELEASES = 'https://api.github.com/repos/RedtRocks/glance/releases/latest'
const LAST_CHECK = 'glance.updates.lastCheck'
const DAY = 24 * 60 * 60 * 1000

/** Installed from the Microsoft Store, which handles updates itself. */
export const storeInstall = signal(false)
const storeCheck = platform.isStorePackage().then(
  (store) => (storeInstall.value = store),
  () => false
)

export const availableUpdate = signal<{ version: string; url: string } | null>(null)

export async function checkForUpdates(opts: { force?: boolean } = {}): Promise<'newer' | 'current' | 'skipped' | 'off' | 'store' | 'error'> {
  if (!platform.isTauri) return 'off'
  if (await storeCheck) return 'store'
  if (!opts.force && !settings.peek().checkForUpdates) return 'off'
  try {
    if (!opts.force) {
      const last = Number(localStorage.getItem(LAST_CHECK) ?? 0)
      if (Date.now() - last < DAY) return 'skipped'
    }
    localStorage.setItem(LAST_CHECK, String(Date.now()))
  } catch {
    /* storage unavailable: check anyway */
  }
  try {
    const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return 'error'
    const latest = (await res.json()) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }
    const { getVersion } = await import('@tauri-apps/api/app')
    const current = await getVersion()
    if (latest.draft || latest.prerelease || !isNewer(latest.tag_name, current)) return 'current'
    if (!opts.force && settings.peek().skippedVersion === latest.tag_name) return 'current'
    availableUpdate.value = { version: latest.tag_name.replace(/^v/, ''), url: latest.html_url }
    return 'newer'
  } catch {
    return 'error'
  }
}

/** Total downloads of Glance so far, shown in About. Null when GitHub can't be reached. */
export async function downloadCount(): Promise<number | null> {
  try {
    const res = await fetch('https://api.github.com/repos/RedtRocks/glance/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    return countDownloads(await res.json())
  } catch {
    return null
  }
}
