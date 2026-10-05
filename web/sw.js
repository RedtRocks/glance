/**
 * Service worker for the browser version of Glance.
 *
 * The app shell is cached on the first visit so Glance opens with no network at all.
 * The heavier pieces (the WebAssembly decoders, PDF.js's fonts and character maps)
 * are fetched in the background afterwards, and anything still missing is cached the
 * first time it is used. Files the user opens are never cached: they are read on the
 * device and never leave it.
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

/** Downloads the rest a few files at a time, so it never crowds out what the user is doing. */
async function fillCache() {
  const cache = await caches.open(CACHE)
  for (let i = 0; i < REST.length; i += 6) {
    await Promise.all(
      REST.slice(i, i + 6).map(async (file) => {
        if (await cache.match(file)) return
        await cache.add(file).catch(() => undefined)
      })
    )
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})

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
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit
      return fetch(request)
        .then((res) => {
          // Keep what the app loads on demand, so the same file works offline next time.
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return res
        })
        .catch(() => {
          // An offline navigation to any path still opens the app.
          if (request.mode === 'navigate') return caches.match('./', { ignoreSearch: true })
          throw new Error('offline')
        })
    })
  )
})
