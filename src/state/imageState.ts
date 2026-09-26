import { signal } from '@preact/signals'
import type { Selection } from '../core/image/select'

/** Current pixel selection on the active image (image pixel coordinates, y down). */
export type ImageSelection = Selection | { kind: 'mask'; mask: Uint8Array; width: number; height: number; bounds: { x: number; y: number; width: number; height: number } }

export const imageSelection = signal<ImageSelection | null>(null)
export const adjustColorOpen = signal(false)
export const adjustSizeOpen = signal(false)
export const exportOpen = signal(false)
/** Straighten mode on the active image: the pending angle (degrees, clockwise) and whether to crop the corners. */
export const straighten = signal<{ angle: number; crop: boolean } | null>(null)
