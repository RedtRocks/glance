/**
 * The browser version's start-up: install support, and the ways an operating system
 * hands files to an installed web app.
 *
 * None of this runs in the Windows app, which gets its files from Explorer instead.
 */

import { isTauri, registerBrowserFile } from '.'

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
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch(() => undefined)
  })
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
