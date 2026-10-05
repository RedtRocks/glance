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
// The shell has to be there before Glance can open at all; the rest can follow.
const isRest = (f) => f.startsWith('pdfjs/') || f === 'decoder.wasm'
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
