#!/usr/bin/env node
/**
 * Writes one landing page per file type into site/<slug>/index.html (for searches
 * like "open HEIC online"), plus site/sitemap.xml. The pages reuse the landing
 * page's styles and header, so a change to site/index.html carries over the next
 * time this runs:
 *
 *   node scripts/build-format-pages.mjs
 *
 * The pages are committed, so the site keeps needing no build step.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORMAT_PAGES, HUB } from './format-pages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'site')
const ORIGIN = 'https://redtrocks.github.io/glance/'
const TONES = ['#6312f6', '#f258a8', '#f47933', '#f8d32c']

const index = readFileSync(join(SITE, 'index.html'), 'utf8')
/** The landing page's font face and Wollo styles, with asset paths one folder up. */
const styles = /<style>([\s\S]*?)<\/style>/.exec(index)[1].replaceAll('url("assets/', 'url("../assets/')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const json = (o) => JSON.stringify(o, null, 1).replace(/</g, '\\u003c')

/** Questions every page answers, after the format's own (`name` null on the all-files page). */
function commonQuestions(name) {
  const files = name ? `${name} files` : 'files'
  return [
    [name ? `Is Glance's ${name} viewer free?` : 'Is Glance free?', 'Yes. Glance is free and open source under the Apache 2.0 licence, with no account, adverts or watermarks.'],
    [`Are my ${files} uploaded anywhere?`, 'No. Glance opens files on your own device, in your browser or in the Windows app. Nothing is sent to a server, so it is safe for private documents.'],
    ['Does it work offline?', 'Yes. Install Glance from your browser (Add to Home Screen on a phone) and it opens files with no internet connection.'],
    [`Can I open ${files} on iPhone, Android or Mac?`, 'Yes. The browser version works in Safari, Chrome, Edge and Firefox on phones, tablets and computers. The Windows app adds Explorer thumbnails and opening files with a double-click.']
  ]
}

