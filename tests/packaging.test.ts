import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_DLL,
  CONTEXT_MENU_VERBS,
  contextMenuTypes,
  DEFAULT_APPS_NSH,
  LOCATION_TYPES,
  DEV_IDENTITY,
  extensions,
  msixManifest,
  msixVersion,
  nsisDefaultApps,
  parseSha256Sums,
  progId,
  thumbnailClsid,
  thumbnailExtensions,
  readTauriConf,
  wingetManifests,
} from '../scripts/packaging'

const conf = readTauriConf()
const SUMS = `39bbe6cca8d1848b22af6af8e75852562487abefeb079b5d9a0dd7083faac0fe  Glance-v0.3.0-windows-arm64-setup.exe
752637be8ba228166d49ff1a1735b7fc0abade161e9b2b9879105c1c1935e175  Glance-v0.3.0-windows-x64-setup.exe
`

describe('winget manifests', () => {
  it('reproduces the committed v0.3.0 manifests', () => {
    const dir = 'packaging/winget/manifests/r/RedtRocks/Glance/0.3.0'
    // Descriptions and file types follow tauri.conf.json, which moves on after a
    // release; the installer URLs and hashes are what must stay exact.
    const files = wingetManifests({ ...conf, version: '0.3.0' }, 'v0.3.0', parseSha256Sums(SUMS), '2026-09-26')
    expect(Object.keys(files).sort()).toEqual(readdirSync(dir).sort())
    const installer = readFileSync(`${dir}/RedtRocks.Glance.installer.yaml`, 'utf8')
    expect(installer).toContain('InstallerSha256: 752637BE8BA228166D49FF1A1735B7FC0ABADE161E9B2B9879105C1C1935E175')
    expect(installer).toContain('InstallerUrl: https://github.com/RedtRocks/glance/releases/download/v0.3.0/Glance-v0.3.0-windows-arm64-setup.exe')
  })

  it('fails without a checksum for every installer', () => {
    expect(() => wingetManifests(conf, 'v9.9.9', parseSha256Sums(SUMS), '2026-01-01')).toThrow(/no SHA-256/)
  })

  it('lists every file type once', () => {
    const exts = extensions(conf)
    expect(new Set(exts).size).toBe(exts.length)
    expect(exts).toContain('pdf')
    expect(exts).toContain('heic')
  })
})

