export type PathPolicy = 'windows' | 'posix'

/** Windows folds separators and case; POSIX keeps case and literal backslashes. */
export function pathKey(path: string, policy: PathPolicy): string {
  return policy === 'windows' ? path.split(/[\\/]/).filter(Boolean).join('/').toLowerCase() : path.replace(/\/{2,}/g, '/')
}

export function samePath(a: string, b: string, policy: PathPolicy): boolean {
  return pathKey(a, policy) === pathKey(b, policy)
}
