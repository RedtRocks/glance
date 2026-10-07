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
      expect(readFileSync('site/sitemap.txt', 'utf8')).toContain(`/glance/${p.slug}/\n`)
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

describe('IndexNow', () => {
  it('publishes its key file and maps changed files to their pages', async () => {
    // @ts-expect-error plain JavaScript script
    const { KEY, pagesFor, sitemapUrls } = await import('../scripts/indexnow.mjs')
    expect(readFileSync(`site/${KEY}.txt`, 'utf8').trim()).toBe(KEY)
    const site = 'https://redtrocks.github.io/glance/'
    expect(pagesFor(['site/pdf-viewer/index.html', 'src/main.tsx', 'README.md'])).toEqual([`${site}pdf-viewer/`, `${site}app/`])
    expect(pagesFor(['site/stats/index.html'])).toEqual([])
    expect(pagesFor(['site/sitemap.xml'])).toEqual(sitemapUrls())
  })
})

describe('what Bing Webmaster checks', () => {
  const files = ['site/index.html', 'site/stats/index.html', ...[...pages, HUB as Page].map((p) => `site/${p.slug}/index.html`)]
  it('every image has alt text', () => {
    const bare = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<img\b[^>]*>/g)].filter((m) => !/\balt="[^"]+"/.test(m[0])).map((m) => `${f}: ${m[0]}`))
    expect(bare).toEqual([])
  })
  it('descriptions are 25 to 160 characters', () => {
    const bad = files.filter((f) => !f.includes('/stats/')).map((f) => [f, /<meta name="description" content="([^"]*)"/.exec(readFileSync(f, 'utf8'))![1].replace(/&amp;/g, '&')]).filter(([, d]) => d.length < 25 || d.length > 160)
    expect(bad).toEqual([])
  })
  it('titles stay within 70 characters', () => {
    const long = files.map((f) => [f, /<title>(.*?)<\/title>/.exec(readFileSync(f, 'utf8'))![1].replace(/&amp;/g, '&')]).filter(([, t]) => t.length > 70)
    expect(long).toEqual([])
  })
})
