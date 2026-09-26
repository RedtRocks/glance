/** One Instant Alpha drag: live tolerance preview while dragging, full-size mask on release. */
import { maskBounds } from '../core/image/alpha'
import type { Raster } from '../core/image/raster'
import type { Pt } from '../core/image/select'
import type { ImageSelection } from '../state/imageState'

export type MaskSelection = Extract<ImageSelection, { kind: 'mask' }>

export interface InstantAlphaDeps {
  /** Full-size pixels plus a downscaled copy for the live preview. */
  prepare(): Promise<{ full: Raster; preview: { raster: Raster; scale: number } }>
  flood(r: Raster, x: number, y: number, tolerance: number): Promise<Uint8Array>
  /** Draws (or, with null, clears) the live preview tint. */
  show(mask: Uint8Array | null, width: number, height: number): void
  commit(selection: MaskSelection): void
}

/** Dragging farther widens the color range, like Preview. `distance` is in screen pixels. */
export function toleranceFor(distance: number): number {
  return Math.min(0.9, 0.08 + distance / 250)
}

type State = 'dragging' | 'finishing' | 'done' | 'cancelled'

export class InstantAlphaGesture {
  private state: State = 'dragging'
  private tolerance = toleranceFor(0)
  private readonly ready: Promise<Awaited<ReturnType<InstantAlphaDeps['prepare']>>>
  private running = false
  private stale = false

  /** `start` is in full-image pixels. */
  constructor(
    private readonly start: Pt,
    private readonly deps: InstantAlphaDeps
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
      const { full } = await this.ready
      if (this.state !== 'finishing') return
      const mask = await this.deps.flood(full, this.start[0], this.start[1], this.tolerance)
      if (this.state !== 'finishing') return
      this.state = 'done'
      const bounds = maskBounds(mask, full.width, full.height)
      if (!bounds) return this.deps.show(null, 1, 1)
      this.deps.commit({ kind: 'mask', mask, width: full.width, height: full.height, bounds })
    } catch {
      this.cancel()
    }
  }

  /** Escape, a cancelled pointer, a tool or document switch: drop the preview, select nothing. */
  cancel(): void {
    if (this.finished) return
    this.state = 'cancelled'
    this.deps.show(null, 1, 1)
  }

  // One flood at a time; moves that arrive meanwhile collapse into one more run at the latest tolerance.
  private async preview(): Promise<void> {
    if (this.running) {
      this.stale = true
      return
    }
    this.running = true
    try {
      const { preview: pv } = await this.ready
      do {
        this.stale = false
        const mask = await this.deps.flood(pv.raster, this.start[0] * pv.scale, this.start[1] * pv.scale, this.tolerance)
        // A late preview must never paint over the final selection, a deletion or a cancel.
        if (this.state !== 'dragging') return
        this.deps.show(mask, pv.raster.width, pv.raster.height)
      } while (this.stale)
    } catch {
      this.cancel()
    } finally {
      this.running = false
    }
  }
}
