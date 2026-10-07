/** Total installer downloads across GitHub releases (the About dialog's counter). */

interface ReleaseLike {
  draft?: boolean
  assets?: { name: string; download_count: number }[]
}

/** Installers and packages only; checksum files aren't downloads of Glance. */
export function countDownloads(releases: ReleaseLike[]): number {
  let total = 0
  for (const r of releases) {
    if (r.draft) continue
    for (const a of r.assets ?? []) if (/\.(exe|msi|zip|msix)$/i.test(a.name)) total += a.download_count
  }
  return total
}
