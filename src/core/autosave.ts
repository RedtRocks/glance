/**
 * Autosave timing and change detection (ADR 0004), free of the app's state so it
 * can be tested with a fake clock. A document is written once edits have stopped
 * for QUIET_MS, and at most once per MIN_INTERVAL_MS, so steady work produces a
 * save (and a version) a minute rather than one per pause. Nothing is written when
 * the content is the same as what was last saved (for example after undoing back).
 */

export const QUIET_MS = 10_000
export const MIN_INTERVAL_MS = 60_000

/** When the next autosave may run, given the last edit and the last autosave. */
export function dueAt(lastEdit: number, lastSave: number | undefined): number {
  return Math.max(lastEdit + QUIET_MS, lastSave === undefined ? -Infinity : lastSave + MIN_INTERVAL_MS)
}

/**
 * Content fingerprints are the immutable parts a save writes (bytes, pixels,
 * markup lists), compared by reference. `null` means "can't tell", which never
 * counts as unchanged.
 */
export type Fingerprint = readonly unknown[] | null

export function sameContent(a: Fingerprint | undefined, b: Fingerprint | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])
}

export interface AutosaveHooks<D> {
  now(): number
  setTimer(fn: () => void, ms: number): number
  clearTimer(id: number): void
  isDirty(d: D): boolean
  setDirty(d: D, dirty: boolean): void
  /** Bumped on every edit; tells whether the document changed while it was being saved. */
  editCount(d: D): number
  fingerprint(d: D): Fingerprint
  /** False when autosave is off, the document was closed, or its file is in conflict. */
  canSave(d: D): boolean
  /** True while the user is mid-gesture (a dialog, typing into a text box or form field). */
  mustWait(d: D): boolean
  save(d: D): Promise<void>
  onError(d: D, e: unknown): void
}

export class Autosaver<D> {
  private readonly timers = new Map<D, number>()
  private readonly lastEdit = new Map<D, number>()
  private readonly lastSave = new Map<D, number>()
  private readonly saved = new Map<D, Fingerprint>()
  private readonly saving = new Set<D>()

  constructor(private readonly hooks: AutosaveHooks<D>) {}

  /** The document is clean (just opened, loaded, or saved by the user): remember what is on disk. */
  clean(d: D): void {
    if (this.saving.has(d)) return
    this.cancel(d)
    this.saved.set(d, this.hooks.fingerprint(d))
  }

  /** The document was edited: restart its countdown, or mark it clean if the edit undid everything. */
  edited(d: D): void {
    const h = this.hooks
    if (!this.saving.has(d) && sameContent(h.fingerprint(d), this.saved.get(d))) {
      this.cancel(d)
      h.setDirty(d, false)
      return
    }
    this.lastEdit.set(d, h.now())
    this.schedule(d)
  }

  forget(d: D): void {
    this.cancel(d)
    this.lastEdit.delete(d)
    this.lastSave.delete(d)
    this.saved.delete(d)
  }

  dispose(): void {
    this.timers.forEach((t) => this.hooks.clearTimer(t))
    this.timers.clear()
  }

  private cancel(d: D): void {
    const t = this.timers.get(d)
    if (t !== undefined) this.hooks.clearTimer(t)
    this.timers.delete(d)
  }

  private schedule(d: D, at = dueAt(this.lastEdit.get(d) ?? this.hooks.now(), this.lastSave.get(d))): void {
    this.cancel(d)
    this.timers.set(d, this.hooks.setTimer(() => void this.attempt(d), Math.max(0, at - this.hooks.now())))
  }

  private async attempt(d: D): Promise<void> {
    const h = this.hooks
    this.timers.delete(d)
    if (!h.isDirty(d) || !h.canSave(d)) return
    // Mid-gesture or already writing: try again once things are quiet.
    if (this.saving.has(d) || h.mustWait(d)) return this.schedule(d, h.now() + QUIET_MS)
    if (sameContent(h.fingerprint(d), this.saved.get(d))) return h.setDirty(d, false)
    const before = h.editCount(d)
    this.saving.add(d)
    try {
      await h.save(d)
    } catch (e) {
      h.onError(d, e)
      return
    } finally {
      this.saving.delete(d)
    }
    // Still dirty: save() chose not to write (pending redactions, lossy format,
    // changed on disk). The next edit tries again.
    if (h.isDirty(d)) return
    this.lastSave.set(d, h.now())
    if (h.editCount(d) !== before) {
      // Edited while the file was being written: those edits may not be on disk yet,
      // and which state was written is unknown.
      this.saved.set(d, null)
      h.setDirty(d, true)
      this.schedule(d)
    } else {
      this.saved.set(d, h.fingerprint(d))
    }
  }
}
