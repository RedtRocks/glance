/** One Instant Alpha drag: live tolerance preview while dragging, full-size mask on release. */
import { combineMasks, maskBounds, resizeMask } from '../core/image/alpha'
import type { Raster } from '../core/image/raster'
import type { Pt } from '../core/image/select'
import type { ImageSelection } from '../state/imageState'

export type MaskSelection = Extract<ImageSelection, { kind: 'mask' }>

/** Plain drag replaces the selection; Shift-drag adds to it; Alt-drag subtracts from it. */
export type AlphaMode = 'replace' | 'add' | 'subtract'

export function alphaMode(e: { shiftKey: boolean; altKey: boolean }): AlphaMode {
  return e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace'
}

export interface Prepared {
  full: Raster
  preview: { raster: Raster; scale: number }
  /** The selection being added to or subtracted from, as a full-size mask (add/subtract only). */
  base?: Uint8Array | null
}

export interface InstantAlphaDeps {
  /** Full-size pixels plus a downscaled copy for the live preview. */
  prepare(): Promise<Prepared>
  flood(r: Raster, x: number, y: number, tolerance: number): Promise<Uint8Array>
  /** Draws the live preview tint; null means go back to showing the current selection. */
  show(mask: Uint8Array | null, width: number, height: number): void
  /** The drag's result; null when it leaves nothing selected. */
  commit(selection: MaskSelection | null): void
}

/** Dragging farther widens the color range, like Preview. `distance` is in screen pixels. */
export function toleranceFor(distance: number): number {
  return Math.min(0.9, 0.08 + distance / 250)
}

type State = 'dragging' | 'finishing' | 'done' | 'cancelled'

export class InstantAlphaGesture {
  private state: State = 'dragging'
  private tolerance = toleranceFor(0)
  private readonly ready: Promise<Prepared>
  private previewBase: Uint8Array | null | undefined
  private running = false
  private stale = false

  /** `start` is in full-image pixels. */
  constructor(
    private readonly start: Pt,
    private readonly deps: InstantAlphaDeps,
    private readonly mode: AlphaMode = 'replace'
  ) {
    this.ready = deps.prepare()
    this.ready.catch(() => this.cancel())
    void this.preview()
  }

  get finished(): boolean {
    return this.state === 'done' || this.state === 'cancelled'
  }

  move(distance: number): void {
    if (this.state !== 'dragging') return
    this.tolerance = toleranceFor(distance)
    void this.preview()
  }

  /** Pointer released: selects the region at the final tolerance on the full-size image. */
  async end(): Promise<void> {
    if (this.state !== 'dragging') return
    this.state = 'finishing'
    try {
      const { full, base } = await this.ready
      if (this.state !== 'finishing') return
      const region = await this.deps.flood(full, this.start[0], this.start[1], this.tolerance)
      if (this.state !== 'finishing') return
      this.state = 'done'
      const mask = this.combine(region, base)
      const bounds = maskBounds(mask, full.width, full.height)
      this.deps.commit(bounds ? { kind: 'mask', mask, width: full.width, height: full.height, bounds } : null)
      if (!bounds) this.deps.show(null, 1, 1)
    } catch {
      this.cancel()
    }
  }

  /** Escape, a cancelled pointer, a tool or document switch: drop the preview, keep the selection as it was. */
  cancel(): void {
    if (this.finished) return
    this.state = 'cancelled'
    this.deps.show(null, 1, 1)
  }

  private combine(region: Uint8Array, base: Uint8Array | null | undefined): Uint8Array {
    if (this.mode === 'replace' || !base) return this.mode === 'subtract' ? new Uint8Array(region.length) : region
    return combineMasks(base, region, this.mode)
  }

  // One flood at a time; moves that arrive meanwhile collapse into one more run at the latest tolerance.
  private async preview(): Promise<void> {
    if (this.running) {
      this.stale = true
      return
    }
    this.running = true
    try {
      const { full, preview: pv, base } = await this.ready
      const { width: w, height: h } = pv.raster
      if (this.previewBase === undefined) this.previewBase = base && (pv.scale === 1 ? base : resizeMask(base, full.width, full.height, w, h))
      do {
        this.stale = false
        const region = await this.deps.flood(pv.raster, this.start[0] * pv.scale, this.start[1] * pv.scale, this.tolerance)
        // A late preview must never paint over the final selection, a deletion or a cancel.
        if (this.state !== 'dragging') return
        this.deps.show(this.combine(region, this.previewBase), w, h)
      } while (this.stale)
    } catch {
      this.cancel()
    } finally {
      this.running = false
    }
  }
}
