#!/usr/bin/env node
/**
 * Adds visitor statistics (Umami, https://umami.is) to every page of the built
 * website, at deploy time, so the committed pages and local previews stay free of it:
 *
 *   node scripts/add-analytics.mjs _site <umami website id>
 *
 * Umami sets no cookies and stores nothing on the visitor's device, so no cookie
 * notice is needed. Its script loads with `defer` from another site, so it never
 * holds up a page, and the web app's service worker leaves it alone (it only
 * handles Glance's own files), so a missing connection changes nothing offline.
 *
 * Besides visits, unique visitors, countries, devices and referrers, clicks on
 * these links are counted as events: Download Windows app (GitHub releases),
 * Get from Microsoft Store, and Open web app. The web app itself reports the type
 * (extension only) of files opened, edited and saved: see trackFile() in
 * src/platform/index.ts.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const [dir, id] = process.argv.slice(2)
if (!dir || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) {
  console.error('Usage: node scripts/add-analytics.mjs <site folder> <umami website id (a UUID)>')
  process.exit(1)
}

// data-domains: only the published site counts, not previews on localhost.
const snippet = `<script defer src="https://cloud.umami.is/script.js" data-website-id="${id}" data-domains="redtrocks.github.io"></script>
<script>document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href'),e=/github\\.com\\/RedtRocks\\/glance\\/releases/i.test(h)?'Download Windows app':/apps\\.microsoft\\.com\\//i.test(h)?'Get from Microsoft Store':/(^|\\/)app\\/$/.test(h)&&!/^https?:/.test(h)?'Open web app':'';if(e&&!a.hasAttribute('data-umami-event')){a.setAttribute('data-umami-event',e);a.setAttribute('data-umami-event-page',location.pathname)}})})</script>
`

let count = 0
;(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    // stats/ is the owner's download counter; their own checks shouldn't count as visits.
    if (statSync(p).isDirectory()) { if (relative(dir, p) !== 'stats') walk(p) }
    // google*.html is Search Console's verification file and must stay byte for byte.
    else if (name.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(name)) {
      const html = readFileSync(p, 'utf8')
      if (!html.includes('</head>') || html.includes('cloud.umami.is')) continue
      writeFileSync(p, html.replace('</head>', `${snippet}</head>`))
      count++
      console.log(`  ${relative(dir, p)}`)
    }
  }
})(dir)
console.log(`Added visitor statistics to ${count} pages.`)
