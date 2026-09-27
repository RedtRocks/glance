import { describe, expect, it } from 'vitest'
import { Autosaver, dueAt, MIN_INTERVAL_MS, QUIET_MS, sameContent, type Fingerprint } from '../src/core/autosave'

/** A document with a fake clock: `content` changes by reference on every edit, like the real ones. */
class FakeDoc {
  dirty = false
  edits = 0
  content: object = {}
  forms = false
  typing = false
  writes: object[] = []
  saveDelay = 0
  declines = false
}

function setup() {
  let now = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextId = 1
  const saver = new Autosaver<FakeDoc>({
    now: () => now,
    setTimer: (fn, ms) => {
      timers.set(nextId, { at: now + ms, fn })
      return nextId++
    },
    clearTimer: (id) => void timers.delete(id),
    isDirty: (d) => d.dirty,
    setDirty: (d, v) => (d.dirty = v),
    editCount: (d) => d.edits,
    fingerprint: (d): Fingerprint => (d.forms ? null : [d.content]),
    canSave: () => true,
    mustWait: (d) => d.typing,
    save: async (d) => {
      if (d.declines) return
      const written = d.content
      if (d.saveDelay) await advance(d.saveDelay)
      d.writes.push(written)
      d.dirty = false
    },
    onError: () => undefined
  })
  /** Runs due timers in order, letting each save's promises settle. */
  async function advance(ms: number): Promise<void> {
    const end = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = Math.max(now, due[1].at)
      due[1].fn()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    now = end
  }
  const edit = (d: FakeDoc): void => {
    d.content = {}
    d.edits++
    d.dirty = true
    saver.edited(d)
  }
  return { saver, advance, edit, pending: () => timers.size }
}

describe('autosave timing', () => {
  it('waits for a quiet period, then at least a minute between saves', () => {
    expect(dueAt(1000, undefined)).toBe(1000 + QUIET_MS)
    expect(dueAt(5000, 0)).toBe(MIN_INTERVAL_MS)
    expect(dueAt(MIN_INTERVAL_MS * 2, 0)).toBe(MIN_INTERVAL_MS * 2 + QUIET_MS)
  })

  it('compares content by reference, and unknown content never matches', () => {
    const a = {}
    expect(sameContent([a, 1], [a, 1])).toBe(true)
    expect(sameContent([a], [{}])).toBe(false)
    expect(sameContent(null, null)).toBe(false)
    expect(sameContent([a], undefined)).toBe(false)
  })
})

describe('Autosaver', () => {
  it('saves once after a burst of edits, not once per edit', async () => {
    const { saver, advance, edit } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    for (let i = 0; i < 20; i++) {
      edit(d)
      await advance(1000)
    }
    expect(d.writes).toHaveLength(0)
    await advance(QUIET_MS)
    expect(d.writes).toEqual([d.content])
    expect(d.dirty).toBe(false)
  })

  it('writes at most once a minute while the user keeps pausing', async () => {
    const { saver, advance, edit } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    // An edit, then a pause just long enough to save, over and over for five minutes.
    for (let t = 0; t < 5 * 60_000; t += QUIET_MS + 1000) {
      edit(d)
      await advance(QUIET_MS + 1000)
    }
    await advance(MIN_INTERVAL_MS)
    expect(d.writes.length).toBeLessThanOrEqual(6)
    expect(d.writes.at(-1)).toBe(d.content)
  })

  it('does not write when edits were undone back to the saved content', async () => {
    const { saver, advance, edit, pending } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    const original = d.content
    edit(d)
    // Undo restores the same objects the document had before.
    d.content = original
    d.edits++
    saver.edited(d)
    expect(d.dirty).toBe(false)
    expect(pending()).toBe(0)
    await advance(MIN_INTERVAL_MS)
    expect(d.writes).toHaveLength(0)
  })

  it('does not rewrite a saved document that was only re-marked as edited', async () => {
    const { saver, advance, edit } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    edit(d)
    await advance(QUIET_MS)
    expect(d.writes).toHaveLength(1)
    d.dirty = true // e.g. an edit that changed nothing
    saver.edited(d)
    await advance(MIN_INTERVAL_MS * 2)
    expect(d.writes).toHaveLength(1)
    expect(d.dirty).toBe(false)
  })

  it('waits while the user is typing, then saves', async () => {
    const { saver, advance, edit } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    d.forms = true
    edit(d)
    d.typing = true
    await advance(QUIET_MS * 5)
    expect(d.writes).toHaveLength(0)
    d.typing = false
    await advance(QUIET_MS)
    expect(d.writes).toHaveLength(1)
  })

  it('keeps edits made during a save dirty and saves them later', async () => {
    const { saver, advance, edit } = setup()
    const d = new FakeDoc()
    d.saveDelay = 500
    saver.clean(d)
    edit(d)
    const first = d.content
    await advance(QUIET_MS + 100) // save in flight
    edit(d)
    await advance(1000)
    expect(d.writes).toEqual([first])
    expect(d.dirty).toBe(true)
    await advance(MIN_INTERVAL_MS)
    expect(d.writes.at(-1)).toBe(d.content)
    expect(d.dirty).toBe(false)
  })

  it('leaves the document alone when save declines to write', async () => {
    const { saver, advance, edit, pending } = setup()
    const d = new FakeDoc()
    d.declines = true
    saver.clean(d)
    edit(d)
    await advance(QUIET_MS)
    expect(d.dirty).toBe(true)
    expect(pending()).toBe(0)
  })

  it('cancels the countdown when the user saves', async () => {
    const { saver, advance, edit, pending } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    edit(d)
    d.dirty = false
    saver.clean(d)
    expect(pending()).toBe(0)
    await advance(QUIET_MS)
    expect(d.writes).toHaveLength(0)
  })
  it('saves at once when flushed, even mid-countdown or mid-gesture', async () => {
    const { saver, advance, edit, pending } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    edit(d)
    d.typing = true
    await saver.flush(d)
    expect(d.writes).toEqual([d.content])
    expect(d.dirty).toBe(false)
    expect(pending()).toBe(0)
    await advance(MIN_INTERVAL_MS)
    expect(d.writes).toHaveLength(1)
  })

  it('flushing waits for a save in flight, then writes newer edits', async () => {
    const { saver, advance, edit } = setup()
    const d = new FakeDoc()
    d.saveDelay = 500
    saver.clean(d)
    edit(d)
    const first = d.content
    const timer = advance(QUIET_MS + 100) // save in flight
    await Promise.resolve()
    edit(d)
    const flushed = saver.flush(d)
    await timer
    await advance(1000)
    await flushed
    expect(d.writes[0]).toBe(first)
    expect(d.writes.at(-1)).toBe(d.content)
    expect(d.dirty).toBe(false)
  })

  it('flushing a clean or unchanged document writes nothing', async () => {
    const { saver, edit } = setup()
    const d = new FakeDoc()
    saver.clean(d)
    await saver.flush(d)
    const original = d.content
    edit(d)
    d.content = original
    d.dirty = true
    await saver.flush(d)
    expect(d.writes).toHaveLength(0)
    expect(d.dirty).toBe(false)
  })
})