describe('MSIX manifest', () => {
  it('uses a Store-compatible version', () => {
    expect(msixVersion('0.3.0')).toBe('0.3.0.0')
    expect(msixVersion('1.2')).toBe('1.2.0.0')
    expect(msixVersion('2.0.1-beta.1')).toBe('2.0.1.0')
  })

  it('associates every file type with unique names', () => {
    const xml = msixManifest(conf, 'arm64', DEV_IDENTITY)
    expect(xml).toContain('ProcessorArchitecture="arm64"')
    for (const ext of extensions(conf)) expect(xml).toContain(`<uap:FileType>.${ext}</uap:FileType>`)
    const names = [...xml.matchAll(/FileTypeAssociation Name="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z0-9][a-z0-9.-]*$/)
  })

  it('gives AI apps a stable path to glance-mcp.exe', () => {
    const xml = msixManifest(conf, 'x64', DEV_IDENTITY)
    expect(xml).toContain('<desktop:ExecutionAlias Alias="glance-mcp.exe" />')
    // MakeAppx allows one alias extension per application, so both aliases start Glance.exe.
    expect(xml.match(/Category="windows.appExecutionAlias"/g)).toHaveLength(1)
    expect(xml).toContain('<uap3:Extension Category="windows.appExecutionAlias" Executable="Glance.exe"')
  })

  it('has one application, listed in Start', () => {
    // The Store refuses unlisted ("headless") apps without a HeadlessAppBypass waiver.
    const xml = msixManifest(conf, 'x64', DEV_IDENTITY)
    expect(xml.match(/<Application /g)).toHaveLength(1)
    expect(xml).not.toContain('AppListEntry')
  })

  it('adds Open in Glance, Combine into PDF and Remove Location Info to the Windows 11 menu', () => {
    const xml = msixManifest(conf, 'x64', DEV_IDENTITY)
    const types = contextMenuTypes(conf)
    for (const ext of ['pdf', 'jpg', 'heic', 'cr2', 'psd']) expect(types.get(ext)).toContain('GlanceCombine')
    expect(types.get('pdf')).toEqual(['GlanceOpen', 'GlanceCombine'])
    expect(types.get('jpg')).toEqual(['GlanceOpen', 'GlanceCombine', 'GlanceRemoveLocation'])
    for (const ext of ['glb', 'xps', 'cbz', 'eps']) expect(types.has(ext)).toBe(false)
    expect(xml).toContain('<desktop5:ItemType Type=".heic">')
    expect(xml).toContain(`<desktop5:Verb Id="GlanceRemoveLocation" Clsid="${CONTEXT_MENU_VERBS[2].clsid}" />`)
    // Each verb's COM class is served by the DLL, and the namespaces can be skipped by older Windows.
    for (const v of CONTEXT_MENU_VERBS) expect(xml).toContain(`<com:Class Id="${v.clsid}" Path="${CONTEXT_MENU_DLL}" ThreadingModel="STA" />`)
    expect(xml).toMatch(/IgnorableNamespaces="[^"]*\bdesktop4 desktop5 com\b/)
  })

  it('matches the context menu DLL and the installer on CLSIDs and location types', () => {
    const rust = readFileSync('src-tauri/context-menu/src/lib.rs', 'utf8')
    for (const v of CONTEXT_MENU_VERBS) expect(rust).toContain(`0x${v.clsid.replace(/-/g, '_')}`)
    const rustTypes = /LOCATION_TYPES: \[&str; \d+\] = \[([^\]]+)\]/.exec(rust)![1].match(/"(\w+)"/g)!.map((t) => t.slice(1, -1))
    expect(rustTypes).toEqual(LOCATION_TYPES)
    const hooks = readFileSync('src-tauri/windows/hooks.nsh', 'utf8')
    const block = /!macro GLANCE_LOCATION_TYPES M([\s\S]*?)!macroend/.exec(hooks)![1]
    expect([...block.matchAll(/"\.(\w+)"/g)].map((m) => m[1])).toEqual(LOCATION_TYPES)
  })

  it('escapes the identity', () => {
    const xml = msixManifest(conf, 'x64', { name: 'A.B', publisher: 'CN=A & "B"', publisherDisplayName: '<C>' })
    expect(xml).toContain('Publisher="CN=A &amp; &quot;B&quot;"')
    expect(xml).toContain('<PublisherDisplayName>&lt;C&gt;</PublisherDisplayName>')
  })

  it('uses the reserved Store name when given', () => {
    expect(msixManifest(conf, 'x64', DEV_IDENTITY)).toContain(`<DisplayName>${conf.productName}</DisplayName>`)
    const xml = msixManifest(conf, 'x64', { ...DEV_IDENTITY, displayName: 'Glance: PDF & images' })
    expect(xml).toContain('<DisplayName>Glance: PDF &amp; images</DisplayName>')
    expect(xml).toContain('DisplayName="Glance: PDF &amp; images"')
  })
})

