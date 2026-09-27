import { describe, expect, it } from 'vitest'
import { InstantAlphaGesture, alphaMode, toleranceFor, type AlphaMode, type InstantAlphaDeps, type MaskSelection, type Prepared } from '../src/image/instantAlpha'
import { combineMasks } from '../src/core/image/alpha'
import { raster, type Raster } from '../src/core/image/raster'

const tick = () => new Promise((r) => setTimeout(r, 0))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

/** Fake engine where every flood waits until the test releases it. */
function harness(base: Uint8Array | null = null) {
  const full = raster(20, 20)
  const small = raster(10, 10)
  const prep = deferred<Prepared>()
  const floods: { r: Raster; tolerance: number; done: (m: Uint8Array) => void }[] = []
  const shown: (number | null)[] = [] // width of each drawn preview, null when cleared
  const committed: (MaskSelection | null)[] = []
  const deps: InstantAlphaDeps = {
    prepare: () => prep.promise,
    flood: (r, _x, _y, tolerance) => new Promise((done) => floods.push({ r, tolerance, done })),
    show: (mask, w) => shown.push(mask ? w : null),
    commit: (s) => committed.push(s)
  }
  const ready = () => prep.resolve({ full, preview: { raster: small, scale: 0.5 }, base })
  const mask = (n: number) => new Uint8Array(n).fill(255)
  return { full, small, prep, ready, floods, shown, committed, deps, mask }
}

describe('instant alpha gesture', () => {
  it('a click released before the pixels load still selects', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    const ending = g.end() // pointerup lands while the image is still decoding
    h.ready()
    await tick()
    const fullFlood = h.floods.find((f) => f.r === h.full)!
    fullFlood.done(h.mask(400))
    await ending
    expect(h.committed).toHaveLength(1)
    expect(h.committed[0]!.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
  })

  it('a preview finishing after release never repaints over the selection', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.ready()
    await tick()
    const ending = g.end()
    await tick()
    h.floods.find((f) => f.r === h.full)!.done(h.mask(400))
    await ending
    // The live preview answers last, e.g. after the user already pressed Delete.
    h.floods.find((f) => f.r === h.small)!.done(h.mask(100))
    await tick()
    expect(h.committed).toHaveLength(1)
    expect(h.shown).not.toContain(10)
  })

  it('Escape mid-drag clears the tint and selects nothing', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.ready()
    await tick()
    h.floods[0].done(h.mask(100))
    await tick()
    expect(h.shown).toEqual([10])
    g.cancel()
    await g.end() // the pointerup that follows is ignored
    expect(h.shown).toEqual([10, null])
    expect(h.committed).toHaveLength(0)
    expect(h.floods.some((f) => f.r === h.full)).toBe(false)
  })

  it('cancelling while the full-size flood runs drops its result', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.ready()
    const ending = g.end()
    await tick()
    g.cancel()
    h.floods.find((f) => f.r === h.full)!.done(h.mask(400))
    await ending
    expect(h.committed).toHaveLength(0)
    expect(h.shown.at(-1)).toBeNull()
  })

  it('the preview catches up to the last drag position', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.ready()
    await tick()
    g.move(50)
    g.move(100) // both arrive while the first flood is busy
    h.floods[0].done(h.mask(100))
    await tick()
    expect(h.floods).toHaveLength(2)
    expect(h.floods[1].tolerance).toBeCloseTo(toleranceFor(100))
  })

  it('release uses the tolerance of the last drag position', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.ready()
    await tick()
    g.move(120)
    const ending = g.end()
    await tick()
    const fullFlood = h.floods.find((f) => f.r === h.full)!
    expect(fullFlood.tolerance).toBeCloseTo(toleranceFor(120))
    fullFlood.done(h.mask(400))
    await ending
  })

  it('an empty result clears the tint instead of leaving a stale preview', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.ready()
    await tick()
    const ending = g.end()
    await tick()
    h.floods.find((f) => f.r === h.full)!.done(new Uint8Array(400))
    await ending
    expect(h.committed).toEqual([null])
    expect(h.shown.at(-1)).toBeNull()
  })

  it('a failed image load clears the tint', async () => {
    const h = harness()
    const g = new InstantAlphaGesture([4, 4], h.deps)
    h.prep.reject(new Error('decode failed'))
    await g.end()
    expect(h.shown).toEqual([null])
    expect(g.finished).toBe(true)
  })

  it('a tiny jiggle does not shrink the selection below a plain click', () => {
    expect(toleranceFor(1)).toBeGreaterThanOrEqual(toleranceFor(0))
    expect(toleranceFor(10_000)).toBe(0.9)
  })

  describe('Shift adds, Alt subtracts', () => {
    // Base selection: the left half of the 20×20 image.
    const leftHalf = () => new Uint8Array(400).map((_, i) => (i % 20 < 10 ? 255 : 0))
    // New region: the top half.
    const topHalf = () => new Uint8Array(400).map((_, i) => (i < 200 ? 255 : 0))

    async function drag(mode: AlphaMode, base: Uint8Array | null) {
      const h = harness(base)
      const g = new InstantAlphaGesture([4, 4], h.deps, mode)
      h.ready()
      await tick()
      h.floods[0].done(new Uint8Array(100).fill(255)) // live preview
      await tick()
      const ending = g.end()
      await tick()
      h.floods.find((f) => f.r === h.full)!.done(topHalf())
      await ending
      return h
    }

    it('reads the modifier keys', () => {
      expect(alphaMode({ shiftKey: true, altKey: false })).toBe('add')
      expect(alphaMode({ shiftKey: false, altKey: true })).toBe('subtract')
      expect(alphaMode({ shiftKey: false, altKey: false })).toBe('replace')
    })

    it('Shift-drag keeps the old selection and adds the new region', async () => {
      const h = await drag('add', leftHalf())
      const sel = h.committed[0]!
      expect(sel.mask).toEqual(combineMasks(leftHalf(), topHalf(), 'add'))
      expect(sel.mask[15 * 20 + 2]).toBe(255) // bottom-left: old selection
      expect(sel.mask[2 * 20 + 15]).toBe(255) // top-right: new region
      expect(sel.mask[15 * 20 + 15]).toBe(0) // bottom-right: neither
      expect(sel.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    })

    it('Alt-drag takes the new region out of the selection', async () => {
      const h = await drag('subtract', leftHalf())
      const sel = h.committed[0]!
      expect(sel.mask[15 * 20 + 2]).toBe(255)
      expect(sel.mask[2 * 20 + 2]).toBe(0)
      expect(sel.bounds).toEqual({ x: 0, y: 10, width: 10, height: 10 })
    })

    it('the live preview shows the combined selection', async () => {
      const h = await drag('add', leftHalf())
      expect(h.shown[0]).toBe(10) // drawn at preview size, base included
    })

    it('Shift with nothing selected just selects the region', async () => {
      const h = await drag('add', null)
      expect(h.committed[0]!.mask).toEqual(topHalf())
    })

    it('Alt with nothing selected selects nothing', async () => {
      const h = await drag('subtract', null)
      expect(h.committed).toEqual([null])
    })

    it('Escape during a Shift-drag leaves the old selection alone', async () => {
      const h = harness(leftHalf())
      const g = new InstantAlphaGesture([4, 4], h.deps, 'add')
      g.cancel()
      await g.end()
      expect(h.committed).toHaveLength(0)
      expect(h.shown).toEqual([null]) // null = redraw the current selection
    })
  })
})
