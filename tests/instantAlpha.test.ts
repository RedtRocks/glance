import { describe, expect, it } from 'vitest'
import { InstantAlphaGesture, toleranceFor, type InstantAlphaDeps, type MaskSelection } from '../src/image/instantAlpha'
import { raster, type Raster } from '../src/core/image/raster'

const tick = () => new Promise((r) => setTimeout(r, 0))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

/** Fake engine where every flood waits until the test releases it. */
function harness() {
  const full = raster(20, 20)
  const small = raster(10, 10)
  const prep = deferred<{ full: Raster; preview: { raster: Raster; scale: number } }>()
  const floods: { r: Raster; tolerance: number; done: (m: Uint8Array) => void }[] = []
  const shown: (number | null)[] = [] // width of each drawn preview, null when cleared
  const committed: MaskSelection[] = []
  const deps: InstantAlphaDeps = {
    prepare: () => prep.promise,
    flood: (r, _x, _y, tolerance) => new Promise((done) => floods.push({ r, tolerance, done })),
    show: (mask, w) => shown.push(mask ? w : null),
    commit: (s) => committed.push(s)
  }
  const ready = () => prep.resolve({ full, preview: { raster: small, scale: 0.5 } })
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
    expect(h.committed[0].bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
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
    expect(h.committed).toHaveLength(0)
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
})
