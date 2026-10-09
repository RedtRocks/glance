/**
 * The GitHub release page for one version: a download table built from the files
 * actually attached, that version's section of CHANGELOG.md, and install help folded
 * away. Earlier versions stay in CHANGELOG.md instead of piling up on every release.
 *
 *   node scripts/release-notes.ts <tag> [asset file or name...]   (prints the page)
 *
 * The Release workflow runs it when publishing; the Release notes workflow runs it
 * to rewrite the page of a release that's already out.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = 'https://github.com/RedtRocks/glance'
const STORE = 'https://apps.microsoft.com/detail/9N01BTLDS9X1'
const WEB_APP = 'https://redtrocks.github.io/glance/app/'

/** Body of the `## New in <version>` section, or null when CHANGELOG.md has none. */
export function versionNotes(changelog: string, version: string): string | null {
  const lines = changelog.replace(/\r/g, '').split('\n')
  const start = lines.indexOf(`## New in ${version.replace(/^v/, '')}`)
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  return lines.slice(start + 1, end).join('\n').trim()
}

interface Platform {
  label: string
  ext: string
  intel: RegExp
  arm: RegExp
}

const PLATFORMS: Platform[] = [
  { label: 'Windows 10 and 11', ext: '.exe', intel: /-windows-x64-setup\.exe$/, arm: /-windows-arm64-setup\.exe$/ },
  { label: 'Ubuntu 22.04+, Debian 12+', ext: '.deb', intel: /-linux-amd64\.deb$/, arm: /-linux-arm64\.deb$/ },
  { label: 'Fedora 42+', ext: '.rpm', intel: /-linux-x86_64\.rpm$/, arm: /-linux-aarch64\.rpm$/ },
  { label: 'Any Linux (Flatpak)', ext: '.flatpak', intel: /-linux-x86_64\.flatpak$/, arm: /-linux-aarch64\.flatpak$/ }
]

function downloadTable(tag: string, assets: string[]): string {
  const cell = (re: RegExp, ext: string) => {
    const name = assets.find((a) => re.test(a))
    return name ? `[Download ${ext}](${REPO}/releases/download/${tag}/${encodeURIComponent(name)})` : '–'
  }
  const rows = PLATFORMS.filter((p) => assets.some((a) => p.intel.test(a) || p.arm.test(a))).map(
    (p) => `| **${p.label}** | ${cell(p.intel, p.ext)} | ${cell(p.arm, p.ext)} |`
  )
  if (!rows.length) return ''
  return ['| | Intel or AMD (most PCs) | ARM |', '|---|---|---|', ...rows].join('\n')
}

function installHelp(assets: string[]): string {
  const has = (re: RegExp) => assets.some((a) => re.test(a))
  const parts: string[] = []
  if (has(/\.exe$/)) {
    parts.push(
      '**Windows.** Run the installer; it installs for your account only, without administrator rights. ' +
        "SmartScreen warns about an unknown publisher because releases aren't code-signed yet: click **More info → Run anyway**. " +
        'To open PDFs or images with Glance, pick it in **Settings → Apps → Default apps → Glance**. ' +
        "Needs Windows 10 (1809+) or 11; the installer fetches WebView2 if it's missing."
    )
  }
  if (has(/\.deb$/)) parts.push('**Ubuntu or Debian.** `sudo apt install ./Glance-…-linux-amd64.deb` (or the `arm64` file).')
  if (has(/\.rpm$/)) parts.push('**Fedora.** `sudo dnf install ./Glance-…-linux-x86_64.rpm` (or the `aarch64` file).')
  if (has(/\.flatpak$/)) parts.push('**Any Linux (Flatpak).** `flatpak install --user ./Glance-…-linux-x86_64.flatpak` (or the `aarch64` file). PostScript files need the .deb or RPM.')
  // Releases before 0.6.6 kept the Linux hashes in a second file.
  const sums = assets.find((a) => a === 'SHA256SUMS.txt')
  const linuxSums = assets.find((a) => a === 'SHA256SUMS-linux.txt') ?? sums
  if (sums) {
    const linux = has(/\.(deb|rpm|flatpak)$/) && linuxSums ? `, or \`sha256sum -c --ignore-missing ${linuxSums}\` on Linux` : ''
    parts.push(`**Check a download.** Its SHA-256 hash is in \`${sums}\`${linuxSums !== sums ? ` and \`${linuxSums}\`` : ''}: run \`Get-FileHash\` in PowerShell${linux}.`)
  }
  parts.push(
    `**Which processor?** Most PCs are Intel or AMD. ARM means Snapdragon laptops, Surface Pro X and similar; ` +
      'on Windows, **Settings → System → About → System type** says which.'
  )
  return parts.join('\n\n')
}

/** The whole release page for `tag`, or null when CHANGELOG.md has no section for it. */
export function releaseBody(changelog: string, tag: string, assets: string[]): string | null {
  const version = tag.replace(/^v/, '')
  const notes = versionNotes(changelog, version)
  if (notes === null) return null
  const names = assets.map((a) => basename(a))
  const table = downloadTable(tag, names)
  return [
    'Glance is a free, open-source viewer and editor for PDFs, images, camera RAW and 3D models, inspired by macOS Preview.',
    ...(table ? [table] : []),
    `Also on the [Microsoft Store](${STORE}), which keeps it updated, and [in your browser](${WEB_APP}) with nothing to install.`,
    `## New in ${version}`,
    notes,
    `<details>\n<summary><b>Install help</b></summary>\n\n${installHelp(names)}\n\n</details>`,
    `[Earlier versions](${REPO}/blob/main/CHANGELOG.md) · [All features](${REPO}#features) · [Privacy](${REPO}/blob/main/PRIVACY.md)`
  ].join('\n\n') + '\n'
}

function main(args: string[]): void {
  const [tag, ...assets] = args
  if (!tag) {
    console.error('usage: release-notes.ts <tag> [asset file or name...]')
    process.exit(2)
  }
  const body = releaseBody(readFileSync('CHANGELOG.md', 'utf8'), tag, assets)
  if (body === null) {
    console.error(`CHANGELOG.md has no '## New in ${tag.replace(/^v/, '')}' section.`)
    process.exit(1)
  }
  process.stdout.write(body)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
