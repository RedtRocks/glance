import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript data shared with the page generator
import { FORMAT_PAGES, HUB } from '../scripts/format-pages.mjs'

type Page = { slug: string; h1: string }
const pages = FORMAT_PAGES as Page[]

describe('website pages for each file type', () => {
  it('are generated and in the sitemap (run node scripts/build-format-pages.mjs)', () => {
    const sitemap = readFileSync('site/sitemap.xml', 'utf8')
    for (const p of [...pages, HUB as Page]) {
      const html = readFileSync(`site/${p.slug}/index.html`, 'utf8')
      expect(html).toContain(p.h1.replace(/&/g, '&amp;'))
      expect(sitemap).toContain(`/glance/${p.slug}/`)
    }
  })

  it('have their screenshots', () => {
    const missing = pages.flatMap((p) => [`${p.slug}.webp`, `${p.slug}-phone.webp`]).filter((f) => !existsSync(`site/assets/formats/${f}`))
    expect(missing).toEqual([])
  })

  it('only link to pages that exist', () => {
    const slugs = new Set(pages.map((p) => p.slug))
    const linked = (HUB as { groups: { items: string[][] }[] }).groups.flatMap((g) => g.items.map((i) => i[1]).filter(Boolean))
    expect(linked.filter((s) => !slugs.has(s))).toEqual([])
  })
})
