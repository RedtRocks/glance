/**
 * The open tabs, remembered so Glance can reopen them on the next launch
 * (Settings → Reopen tabs). Pure data helpers; state/session.ts does the wiring.
 */

export interface SessionTab {
  path: string
  /** Zero-based page. */
  page: number
  /** 'fit-width' / 'fit-page' for PDFs, 'fit' for images, or a scale. */
  zoom: number | string
}

export interface Session {
  tabs: SessionTab[]
  /** Index into `tabs` of the tab that was in front. */
  active: number
}

export interface SessionSource {
  kind: string
  path: string | null
  convertedFrom?: string | null
  page: number
  zoom: number | string
  active: boolean
}

/** Only tabs backed by a file on disk can come back; duplicates collapse to the first. */
export function captureSession(open: SessionSource[]): Session {
  const tabs: SessionTab[] = []
  const seen = new Set<string>()
  let active = 0
  for (const d of open) {
    // Notice tabs explain why a file couldn't be shown; reopening them helps nobody.
    if (d.kind === 'notice') continue
    // Converted PostScript/EPS/AI files are reopened from the original.
    const path = d.path ?? d.convertedFrom ?? null
    if (!path) continue
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (d.active) active = tabs.length
    tabs.push({ path, page: Math.max(0, Math.floor(d.page) || 0), zoom: d.zoom })
  }
  return { tabs, active: tabs.length ? active : 0 }
}

/** Reads a stored session, dropping anything malformed instead of failing. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as Session).tabs)) return null
  const tabs: SessionTab[] = []
  for (const t of (data as Session).tabs as unknown[]) {
    if (!t || typeof t !== 'object') continue
    const { path, page, zoom } = t as Partial<SessionTab>
    if (typeof path !== 'string' || !path) continue
    tabs.push({
      path,
      page: typeof page === 'number' && Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0,
      zoom: (typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0) || typeof zoom === 'string' ? zoom : 'fit'
    })
  }
  if (!tabs.length) return null
  const a = (data as Session).active
  return { tabs, active: typeof a === 'number' && a >= 0 && a < tabs.length ? Math.floor(a) : 0 }
}
