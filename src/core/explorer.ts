/**
 * Explorer's right-click verbs (see src-tauri/src/explorer.rs): Combine into PDF and
 * Remove Location Info. Pure helpers, unit tested.
 */

export type ShellAction = 'combine' | 'remove-location'

export interface ShellRequest {
  action: ShellAction
  files: string[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function base(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Explorer launches the verb once per file in no particular order, so the pages follow
 * the file names the way Explorer sorts them ("Scan 2" before "Scan 10").
 */
export function combineOrder(paths: string[]): string[] {
  return [...paths].sort((a, b) => collator.compare(base(a), base(b)) || collator.compare(a, b))
}

/** The new PDF is named after the first file: "Scan 1.jpg" → "Scan 1 (combined).pdf". */
export function combinedName(first: string): string {
  const stem = base(first).replace(/\.[^.]+$/, '') || 'Combined'
  return `${stem} (combined).pdf`
}

/** Formats whose location info Glance can remove (see src-tauri/src/metadata.rs). */
export function canRemoveLocation(path: string): boolean {
  return /\.(jpe?g|jfif|jpe|png|tiff?|webp|heic|heif|jxl)$/i.test(path)
}
