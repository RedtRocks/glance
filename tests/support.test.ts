import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SUPPORT_PAGE_URL } from '../src/core/support'
// @ts-expect-error plain JavaScript module shared with the website
import { LINKS, regionFor, checkoutFor, rankSupporters, colourFor } from '../site/support/wall.js'

describe('Support page', () => {
  it('opens the website page from the app', () => {
    expect(SUPPORT_PAGE_URL).toBe('https://redtrocks.github.io/glance/support/')
  })

  it('only links to the two payment services it was set up with', () => {
    // A wrong link here loses real donations, so any change has to be deliberate.
    for (const url of Object.values(LINKS) as string[]) {
      if (!url) continue
      const u = new URL(url)
      expect(u.protocol).toBe('https:')
      expect(u.hostname === 'github.com' ? u.pathname.startsWith('/sponsors/RedtRocks') : /(^|\.)playto\.so$/.test(u.hostname)).toBe(true)
    }
  })

  it('sends India to the local checkout and everyone else to the world one', () => {
    expect(regionFor('Asia/Kolkata')).toBe('in')
    expect(regionFor('Asia/Calcutta')).toBe('in')
    expect(regionFor('America/New_York')).toBe('world')
    expect(regionFor(undefined)).toBe('world')
    const links = { indiaOnce: 'a', indiaMonthly: 'b', worldOnce: 'c', worldMonthly: 'd' }
    expect(checkoutFor('in', 'once', links)).toBe('a')
    expect(checkoutFor('in', 'monthly', links)).toBe('b')
    expect(checkoutFor('world', 'once', links)).toBe('c')
    expect(checkoutFor('world', 'monthly', links)).toBe('d')
    expect(checkoutFor('in', 'once', { ...links, indiaOnce: '' })).toBe('')
  })

  it('ranks supporters by total without exposing amounts', () => {
    const list = [
      { name: 'Asha', total: 5, monthly: false, lastGiven: '2026-09-02' },
      { name: 'Ben', total: 20, monthly: true, lastGiven: '2026-10-01' },
      { name: null, total: 20, monthly: false, lastGiven: '2026-10-03' }
    ]
    const now = new Date('2026-10-09T12:00:00Z')
    const all = rankSupporters(list, 'all', now)
    expect(all).toEqual([
      { rank: 1, name: 'Ben', monthly: true },
      { rank: 2, name: null, monthly: false },
      { rank: 3, name: 'Asha', monthly: false }
    ])
    expect(all.some((s: object) => 'total' in s)).toBe(false)
    expect(rankSupporters(list, 'month', now).map((s: { name: string | null }) => s.name)).toEqual(['Ben', null])
    expect(list[0].name).toBe('Asha')
  })

  it('gives each name a steady colour', () => {
    expect(colourFor('Ben')).toBe(colourFor('Ben'))
    expect(colourFor(null)).toBe('#a9a6b3')
  })

  it('starts with an empty, valid supporters list', () => {
    const data = JSON.parse(readFileSync('site/support/supporters.json', 'utf8'))
    expect(Array.isArray(data.supporters)).toBe(true)
  })
})
