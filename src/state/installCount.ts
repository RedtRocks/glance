/**
 * Anonymous install count (ADR 0016): once a day, while "Count this install" is on,
 * Glance tells Umami (https://umami.is) that a copy is in use, with its version and
 * whether it came from the Microsoft Store or GitHub. No ID, file, name or setting
 * is sent; the number of these check-ins per day is how many copies are in use.
 * Unlike update checks this also runs in the Store build.
 */
import * as platform from '../platform'
import { settings } from './settings'
import { storeInstall } from './updates'

const ENDPOINT = 'https://cloud.umami.is/api/send'
/** The "Glance app" website in Umami, kept apart from the website's visitor numbers. */
export const APP_WEBSITE_ID = '851a144f-cbe6-4c81-a08a-4e9b25a008e3'
const LAST = 'glance.installCount.last'

/** Today's date as YYYY-MM-DD, in local time, so one check-in per calendar day. */
const today = (): string => new Date().toLocaleDateString('en-CA')

export async function countInstall(): Promise<'sent' | 'off' | 'skipped' | 'error'> {
  if (!platform.isTauri || !/^[0-9a-f-]{36}$/.test(APP_WEBSITE_ID)) return 'off'
  if (!settings.peek().countInstall) return 'off'
  try {
    if (localStorage.getItem(LAST) === today()) return 'skipped'
    localStorage.setItem(LAST, today())
  } catch {
    return 'off'
  }
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    const version = await getVersion()
    await platform.isStorePackage().then((s) => (storeInstall.value = s), () => undefined)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: APP_WEBSITE_ID,
          hostname: 'app.glance',
          url: `/${version}`,
          language: navigator.language,
          name: 'Daily check-in',
          data: { version, from: storeInstall.peek() ? 'Microsoft Store' : 'GitHub' }
        }
      })
    })
    return res.ok ? 'sent' : 'error'
  } catch {
    return 'error'
  }
}
