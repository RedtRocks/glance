/**
 * Whether Glance is the Windows default for PDFs and images, and the one-time offer to
 * make it so. Windows only lets the user change defaults, so "Make default" opens
 * Glance's page in Settings → Apps → Default apps (src-tauri/src/shell.rs).
 */
import { signal } from '@preact/signals'
import * as platform from '../platform'
import { settings, updateSettings } from './settings'

export const defaultApp = signal<{ pdf: boolean; images: boolean } | null>(null)

/** Shows the "Make Glance your default viewer?" bar. */
export const defaultAppOffer = signal(false)

export async function refreshDefaultApp(): Promise<void> {
  if (!platform.isTauri) return
  try {
    defaultApp.value = await platform.defaultAppStatus()
  } catch {
    defaultApp.value = null
  }
  if (defaultApp.value?.pdf && defaultApp.value.images) defaultAppOffer.value = false
}

/** Asks once per install, and only when Glance isn't already the default for both. */
export async function offerDefaultApp(): Promise<void> {
  if (!platform.isTauri || settings.peek().defaultAppAsked) return
  await refreshDefaultApp()
  const s = defaultApp.peek()
  if (s && !(s.pdf && s.images)) defaultAppOffer.value = true
}

export function dismissDefaultAppOffer(): void {
  defaultAppOffer.value = false
  updateSettings({ defaultAppAsked: true })
}

export async function makeDefault(): Promise<void> {
  dismissDefaultAppOffer()
  await platform.openDefaultAppsSettings()
}

// Coming back from Windows Settings: show the new state.
if (typeof window !== 'undefined') window.addEventListener('focus', () => void refreshDefaultApp())
