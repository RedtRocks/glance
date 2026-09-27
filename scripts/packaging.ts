/**
 * Package manifests for winget and the Microsoft Store (MSIX), and the installer's
 * Default apps registration, generated from src-tauri/tauri.conf.json so the version,
 * description and file types never drift. See packaging/README.md.
 *
 *   node scripts/packaging.ts winget <tag> <SHA256SUMS.txt> <YYYY-MM-DD> <out dir>
 *   node scripts/packaging.ts msix <x64|arm64> <out AppxManifest.xml>
 *   node scripts/packaging.ts nsis [out .nsh]   (default: src-tauri/windows/default-apps.nsh)
 *
 * The MSIX identity comes from the MSIX_IDENTITY_NAME, MSIX_PUBLISHER and
 * MSIX_PUBLISHER_DISPLAY_NAME environment variables (Partner Center → Product
 * identity). Without them a local test identity is used, which the Store rejects.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const WINGET_ID = 'RedtRocks.Glance'
const WINGET_SCHEMA = '1.10.0'
const REPO = 'https://github.com/RedtRocks/glance'

export interface TauriConf {
  productName: string
  version: string
  bundle: {
    publisher: string
    copyright: string
    shortDescription: string
    longDescription: string
    license: string
    fileAssociations: { ext: string[]; name: string; description?: string }[]
  }
}

export function readTauriConf(root = '.'): TauriConf {
  return JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')) as TauriConf
}

/** Every file extension Glance opens, lower case, without dots, in config order. */
export function extensions(conf: TauriConf): string[] {
  return [...new Set(conf.bundle.fileAssociations.flatMap((a) => a.ext.map((e) => e.toLowerCase())))]
}

/** Installer file name the Release workflow gives each architecture. */
export function installerName(tag: string, arch: 'x64' | 'arm64'): string {
  return `Glance-${tag}-windows-${arch}-setup.exe`
}

/** Parses `sha256sum` output: file name → upper-case hash (winget's convention). */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m) sums.set(m[2], m[1].toUpperCase())
  }
  return sums
}

function yamlString(s: string): string {
  return /^[\w .,()/+-]+$/.test(s) && !/^[\d.]+$/.test(s) && !/: /.test(s) ? s : JSON.stringify(s)
}

function yamlList(items: string[], indent = ''): string {
  return items.map((i) => `${indent}- ${yamlString(i)}`).join('\n')
}