describe('Default apps registration (installer)', () => {
  const nsh = nsisDefaultApps(conf)

  it('matches the committed default-apps.nsh (run `node scripts/packaging.ts nsis`)', () => {
    expect(readFileSync(DEFAULT_APPS_NSH, 'utf8').replace(/\r\n/g, '\n')).toBe(nsh)
  })

  it('offers Glance for every file type', () => {
    expect(nsh).toContain('WriteRegStr HKCU "Software\\RegisteredApplications" "Glance" "${GLANCE_CAPABILITIES}"')
    for (const a of conf.bundle.fileAssociations) {
      const id = progId(a.name)
      expect(id).toMatch(/^Glance\.[A-Za-z0-9]+$/)
      expect(nsh).toContain(`"Software\\Classes\\${id}\\shell\\open\\command" "" '"$INSTDIR\\\${MAINBINARYNAME}.exe" "%1"'`)
      for (const ext of a.ext) {
        expect(nsh).toContain(`"\${GLANCE_CAPABILITIES}\\FileAssociations" ".${ext}" "${id}"`)
        expect(nsh).toContain(`"Software\\Classes\\.${ext}\\OpenWithProgids" "${id}" ""`)
        expect(nsh).toContain(`DeleteRegValue HKCU "Software\\Classes\\.${ext}\\OpenWithProgids" "${id}"`)
        // Thumbnails and the Preview pane keep working with Glance as the default.
        expect(nsh).toMatch(new RegExp(`GLANCE_KEEP_HANDLERS "${ext}" "${a.name}" "(image)?"`))
        expect(nsh).toContain(`GLANCE_DROP_HANDLERS "${ext}"`)
      }
    }
  })

  it('gives Explorer thumbnails for the types Windows can’t preview', () => {
    // Must match clsid_for in src-tauri/thumbnailer/src/lib.rs.
    expect(thumbnailClsid('pdf')).toBe('{4d578e19-3f31-49d8-8d05-706466000000}')
    expect(thumbnailClsid('cr2')).toBe('{4d578e19-3f31-49d8-8d05-637232000000}')
    const exts = thumbnailExtensions(conf)
    for (const e of ['pdf', 'ai', 'xps', 'cbz', 'eps', 'psd', 'jxl', 'tga', 'exr', 'cr2', 'dng']) expect(exts).toContain(e)
    for (const e of ['jpg', 'png', 'heic', 'glb', 'svg']) expect(exts).not.toContain(e)
    for (const e of exts) {
      expect(nsh).toContain(`GLANCE_THUMBNAILER_FOR "${e}" "${thumbnailClsid(e)}"`)
      expect(nsh).toContain(`GLANCE_THUMBNAILER_NOT_FOR "${e}" "${thumbnailClsid(e)}"`)
    }
  })

  it('is registered on install and removed on uninstall', () => {
    const hooks = readFileSync('src-tauri/windows/hooks.nsh', 'utf8')
    expect(hooks).toContain('!include "${__FILEDIR__}\\default-apps.nsh"')
    expect(hooks).toMatch(/NSIS_HOOK_POSTINSTALL[\s\S]*GLANCE_DEFAULT_APPS_REGISTER[\s\S]*!macroend/)
    expect(hooks).toMatch(/NSIS_HOOK_PREUNINSTALL[\s\S]*GLANCE_DEFAULT_APPS_UNREGISTER[\s\S]*!macroend/)
  })
})

