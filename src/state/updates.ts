/**
 * Update notifications (ADR 0009): at most once a day, and only when enabled,
 * Glance asks GitHub for the latest release. Nothing is downloaded or sent;
 * the user decides whether to download, skip that version, or turn checks off.
 */
import { signal } from '@preact/signals'
import { isNewer } from '../core/version'
import * as platform from '../platform'
import { settings } from './settings'

const RELEASES = 'https://api.github.com/repos/RedtRocks/viewer/releases/latest'
const LAST_CHECK = 'glance.updates.lastCheck'
const DAY = 24 * 60 * 60 * 1000

export const availableUpdate = signal<{ version: string; url: string } | null>(null)

export async function checkForUpdates(opts: { force?: boolean } = {}): Promise<'newer' | 'current' | 'skipped' | 'off' | 'error'> {
  if (!platform.isTauri) return 'off'
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
