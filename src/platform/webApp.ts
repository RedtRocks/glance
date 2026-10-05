/**
 * The browser version's start-up: install support, and the ways an operating system
 * hands files to an installed web app.
 *
 * None of this runs in the Windows app, which gets its files from Explorer instead.
 */

import { signal } from '@preact/signals'
import { isTauri, registerBrowserFile } from '.'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Chrome and Edge's install offer, kept for the Install button. Safari has none. */
const installPrompt = signal<InstallPrompt | null>(null)

/** Already running as the installed app (its own window, or from the home screen). */
export const installed = signal(
  typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
)

if (!isTauri && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt.value = e as InstallPrompt
  })
  window.addEventListener('appinstalled', () => {
    installPrompt.value = null
    installed.value = true
  })
}

/** Whether Install can do anything here: a browser offer, or the iPhone's Add to Home Screen. */
export function canInstall(): boolean {
  if (isTauri || installed.value) return false
  return !!installPrompt.value || /iPhone|iPad|iPod/.test(navigator.userAgent)
}

/** Shows the browser's install offer; false when there is none (Safari: Share, then Add to Home Screen). */
export async function install(): Promise<boolean> {
  const p = installPrompt.value
  if (!p) return false
  await p.prompt()
  const { outcome } = await p.userChoice
  if (outcome === 'accepted') installPrompt.value = null
  return true
}

interface LaunchParams {
  files: FileSystemFileHandle[]
}

interface LaunchQueue {
  setConsumer(consume: (params: LaunchParams) => void): void
}

/** Where the service worker leaves files shared to Glance from another app. */
const SHARED = 'glance-shared'

export function startWebApp(open: (paths: string[]) => void): void {
  if (isTauri) return
  registerServiceWorker()
  openSharedFiles(open)

  // "Open with Glance" in the operating system's file manager, once Glance is installed.
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer(({ files }) => {
    void Promise.all(files.map((handle) => handle.getFile())).then((list) => {
      if (list.length) open(list.map(registerBrowserFile))
    })
  })
}

function registerServiceWorker(): void {
  // Only over HTTPS (or localhost); without it the app still works, just not offline.
  if (!('serviceWorker' in navigator)) return
  const register = (): void => {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch(() => undefined)
  }
  // After the page has loaded, so caching the app never slows down opening it.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)
}

/** Files sent to Glance by another app's Share sheet (Android, Chrome OS). */
function openSharedFiles(open: (paths: string[]) => void): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('shared') || !('caches' in window)) return
  // Keep the URL clean so a reload doesn't look like a second share.
  url.searchParams.delete('shared')
  window.history.replaceState(null, '', url)
  void (async () => {
    const cache = await caches.open(SHARED)
    const requests = await cache.keys()
    const paths: string[] = []
    for (const request of requests) {
      const res = await cache.match(request)
      if (!res) continue
      const name = decodeURIComponent(res.headers.get('x-name') ?? 'Shared file')
      paths.push(registerBrowserFile(new File([await res.blob()], name)))
    }
    await caches.delete(SHARED)
    if (paths.length) open(paths)
  })()
}
