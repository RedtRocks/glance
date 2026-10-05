/**
 * Builds the browser version of Glance: the WebAssembly decoders, the app, a web
 * manifest so it can be installed, and a service worker that caches everything so it
 * keeps working offline.
 *
 *   node scripts/build-web.mjs [--out dist-web]
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const outArg = process.argv.indexOf('--out')
const out = join(root, outArg > 0 ? process.argv[outArg + 1] : 'dist-web')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

// 1. The decoders (src-tauri/src/decode) as WebAssembly.
const decoder = join(root, 'web/decoder')
run('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], decoder)
mkdirSync(join(root, 'public'), { recursive: true })
copyFileSync(join(decoder, 'target/wasm32-unknown-unknown/release/glance_web_decoder.wasm'), join(root, 'public/decoder.wasm'))

// 2. The app itself, with relative URLs so it runs from any path on any host.
rmSync(out, { recursive: true, force: true })
run('npx', ['vite', 'build', '--base', './', '--outDir', out, '--emptyOutDir'], root)

// 2b. What search engines and link previews see: a title and description for the app
// page, structured data, and plain links to the format pages for crawlers without
// JavaScript. Only the web build gets this; the Windows app keeps its plain index.html.
const { FORMAT_PAGES, HUB } = await import('./format-pages.mjs')
const site = 'https://redtrocks.github.io/glance/'
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const appTitle = 'Glance: Open and Edit Any File Online, Free and Private'
const appDescription = HUB.description
const appLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Glance',
  url: `${site}app/`,
  description: appDescription,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any (web browser)',
  browserRequirements: 'Requires a modern browser with JavaScript and WebAssembly',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  license: 'https://www.apache.org/licenses/LICENSE-2.0'
}
const indexPath = join(out, 'index.html')
writeFileSync(
  indexPath,
  readFileSync(indexPath, 'utf8')
    .replace(
      '<title>Glance</title>',
      [
        `<title>${esc(appTitle)}</title>`,
        `<meta name="description" content="${esc(appDescription)}" />`,
        `<link rel="canonical" href="${site}app/" />`,
        '<meta property="og:type" content="website" />',
        `<meta property="og:title" content="${esc(appTitle)}" />`,
        `<meta property="og:description" content="${esc(appDescription)}" />`,
        `<meta property="og:image" content="${site}assets/og.jpg" />`,
        `<meta property="og:url" content="${site}app/" />`,
        '<meta name="twitter:card" content="summary_large_image" />',
        `<script type="application/ld+json">${JSON.stringify(appLd)}</script>`
      ].join('\n    ')
    )
    .replace(
      '<div id="app"></div>',
      `<div id="app"></div>
    <noscript>
      <h1>${esc(HUB.h1)}</h1>
      <p>${esc(HUB.lead)} Glance needs JavaScript to open files.</p>
      <ul>${[HUB, ...FORMAT_PAGES].map((f) => `<li><a href="../${f.slug}/">${esc(f.title)}</a></li>`).join('')}</ul>
    </noscript>`
    )
)

// 3. Everything the app loads, listed for the service worker to cache up front.
const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(relative(out, p).split('\\').join('/'))
  }
})(out)

const all = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
// The shell has to be there before Glance can open at all; the rest (big decoders
// loaded only for some files) can follow.
const isRest = (f) => f.startsWith('pdfjs/') || f === 'decoder.wasm' || /libheif/.test(f)
const core = ['./', ...all.filter((f) => !isRest(f))]
const rest = all.filter(isRest)
// A build whose files all match serves the same cache; a changed one replaces it.
const revision = createHash('sha256').update([...all].sort().join('\n')).digest('hex').slice(0, 12)

writeFileSync(
  join(out, 'sw.js'),
  readFileSync(join(root, 'web/sw.js'), 'utf8')
    .replace('__CACHE__', `glance-${version}-${revision}`)
    .replace('__CORE__', JSON.stringify(core, null, 2))
    .replace('__REST__', JSON.stringify(rest, null, 2))
)

console.log(`Built the web version into ${relative(root, out)} (${core.length} files cached up front, ${rest.length} in the background).`)
