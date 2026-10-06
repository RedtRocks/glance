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

/**
 * `offlineReady` runs the first time everything Glance needs is stored on this device:
 * once per browser, and once more for an iPhone's Home Screen app, which keeps its own copy.
 */
export function startWebApp(open: (paths: string[]) => void, offlineReady: () => void): void {
  if (isTauri) return
  registerServiceWorker(offlineReady)
  openSharedFiles(open)

  // "Open with Glance" in the operating system's file manager, once Glance is installed.
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer(({ files }) => {
    void Promise.all(files.map((handle) => handle.getFile())).then((list) => {
      if (list.length) open(list.map(registerBrowserFile))
    })
  })
}

const OFFLINE_READY = 'glance-offline-ready'

function registerServiceWorker(offlineReady: () => void): void {
  // Only over HTTPS (or localhost); without it the app still works, just not offline.
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string } | null>) => {
    if (event.data?.type !== 'offline-ready') return
    try {
      if (localStorage.getItem(OFFLINE_READY)) return
      localStorage.setItem(OFFLINE_READY, '1')
    } catch {
      return
    }
    offlineReady()
  })
  const register = (): void => {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch(() => undefined)
    // Finish any download iOS cut short when the app went to the background.
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage('fill'))
    // Ask the browser not to clear Glance's copy when the device runs low on space.
    void navigator.storage?.persist?.().catch(() => false)
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
