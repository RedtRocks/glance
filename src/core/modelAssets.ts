/**
 * Where a 3D model's referenced file (texture, .bin, .mtl) is loaded from. Files next
 * to the model and data inside it load; web addresses load only once the user says so,
 * because fetching one tells that server the model was opened (see PRIVACY.md).
 */
export interface WebAssets {
  allow: boolean
  /** Called with each web address that was held back. */
  blocked?: (url: string) => void
}

const OWN = /^(data|blob|glance):/i

export function isWebUrl(url: string): boolean {
  return /^https?:/i.test(url) && !url.startsWith('http://glance.localhost/')
}

export function modelAssetUrl(url: string, resolve: (relative: string) => string, web: WebAssets = { allow: false }): string {
  if (OWN.test(url) || url.startsWith('http://glance.localhost/')) return url
  if (isWebUrl(url)) {
    if (web.allow) return url
    web.blocked?.(url)
    return 'data:,'
  }
  // Any other scheme (file:, …) never loads; one letter is a Windows drive, not a scheme.
  if (/^[a-z][a-z0-9+.-]+:/i.test(url)) return 'data:,'
  return resolve(decodeURIComponent(url))
}

/** The sites a model wants files from, for the warning. */
export function webHosts(urls: Iterable<string>): string[] {
  const hosts = new Set<string>()
  for (const u of urls) {
    try {
      hosts.add(new URL(u).host)
    } catch {
      /* not a URL */
    }
  }
  return [...hosts].sort()
}