describe('Linux RPM', () => {
  // Shared MIME Info names, plus IANA registrations for USD and COLLADA.
  // https://gitlab.freedesktop.org/xdg/shared-mime-info/-/blob/master/data/freedesktop.org.xml.in
  // https://www.iana.org/assignments/media-types/model
  const mimeByExt: Record<string, string> = {
    pdf: 'application/pdf', ai: 'application/illustrator', ps: 'application/postscript',
    eps: 'image/x-eps', epsf: 'image/x-eps', xps: 'application/vnd.ms-xpsdocument', oxps: 'application/oxps',
    cbz: 'application/vnd.comicbook+zip',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', apng: 'image/apng',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', dib: 'image/bmp', ico: 'image/vnd.microsoft.icon',
    svg: 'image/svg+xml', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
    heic: 'image/heif', heif: 'image/heif', hif: 'image/heif',
    jp2: 'image/jp2', j2k: 'image/x-jp2-codestream', jpf: 'image/jpx', jpx: 'image/jpx', jxl: 'image/jxl',
    jxr: 'image/jxr', wdp: 'image/jxr', hdp: 'image/jxr', exr: 'image/x-exr', hdr: 'image/vnd.radiance',
    tga: 'image/x-tga', dds: 'image/vnd.ms-dds', qoi: 'image/qoi', ppm: 'image/x-portable-pixmap',
    pgm: 'image/x-portable-graymap', pbm: 'image/x-portable-bitmap', pam: 'image/x-portable-arbitrarymap',
    pnm: 'image/x-portable-anymap', icns: 'image/x-icns', psd: 'image/vnd.adobe.photoshop',
    cr2: 'image/x-canon-cr2', cr3: 'image/x-canon-cr3', crw: 'image/x-canon-crw',
    nef: 'image/x-nikon-nef', nrw: 'image/x-nikon-nrw', arw: 'image/x-sony-arw',
    srf: 'image/x-sony-srf', sr2: 'image/x-sony-sr2', raf: 'image/x-fuji-raf',
    orf: 'image/x-olympus-orf', rw2: 'image/x-panasonic-rw2', raw: 'image/x-panasonic-rw',
    dng: 'image/x-adobe-dng', pef: 'image/x-pentax-pef', srw: 'image/x-samsung-srw',
    x3f: 'image/x-sigma-x3f', erf: 'image/x-epson-erf', mef: 'image/x-mamiya-mef', mos: 'image/x-leaf-mos',
    mrw: 'image/x-minolta-mrw', kdc: 'image/x-kodak-kdc', dcr: 'image/x-kodak-dcr',
    '3fr': 'image/x-hasselblad-3fr', fff: 'image/x-hasselblad-fff', iiq: 'image/x-phaseone-iiq',
    rwl: 'image/x-panasonic-rw2', gpr: 'image/x-dcraw',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', stl: 'model/stl',
    usdz: 'model/vnd.usdz+zip', usda: 'model/vnd.usda', dae: 'model/vnd.collada+xml',
    '3mf': 'model/3mf', '3ds': 'image/x-3ds',
  }
  // No registered/shared MIME type exists for these formats. Never claim all unknown binary files.
  const NO_MIME = new Set(['ply', 'fbx', 'usdc'])
  // Windows-only formats (XPS needs the XPS Rasterization Service, JPEG XR needs WIC): Linux must not claim them.
  const LINUX_UNSUPPORTED = new Set(['xps', 'oxps', 'jxr', 'wdp', 'hdp'])

  it('covers every associated extension with a MIME type or an explicit exclusion', () => {
    const desktop = readFileSync('src-tauri/linux/glance.desktop', 'utf8')
    const mimes = new Set(desktop.match(/^MimeType=(.+)$/m)?.[1].split(';').filter(Boolean))
    expect(desktop).toContain('Exec={{exec}} %F')
    expect(mimes.has('application/octet-stream')).toBe(false)
    for (const ext of extensions(conf)) {
      if (LINUX_UNSUPPORTED.has(ext)) {
        expect(mimes.has(mimeByExt[ext]), `Linux claims unsupported .${ext}`).toBe(false)
      } else if (NO_MIME.has(ext)) {
        expect(mimeByExt[ext]).toBeUndefined()
      } else {
        expect(mimeByExt[ext], `No MIME mapping for .${ext}`).toBeDefined()
        expect(mimes.has(mimeByExt[ext]), `Desktop template omits .${ext}`).toBe(true)
      }
    }
    for (const ext of NO_MIME) expect(extensions(conf)).toContain(ext)
  })

  it('bundles the installed executable bridge and recommends Ghostscript', () => {
    const linux = JSON.parse(readFileSync('src-tauri/tauri.linux.conf.json', 'utf8'))
    expect(linux.bundle.targets).toEqual(['rpm'])
    expect(linux.bundle.linux.rpm.desktopTemplate).toBe('linux/glance.desktop')
    expect(linux.bundle.linux.rpm.files).toEqual({ '/usr/bin/glance-mcp': 'target/mcp-bridge/glance-mcp' })
    expect(linux.bundle.linux.rpm.recommends).toContain('ghostscript')
  })
})
