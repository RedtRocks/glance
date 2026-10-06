/**
 * Service worker for the browser version of Glance.
 *
 * The app shell is cached on the first visit so Glance opens with no network at all.
 * The heavier pieces (the WebAssembly decoders, PDF.js's fonts and character maps)
 * are fetched in the background afterwards, and anything still missing is cached the
 * first time it is used. Files the user opens are never cached: they are read on the
 * device and never leave it.
 *
 * On iPhone and iPad, an app added to the Home Screen gets its own storage, separate
 * from Safari's, so it has to download everything again the first time it is opened
 * from there. Each page load asks the worker to finish any download that was cut short
 * (iOS stops a worker when the app goes to the background), and the page is told once
 * everything is stored, so it can say that Glance now works offline.
 *
 * scripts/build-web.mjs fills in the cache name and the file lists at build time.
 */

const CACHE = '__CACHE__'
/** The app itself: HTML, scripts, styles, icons. */
const CORE = __CORE__
/** Everything else, fetched once the app is usable. */
const REST = __REST__

/** Files shared to Glance from another app wait here until the page picks them up. */
const SHARED = 'glance-shared'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE && n !== SHARED).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
      .then(() => fillCache())
  )
})

/** Cached responses never depend on request headers, so Vary is ignored. */
const MATCH = { ignoreSearch: true, ignoreVary: true }

let filling = null

/**
 * Downloads whatever is missing a few files at a time, so it never crowds out what the
 * user is doing, then tells open pages when Glance can run with no network.
 */
function fillCache() {
  filling ??= (async () => {
    const cache = await caches.open(CACHE)
    const files = [...CORE, ...REST]
    let missing = 0
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(
        files.slice(i, i + 6).map(async (file) => {
          if (await cache.match(file, MATCH)) return
          await cache.add(file).catch(() => missing++)
        })
      )
    }
    if (missing) return
    for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'offline-ready' })
  })().finally(() => (filling = null))
  return filling
}

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
  if (event.data === 'fill') event.waitUntil(fillCache())
})

/** Safari refuses a page that a service worker answers with a redirected response. */
async function unredirect(res) {
  if (!res.redirected) return res
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
}

async function receiveShare(request) {
  const form = await request.formData()
  const cache = await caches.open(SHARED)
  const files = form.getAll('files').filter((f) => f instanceof File)
  await Promise.all(
    files.map((file, i) =>
      cache.put(
        new Request(`./_shared/${i}`),
        new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-name': encodeURIComponent(file.name) } })
      )
    )
  )
  return Response.redirect(`./?shared=${files.length}`, 303)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request))
    return
  }
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // Glance is one page: every launch (Home Screen, Share, Open with) gets the stored
    // copy, so it opens the same way with or without a connection.
    event.respondWith(caches.match('./', MATCH).then((hit) => hit ?? fetch(request)).then(unredirect))
    return
  }
  event.respondWith(
    caches.match(request, MATCH).then((hit) => {
      if (hit) return hit
      return fetch(request).then((res) => {
        // Keep what the app loads on demand, so the same file works offline next time.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return res
      })
    })
  )
})