function header(type: string): string {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${WINGET_SCHEMA}.schema.json\n\n`
}

/**
 * The three winget manifests (version, installer, default locale) for a release.
 * Returns file name → contents; they go in manifests/r/RedtRocks/Glance/<version>/.
 */
export function wingetManifests(conf: TauriConf, tag: string, sums: Map<string, string>, releaseDate: string): Record<string, string> {
  const version = tag.replace(/^v/, '')
  const id = `PackageIdentifier: ${WINGET_ID}\nPackageVersion: ${yamlString(version)}\n`
  const installers = (['x64', 'arm64'] as const).map((arch) => {
    const file = installerName(tag, arch)
    const sha = sums.get(file)
    if (!sha) throw new Error(`no SHA-256 for ${file}`)
    return `- Architecture: ${arch}\n  InstallerUrl: ${REPO}/releases/download/${tag}/${file}\n  InstallerSha256: ${sha}`
  })
  // Tauri's NSIS installer registers its uninstall entry under the product name.
  const installer =
    header('installer') +
    id +
    `InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
UpgradeBehavior: install
ProductCode: ${yamlString(conf.productName)}
ReleaseDate: ${releaseDate}
AppsAndFeaturesEntries:
- DisplayName: ${yamlString(conf.productName)}
  Publisher: ${yamlString(conf.bundle.publisher)}
  ProductCode: ${yamlString(conf.productName)}
FileExtensions:
${yamlList(extensions(conf))}
Installers:
${installers.join('\n')}
ManifestType: installer
ManifestVersion: ${WINGET_SCHEMA}
`
  const locale =
    header('defaultLocale') +
    id +
    `PackageLocale: en-US
Publisher: ${yamlString(conf.bundle.publisher)}
PublisherUrl: https://github.com/RedtRocks
PublisherSupportUrl: ${REPO}/issues
Author: ${yamlString(conf.bundle.publisher)}
PackageName: ${yamlString(conf.productName)}
PackageUrl: ${REPO}
License: ${yamlString(conf.bundle.license)}
LicenseUrl: ${REPO}/blob/main/LICENSE
Copyright: ${yamlString(conf.bundle.copyright)}
ShortDescription: ${yamlString(conf.bundle.shortDescription)}
Description: ${yamlString(conf.bundle.longDescription)}
Moniker: glance
Tags:
${yamlList(['pdf', 'pdf-editor', 'image-viewer', 'photo-viewer', 'markup', 'annotate', 'redact', 'ocr', 'camera-raw', 'heic', '3d-viewer', 'preview'])}
ReleaseNotesUrl: ${REPO}/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: ${WINGET_SCHEMA}
`
  const versionManifest =
    header('version') +
    id +
    `DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${WINGET_SCHEMA}
`
  return {
    [`${WINGET_ID}.yaml`]: versionManifest,
    [`${WINGET_ID}.installer.yaml`]: installer,
    [`${WINGET_ID}.locale.en-US.yaml`]: locale
  }
}

export interface MsixIdentity {
  name: string
  publisher: string
  publisherDisplayName: string
}

/** Test identity for local and CI builds; the Store only accepts the reserved one. */
export const DEV_IDENTITY: MsixIdentity = { name: 'Glance.Dev', publisher: 'CN=Glance Dev', publisherDisplayName: 'Glance contributors' }

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** MSIX versions have four parts, and the Store requires the last to be 0. */
export function msixVersion(version: string): string {
  const parts = version.split(/[.-]/).slice(0, 3).map((p) => String(Number.parseInt(p, 10) || 0))
  while (parts.length < 3) parts.push('0')
  return [...parts, '0'].join('.')
}

/** File type association names: unique, lower case, letters, digits, '-' and '.'. */
function ftaNames(conf: TauriConf): string[] {
  const seen = new Map<string, number>()
  return conf.bundle.fileAssociations.map((a) => {
    const base = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  })
}

/** AppxManifest.xml for the Store package. The layout holds Glance.exe and Assets\. */
export function msixManifest(conf: TauriConf, arch: 'x64' | 'arm64', identity: MsixIdentity): string {
  const names = ftaNames(conf)
  const ftas = conf.bundle.fileAssociations
    .map(
      (a, i) => `        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="${names[i]}">
            <uap:DisplayName>${xml(a.description ?? a.name)}</uap:DisplayName>
            <uap:Logo>Assets\\Square44x44Logo.png</uap:Logo>
            <uap:SupportedFileTypes>
${a.ext.map((e) => `              <uap:FileType>.${xml(e.toLowerCase())}</uap:FileType>`).join('\n')}
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/packaging.ts from src-tauri/tauri.conf.json. -->
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 desktop rescap">
  <Identity Name="${xml(identity.name)}" Publisher="${xml(identity.publisher)}" Version="${msixVersion(conf.version)}" ProcessorArchitecture="${arch}" />
  <Properties>
    <DisplayName>${xml(conf.productName)}</DisplayName>
    <PublisherDisplayName>${xml(identity.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="Glance" Executable="Glance.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${xml(conf.productName)}"
        Description="${xml(conf.bundle.shortDescription)}"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" Square71x71Logo="Assets\\Square71x71Logo.png" Square310x310Logo="Assets\\Square310x310Logo.png" />
      </uap:VisualElements>
      <Extensions>
        <uap3:Extension Category="windows.appExecutionAlias" Executable="Glance.exe" EntryPoint="Windows.FullTrustApplication">
          <uap3:AppExecutionAlias>
            <desktop:ExecutionAlias Alias="glance.exe" />
          </uap3:AppExecutionAlias>
        </uap3:Extension>
${ftas}
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`
}

export const DEFAULT_APPS_NSH = 'src-tauri/windows/default-apps.nsh'

/** ProgID Glance registers for a file association group, e.g. Glance.Image. */
export function progId(name: string): string {
  return `Glance.${name.replace(/[^A-Za-z0-9]+/g, '')}`
}

function nsisString(s: string): string {
  return s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"')
}

/**
 * NSIS macros that register Glance with Windows as a candidate default app: a ProgID
 * per file association group, the extensions under OpenWithProgids ("Open with") and
 * Applications\glance.exe, and Capabilities listed under RegisteredApplications, which
 * is what Settings → Apps → Default apps reads. Tauri's own association code writes
 * none of the last two. Everything goes under HKCU, matching the per-user install.
 */
export function nsisDefaultApps(conf: TauriConf): string {
  const exe = '$INSTDIR\\${MAINBINARYNAME}.exe'
  const classes = 'Software\\Classes'
  const app = `${classes}\\Applications\\\${MAINBINARYNAME}.exe`
  const progIds = new Map<string, string>()
  const types = new Map<string, string>()
  for (const a of conf.bundle.fileAssociations) {
    const id = progId(a.name)
    if (!progIds.has(id)) progIds.set(id, a.description ?? a.name)
    for (const e of a.ext) if (!types.has(e.toLowerCase())) types.set(e.toLowerCase(), id)
  }
  const register: string[] = []
  const unregister: string[] = []
  for (const [id, description] of progIds) {
    register.push(
      `  WriteRegStr HKCU "${classes}\\${id}" "" "${nsisString(description)}"`,
      `  WriteRegStr HKCU "${classes}\\${id}\\DefaultIcon" "" "${exe},0"`,
      `  WriteRegStr HKCU "${classes}\\${id}\\shell\\open\\command" "" '"${exe}" "%1"'`
    )
    unregister.push(`  DeleteRegKey HKCU "${classes}\\${id}"`)
  }
  register.push(
    `  WriteRegStr HKCU "${app}" "FriendlyAppName" "${nsisString(conf.productName)}"`,
    `  WriteRegStr HKCU "${app}\\DefaultIcon" "" "${exe},0"`,
    `  WriteRegStr HKCU "${app}\\shell\\open\\command" "" '"${exe}" "%1"'`,
    `  WriteRegStr HKCU "\${GLANCE_CAPABILITIES}" "ApplicationName" "${nsisString(conf.productName)}"`,
    `  WriteRegStr HKCU "\${GLANCE_CAPABILITIES}" "ApplicationDescription" "${nsisString(conf.bundle.shortDescription)}"`,
    `  WriteRegStr HKCU "\${GLANCE_CAPABILITIES}" "ApplicationIcon" "${exe},0"`
  )
  for (const [ext, id] of types) {
    register.push(
      `  WriteRegStr HKCU "${classes}\\.${ext}\\OpenWithProgids" "${id}" ""`,
      `  WriteRegStr HKCU "${app}\\SupportedTypes" ".${ext}" ""`,
      `  WriteRegStr HKCU "\${GLANCE_CAPABILITIES}\\FileAssociations" ".${ext}" "${id}"`
    )
    unregister.push(`  DeleteRegValue HKCU "${classes}\\.${ext}\\OpenWithProgids" "${id}"`)
  }
  register.push(
    `  WriteRegStr HKCU "Software\\RegisteredApplications" "${nsisString(conf.productName)}" "\${GLANCE_CAPABILITIES}"`,
    `  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"`
  )
  unregister.push(
    `  DeleteRegKey HKCU "${app}"`,
    `  DeleteRegValue HKCU "Software\\RegisteredApplications" "${nsisString(conf.productName)}"`,
    `  DeleteRegKey HKCU "\${GLANCE_CAPABILITIES}"`,
    `  DeleteRegKey /ifempty HKCU "Software\\Glance"`,
    `  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"`
  )
  return `; Generated by scripts/packaging.ts from src-tauri/tauri.conf.json; don't edit.
; Regenerate with: node scripts/packaging.ts nsis
; Makes Glance a choice in Settings > Apps > Default apps and in "Open with".

!define GLANCE_CAPABILITIES "Software\\Glance\\Capabilities"

!macro GLANCE_DEFAULT_APPS_REGISTER
${register.join('\n')}
!macroend

!macro GLANCE_DEFAULT_APPS_UNREGISTER
${unregister.join('\n')}
!macroend
`
}

function main(args: string[]): void {
  const conf = readTauriConf()
  const [cmd, ...rest] = args
  if (cmd === 'winget' && rest.length === 4) {
    const [tag, sumsFile, date, out] = rest
    const files = wingetManifests(conf, tag, parseSha256Sums(readFileSync(sumsFile, 'utf8')), date)
    mkdirSync(out, { recursive: true })
    for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text)
    console.log(`winget manifests for ${tag} written to ${out}`)
  } else if (cmd === 'msix' && rest.length === 2 && (rest[0] === 'x64' || rest[0] === 'arm64')) {
    const env = process.env
    const identity =
      env.MSIX_IDENTITY_NAME && env.MSIX_PUBLISHER && env.MSIX_PUBLISHER_DISPLAY_NAME
        ? { name: env.MSIX_IDENTITY_NAME, publisher: env.MSIX_PUBLISHER, publisherDisplayName: env.MSIX_PUBLISHER_DISPLAY_NAME }
        : DEV_IDENTITY
    if (identity === DEV_IDENTITY) console.warn('MSIX_* identity not set: using a test identity the Store will reject')
    writeFileSync(rest[1], msixManifest(conf, rest[0], identity))
    console.log(`AppxManifest.xml (${rest[0]}, ${identity.name}) written to ${rest[1]}`)
  } else if (cmd === 'nsis' && rest.length <= 1) {
    const out = rest[0] ?? DEFAULT_APPS_NSH
    writeFileSync(out, nsisDefaultApps(conf))
    console.log(`Default apps registration written to ${out}`)
  } else {
    console.error('usage: packaging.ts winget <tag> <SHA256SUMS.txt> <YYYY-MM-DD> <out dir>\n       packaging.ts msix <x64|arm64> <out file>\n       packaging.ts nsis [out file]')
    process.exit(2)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
