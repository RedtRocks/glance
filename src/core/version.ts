/** Release version comparison ("v0.10.1" > "0.9.3"); pre-release tags sort before the release. */
export function parseVersion(v: string): [number, number, number, string] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([\w.]+))?$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0), m[4] ?? ''] : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number)
  // Same numbers: a release beats its pre-release; otherwise not newer.
  return a[3] === '' && b[3] !== ''
}
