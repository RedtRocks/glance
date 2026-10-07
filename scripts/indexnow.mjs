#!/usr/bin/env node
/**
 * Tells Bing (and the other IndexNow search engines: Yandex, Seznam, Naver, Yep)
 * which website pages changed, so they crawl them within minutes instead of
 * whenever they next come by. Runs in pages.yml right after each deploy:
 *
 *   node scripts/indexnow.mjs [<commit before the push>]
 *
 * With a commit, only pages changed since it are sent; without one (a manual
 * run, or a commit that can't be found) every page in site/sitemap.xml is. Google
 * doesn't use IndexNow: it finds pages through the sitemap in Search Console.
 *
 * The key file (site/<key>.txt) proves the site is ours. It sits in /glance/, not
 * at the host's root, which IndexNow allows for URLs under the same folder.
 * https://www.indexnow.org/documentation
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KEY = 'dd1fe5c5a79b42f6b1ffd5d463ba7d92'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://redtrocks.github.io/glance/'

/** Every page the sitemap lists (the noindex stats page isn't one). */
export const sitemapUrls = () => [...readFileSync(join(ROOT, 'site/sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

/** The pages a set of changed repository files shows up on. */
export function pagesFor(files, urls = sitemapUrls()) {
  const out = new Set()
  for (const f of files) {
    // The page generator rewrites every page and the sitemap together.
    if (f === 'site/sitemap.xml' || f === 'site/index.html' || f.startsWith('scripts/format-pages') || f.startsWith('scripts/build-format-pages')) {
      if (f === 'site/index.html') out.add(ORIGIN)
      else urls.forEach((u) => out.add(u))
    } else if (/^site\/[^/]+\/index\.html$/.test(f)) out.add(ORIGIN + f.slice(5, -10))
    // The web app at /app/ is built from the app's own source.
    else if (/^(src|web|public)\//.test(f) || f === 'index.html' || f === 'scripts/build-web.mjs') out.add(`${ORIGIN}app/`)
  }
  return [...out].filter((u) => urls.includes(u))
}

function changedSince(before) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    try { git('cat-file', '-e', `${before}^{commit}`) } catch { git('fetch', '--depth=1', 'origin', before) }
    return git('diff', '--name-only', before, 'HEAD').split('\n').filter(Boolean)
  } catch {
    return null
  }
}

async function main() {
  const before = process.argv[2]
  const all = sitemapUrls()
  const files = before && !/^0+$/.test(before) ? changedSince(before) : null
  const urls = files ? pagesFor(files, all) : all
  if (!urls.length) return console.log('No website pages changed; nothing to send to IndexNow.')
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'redtrocks.github.io', key: KEY, keyLocation: `${ORIGIN}${KEY}.txt`, urlList: urls })
  })
  console.log(`IndexNow answered ${res.status} for ${urls.length} page(s):\n  ${urls.join('\n  ')}`)
  // 200 and 202 both mean accepted (202: the key file is still being checked).
  if (res.status !== 200 && res.status !== 202) {
    console.error(await res.text())
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