/** The page around each landing page's content: head, styles, header and footer. */
function frame({ title, description, url, ld, navCta, main }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e0d12" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="../assets/icon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Glance">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ORIGIN}assets/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${json(ld)}</script>
<link rel="preload" href="../assets/urbanist-latin.woff2" as="font" type="font/woff2" crossorigin>
<script>(function(){try{var t=localStorage.getItem('glance-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();</script>
<style>${styles}
/* Format pages */
.crumbs{display:flex;gap:8px;align-items:center;font-size:15px;line-height:20px;color:var(--ink-muted)}
.crumbs a{color:var(--ink-muted);text-decoration:none}.crumbs a:hover{color:var(--accent)}
.ext{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:9999px;background:var(--surface-subtle);font-size:15px;line-height:20px}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.step{border-radius:28px;padding:32px;display:flex;flex-direction:column;gap:12px;min-height:260px;color:var(--on-block)}
.step .n{font-size:64px;line-height:1;letter-spacing:-2px;margin-bottom:auto}
.can{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.can>div{border-radius:20px;padding:28px;background:var(--surface-subtle);display:flex;flex-direction:column;gap:10px}
.faq{max-width:840px;margin:0 auto;border-top:1px solid var(--divider)}
.faq details{border-bottom:1px solid var(--divider)}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:24px;align-items:center;padding:24px 4px;font-size:20px;line-height:26px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-size:28px;line-height:1;transition:transform 200ms cubic-bezier(.16,1,.3,1)}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{padding:0 4px 24px;color:var(--ink-muted)}
.more{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:960px;margin:0 auto}
.more a{text-decoration:none}
.dropzone{display:flex;flex-direction:column;align-items:center;gap:16px;padding:56px 24px;border-radius:48px;background:var(--surface-subtle);box-shadow:inset 0 0 0 2px var(--divider);transition:box-shadow 200ms,background-color 200ms}
.dropzone.dragging{box-shadow:inset 0 0 0 3px var(--accent);background:var(--surface)}
.drop-stack{position:relative;width:120px;height:120px;margin-bottom:8px}
.drop-stack span{position:absolute;inset:0;border-radius:28px;display:grid;place-items:center;box-shadow:inset 0 0 0 1px var(--divider)}
.drop-stack img{width:56px;height:56px}
.groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.group{border-radius:28px;padding:28px;box-shadow:inset 0 0 0 1px var(--divider);display:flex;flex-direction:column;gap:16px}
.group .title{display:flex;align-items:center;gap:10px}
a.fchip{text-decoration:none}a.fchip:hover{color:var(--accent)}
@media (max-width:960px){.groups{grid-template-columns:minmax(0,1fr)}.fslab{aspect-ratio:4/5 !important}.fslab picture{display:block;height:100%}.steps,.can{grid-template-columns:minmax(0,1fr)}.step{min-height:0}.step .n{font-size:48px;margin-bottom:12px}}
</style>
<script defer src="../assets/download.js"></script>
</head>
<body>
<div class="w">

<header style="position: sticky; top: 0; z-index: 50; padding: 16px 0 8px; background: var(--header-bg); backdrop-filter: blur(12px)">
<div class="wrap">
<nav aria-label="Main" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--surface-subtle); border-radius: 10px; padding: 8px 8px 8px 16px">
<a href="../" style="display: flex; align-items: center; gap: 10px; text-decoration: none; font-size: 26px; letter-spacing: -0.5px">
<img src="../assets/icon.svg" alt="Glance logo" style="width: 30px; height: 30px">
<span>glance</span>
</a>
<div style="display: flex; gap: 8px">
<button type="button" class="btn btn-sec theme-toggle" id="theme-toggle" aria-label="Switch to dark mode" title="Switch theme" style="min-height: 44px; width: 44px; padding: 0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="i-moon" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path><g class="i-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></g></svg></button>
<a class="btn btn-sec hide-sm" href="https://github.com/RedtRocks/glance/releases/latest" style="min-height: 44px; padding: 0 18px">Windows App</a>
<a class="btn btn-ink" href="../app/" data-open-file style="min-height: 44px; padding: 0 18px">${esc(navCta)}</a>
</div>
</nav>
</div>
</header>

${main}
<footer style="border-top: 1px solid var(--divider)">
<div class="wrap" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 24px; padding-top: 40px; padding-bottom: 48px">
<a href="../" style="display: flex; align-items: center; gap: 10px; text-decoration: none; font-size: 26px">
<img src="../assets/icon.svg" alt="" style="width: 28px; height: 28px">
<span>glance</span>
</a>
<div style="display: flex; flex-wrap: wrap; gap: 24px; font-size: 20px; line-height: 24px">
<a href="../app/" style="text-decoration: none">Open in Browser</a>
<a href="https://github.com/RedtRocks/glance" style="text-decoration: none">GitHub</a>
<a href="https://github.com/RedtRocks/glance/blob/main/PRIVACY.md" style="text-decoration: none">Privacy</a>
<a href="https://github.com/RedtRocks/glance/blob/main/LICENSE" style="text-decoration: none">Apache-2.0</a>
</div>
</div>
</footer>

</div>
<script src="../assets/open.js" defer></script>
<script>
(function () {
  var root = document.documentElement, mq = window.matchMedia('(prefers-color-scheme: dark)'), b = document.getElementById('theme-toggle');
  var isDark = function () { var t = root.getAttribute('data-theme'); return t ? t === 'dark' : mq.matches; };
  var sync = function () { var d = isDark(); root.classList.toggle('dark', d); b.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); };
  b.addEventListener('click', function () { var n = isDark() ? 'light' : 'dark'; root.setAttribute('data-theme', n); try { localStorage.setItem('glance-theme', n); } catch (e) {} sync(); });
  if (mq.addEventListener) mq.addEventListener('change', sync);
  sync();
})();
</script>
</body>
</html>
`
}

function page(f, all) {
  const url = `${ORIGIN}${f.slug}/`
  const exts = f.exts.map((e) => `.${e}`).join(', ')
  const questions = [...f.faq, ...commonQuestions(f.name)]
  const others = all.filter((o) => o.slug !== f.slug)
  const steps = [
    ['Open Glance', 'Open Glance in your browser, or install the free Windows app.'],
    [`Choose your ${f.name} file`, `Tap Choose a File, or drag the ${f.name} file onto the page. It stays on your device.`],
    [f.stepThree[0], f.stepThree[1]]
  ]
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: `Glance ${f.title}`,
      url,
      description: f.description,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any (web browser), Windows 10, Windows 11',
      browserRequirements: 'Requires a modern browser with JavaScript and WebAssembly',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://www.apache.org/licenses/LICENSE-2.0'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: `How to open a ${f.name} file`,
      step: steps.map(([name, text], i) => ({ '@type': 'HowToStep', position: i + 1, name, text }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: questions.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Glance', item: ORIGIN },
        { '@type': 'ListItem', position: 2, name: 'All File Types', item: `${ORIGIN}${HUB.slug}/` },
        { '@type': 'ListItem', position: 3, name: f.title, item: url }
      ]
    }
  ]

  return frame({ title: f.pageTitle, description: f.description, url, ld, navCta: 'Open File', main: `<main>
<section id="top" style="padding-top: 48px">
<div class="wrap" style="display: flex; flex-direction: column; align-items: center; gap: 24px">
<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Glance</a><span aria-hidden="true">/</span><a href="../${HUB.slug}/">All File Types</a><span aria-hidden="true">/</span><span>${esc(f.title)}</span></nav>
<h1 class="h1" style="max-width: 900px">${esc(f.h1)}</h1>
<p class="body" style="max-width: 640px; text-align: center; color: var(--ink-muted)">${esc(f.lead)}</p>
<div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center">
<a class="btn btn-ink" href="../app/" data-open-file>Open ${esc(f.article ?? "a")} ${esc(f.name)} File</a>
<a class="btn btn-sec" href="https://github.com/RedtRocks/glance/releases/latest">Get the Windows App</a>
</div>
<div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center">
${f.exts.map((e, i) => `<span class="ext"><span class="dots" style="color: ${TONES[i % 4]}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>.${esc(e)}</span>`).join('\n')}
</div>
</div>
<div class="wrap" style="margin-top: 56px">
<div class="slab fslab" style="position: relative; height: 620px">
<div style="position: absolute; inset: 0"><div style="width: 100%; height: 100%; background: ${f.tones[0]}; border-radius: 48px; transform: rotate(-3deg)"></div></div>
<div style="position: absolute; inset: 0"><div style="width: 100%; height: 100%; background: ${f.tones[1]}; border-radius: 48px; transform: rotate(2deg)"></div></div>
<div style="position: absolute; inset: 0; padding: 48px 48px 0; border-radius: 48px; overflow: hidden; background: var(--surface-subtle)">
<div style="border-radius: 20px 20px 0 0; overflow: hidden; background: #ffffff; height: 100%">
<picture><source media="(max-width: 960px)" srcset="../assets/formats/${f.slug}-phone.webp"><img src="../assets/formats/${f.slug}.webp" alt="${esc(f.shotAlt)}" style="width: 100%; height: 100%; object-fit: cover; object-position: center top; display: block"></picture>
</div>
</div>
</div>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 48px">
<h2 class="h2">How to Open a ${esc(f.name)} File</h2>
<ol class="steps" style="list-style: none; margin: 0; padding: 0">
${steps
  .map(
    ([name, text], i) => `<li class="step" style="background: ${['#f8d32c', '#f258a8', '#f47933'][i]}">
<span class="n" aria-hidden="true">${i + 1}</span>
<p class="title">${esc(name)}</p>
<p class="body">${esc(text)}</p>
</li>`
  )
  .join('\n')}
</ol>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 48px">
<h2 class="h2">What You Can Do With ${esc(f.name)} Files</h2>
<div class="can">
${f.can.map(([title, body], i) => `<div><span class="dots" style="color: ${TONES[i % 4]}" aria-hidden="true"><i></i><i></i><i></i><i></i></span><p class="title">${esc(title)}</p><p class="body" style="color: var(--ink-muted)">${esc(body)}</p></div>`).join('\n')}
</div>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap">
<div class="duo">
<div style="background: var(--night); color: #ffffff; border-radius: 28px; padding: 40px; display: flex; flex-direction: column; gap: 16px; justify-content: flex-end; min-height: 320px">
<p class="h2" style="text-align: left; max-width: 640px">Your ${esc(f.name)} Files Never Leave Your Device</p>
<p class="body" style="color: #d4d4d4; max-width: 560px">Most online viewers upload your file to their server. Glance reads it right in your browser, so nothing is sent anywhere, and it keeps working offline.</p>
</div>
<div style="background: #7182e7; color: #ffffff; border-radius: 28px; padding: 40px; display: flex; flex-direction: column; gap: 16px; justify-content: flex-end">
<p class="h3">Free and Open Source</p>
<p class="body">No account, no adverts, no watermark. Read every line of the code on GitHub.</p>
<a href="https://github.com/RedtRocks/glance" style="color: #ffffff; font-size: 17px">View the Source</a>
</div>
</div>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 40px">
<h2 class="h2">Questions About ${esc(f.name)} Files</h2>
<div class="faq">
${questions.map(([q, a]) => `<details><summary>${esc(q)}</summary><p class="body">${esc(a)}</p></details>`).join('\n')}
</div>
</div>
</section>

<section style="padding: 120px 0 80px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 32px; align-items: center">
<h2 class="h3">Glance Also Opens</h2>
<div class="more">
${others.map((o, i) => `<a class="fchip" href="../${o.slug}/"><span class="dots" style="color: ${TONES[i % 4]}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${esc(o.name)}</a>`).join('\n')}
</div>
<a href="../${HUB.slug}/" style="font-size: 17px; line-height: 26px">See Every File Type Glance Opens</a>
<p class="body" style="color: var(--ink-muted); text-align: center">Supported extensions: ${esc(exts)}</p>
</div>
</section>
</main>
` })
}

/** The "open any file" page: a drop zone that opens files in the app, and every kind of file Glance opens. */
function hub(h) {
  const url = `${ORIGIN}${h.slug}/`
  const questions = commonQuestions(null)
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Glance',
      url,
      description: h.description,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any (web browser), Windows 10, Windows 11',
      browserRequirements: 'Requires a modern browser with JavaScript and WebAssembly',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://www.apache.org/licenses/LICENSE-2.0'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: questions.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Glance', item: ORIGIN },
        { '@type': 'ListItem', position: 2, name: 'All File Types', item: url }
      ]
    }
  ]
  const main = `<main>
<section id="top" style="padding-top: 48px">
<div class="wrap" style="display: flex; flex-direction: column; align-items: center; gap: 24px">
<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Glance</a><span aria-hidden="true">/</span><span>All File Types</span></nav>
<h1 class="h1" style="max-width: 900px">${esc(h.h1)}</h1>
<p class="body" style="max-width: 680px; text-align: center; color: var(--ink-muted)">${esc(h.lead)}</p>
</div>
<div class="wrap" style="margin-top: 48px">
<div class="dropzone" data-drop>
<div class="drop-stack" aria-hidden="true"><span style="background: #f8d32c; transform: rotate(-8deg)"></span><span style="background: #f258a8; transform: rotate(6deg)"></span><span style="background: var(--surface)"><img src="../assets/icon.svg" alt=""></span></div>
<p class="h3">Drop Files Here</p>
<p class="body" style="color: var(--ink-muted)">or</p>
<a class="btn btn-ink" href="../app/" data-open-file>Choose Files</a>
<p class="body" style="color: var(--ink-muted); text-align: center">Files open in Glance on this device. Nothing is uploaded, and it works offline once installed.</p>
</div>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 48px">
<h2 class="h2">View and Edit, Not Just View</h2>
<div class="steps">
${h.edit.map(([title, body, tone]) => `<div class="step" style="background: ${tone}"><p class="h3" style="margin-bottom: auto">${esc(title)}</p><p class="body">${esc(body)}</p></div>`).join('\n')}
</div>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 48px">
<h2 class="h2">Every File Type Glance Opens</h2>
<div class="groups">
${h.groups
  .map(
    (g) => `<div class="group">
<p class="title"><span class="dots" style="color: ${g.tone}" aria-hidden="true"><i></i><i></i><i></i><i></i></span> ${esc(g.name)}</p>
<div class="more" style="justify-content: flex-start">
${g.items.map(([name, slug]) => (slug ? `<a class="fchip" href="../${slug}/">${esc(name)}</a>` : `<span class="fchip">${esc(name)}</span>`)).join('\n')}
</div>
</div>`
  )
  .join('\n')}
</div>
<a href="https://github.com/RedtRocks/glance/blob/main/docs/FORMATS.md" style="font-size: 17px; line-height: 26px; text-align: center">See the Full List of Extensions</a>
</div>
</section>

<section style="padding-top: 120px">
<div class="wrap">
<div class="duo">
<div style="background: var(--night); color: #ffffff; border-radius: 28px; padding: 40px; display: flex; flex-direction: column; gap: 16px; justify-content: flex-end; min-height: 320px">
<p class="h2" style="text-align: left; max-width: 640px">Your Files Never Leave Your Device</p>
<p class="body" style="color: #d4d4d4; max-width: 560px">Most online viewers upload your file to their server. Glance reads it right in your browser, so nothing is sent anywhere, and it keeps working offline.</p>
</div>
<div style="background: #7182e7; color: #ffffff; border-radius: 28px; padding: 40px; display: flex; flex-direction: column; gap: 16px; justify-content: flex-end">
<p class="h3">Free and Open Source</p>
<p class="body">No account, no adverts, no watermark. Read every line of the code on GitHub.</p>
<a href="https://github.com/RedtRocks/glance" style="color: #ffffff; font-size: 17px">View the Source</a>
</div>
</div>
</div>
</section>

<section style="padding: 120px 0 80px">
<div class="wrap" style="display: flex; flex-direction: column; gap: 40px">
<h2 class="h2">Questions</h2>
<div class="faq">
${questions.map(([q, a]) => `<details><summary>${esc(q)}</summary><p class="body">${esc(a)}</p></details>`).join('\n')}
</div>
</div>
</section>
</main>
`
  return frame({ title: h.pageTitle, description: h.description, url, ld, navCta: 'Open Files', main })
}

function sitemap(pages, today) {
  const urls = [{ loc: ORIGIN }, { loc: `${ORIGIN}app/` }, { loc: `${ORIGIN}${HUB.slug}/` }, ...pages.map((f) => ({ loc: `${ORIGIN}${f.slug}/` }))]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n')}
</urlset>
`
}

export function build(today = new Date().toISOString().slice(0, 10)) {
  for (const f of FORMAT_PAGES) {
    mkdirSync(join(SITE, f.slug), { recursive: true })
    writeFileSync(join(SITE, f.slug, 'index.html'), page(f, FORMAT_PAGES))
  }
  mkdirSync(join(SITE, HUB.slug), { recursive: true })
  writeFileSync(join(SITE, HUB.slug, 'index.html'), hub(HUB))
  writeFileSync(join(SITE, 'sitemap.xml'), sitemap(FORMAT_PAGES, today))
  return FORMAT_PAGES.length + 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`${build()} pages written to site/`)
