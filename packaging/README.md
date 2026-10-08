# Packaging: winget and the Microsoft Store

Both are generated from `src-tauri/tauri.conf.json` by `scripts/packaging.ts` (Node 22.18+ runs it directly), so version, description and file types stay in step with the app.

| | winget | Microsoft Store |
|---|---|---|
| What ships | The NSIS installers from the GitHub release | An MSIX bundle (x64 + ARM64) |
| Signing | Not needed | The Store signs it |
| Workflow | `.github/workflows/winget.yml` | `.github/workflows/store.yml` |
| Runs after each release when | always (submits only if `WINGET_TOKEN` is set) | the `MSIX_*` identity is set |
| Updates | `winget upgrade`, or Glance's own update notice | The Store; the in-app GitHub check is off in this build |

## winget

Package id `RedtRocks.Glance`, moniker `glance`. `manifests/` mirrors the layout of [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) and holds the manifests for v0.3.0, validated against the 1.10 schemas.

### First submission (once)

1. Create a GitHub [classic personal access token](https://github.com/settings/tokens/new?scopes=public_repo&description=winget) with only the `public_repo` scope. It's used to fork winget-pkgs to your account and open the pull request.
2. Add it to this repository as the Actions secret **`WINGET_TOKEN`** (Settings → Secrets and variables → Actions → New repository secret).
3. Actions → **winget** → Run workflow, tag `v0.3.0`.

A pull request appears in microsoft/winget-pkgs. Microsoft's bots validate it (they install the app in a sandbox) and a moderator merges it, usually within a few days. Then `winget install RedtRocks.Glance` works.

Without the token you can also submit by hand on Windows: `winget install wingetcreate`, then `wingetcreate submit --token <token> packaging/winget/manifests/r/RedtRocks/Glance/0.3.0`.

### Later releases

Nothing to do: the Release workflow runs the winget workflow after publishing, which generates the manifests from the release's `SHA256SUMS.txt` and submits them. The manifests are also kept as a workflow artifact.

## Microsoft Store

The Store takes MSIX packages and signs them itself, so this route works without buying a code-signing certificate (plain `.exe` installers must be signed by a trusted CA to be listed).

### First submission (once)

1. Register at [Partner Center](https://partner.microsoft.com/dashboard/registration) as an individual developer (free).
2. Apps and games → **New product → MSIX or PWA app**, and reserve the name **Glance** (or another if taken).
3. Open the product → Product management → **Product identity**. Add these three as repository variables or secrets (Settings → Secrets and variables → Actions; they end up in every package, so they needn't be secret):
   - `MSIX_IDENTITY_NAME` = Package/Identity/Name, e.g. `12345RedtRocks.Glance`
   - `MSIX_PUBLISHER` = Package/Identity/Publisher, e.g. `CN=ABCDEF12-3456-…`
   - `MSIX_PUBLISHER_DISPLAY_NAME` = Package/Properties/PublisherDisplayName

   The package's display name must be the reserved name exactly (Package/Properties/DisplayName). It's set in `STORE_DISPLAY_NAME` in `scripts/packaging.ts`; to use another without a code change, add it as `MSIX_DISPLAY_NAME`.
4. Actions → **Microsoft Store package** → Run workflow on `main`. Download the `Glance-<version>-store` artifact and unzip it to get the `.msixbundle`.
5. In Partner Center, start a submission:
   - **Packages:** upload the `.msixbundle`.
   - **Store listing:** copy from [`store/listing.md`](store/listing.md); upload `store/images/StoreLogo-300.png` as the 1:1 app logo and at least one screenshot (see the listing file).
   - **Properties:** category Productivity; privacy policy URL from [`store/listing.md`](store/listing.md#privacy-policy).
   - **Age ratings:** complete the questionnaire (no user interaction, no shared location or personal info, no purchases).
   - The package declares `runFullTrust` (every desktop app does). When asked why, answer: "Glance is a desktop app (Win32, built with Tauri) that opens and saves the user's files, uses Windows imaging, OCR and scanner APIs."
6. Submit for certification.

### Later releases

When the three values are set, the Release workflow also builds the Store bundle. Download the artifact from that run and upload it as a new submission in Partner Center (Update → Packages). Automated upload needs an Azure AD app linked to Partner Center; it's left out until the manual flow is proven.

### What differs in the Store build

- No "Send to → Glance" (it comes from the NSIS installer's hooks, which MSIX can't run). "Open with" and default-app associations work for every format.
- Open in Glance, Combine into PDF and Remove Location Info are in Windows 11's top-level right-click menu, from `glance_context_menu.dll` (src-tauri/context-menu) packed next to Glance.exe. The installer version keeps them under "Show more options" (ADR 0009).
- Update checks against GitHub are off and hidden in Settings; Help → Check for Updates points to the Store.
- `glance` works from a terminal (app execution alias).

### Testing a package locally

CI packs an x64 MSIX with a test identity on every pull request (artifact `glance-windows-x64-msix`). To install it on your PC it must be signed with a certificate the PC trusts, or registered unpacked from a folder in Developer Mode: unzip the `.msix`, then `Add-AppxPackage -Register .\AppxManifest.xml`.

## Linux packages

`.github/workflows/release.yml` builds `Glance-<tag>-linux-x86_64.rpm` and `-aarch64.rpm` in a Fedora 42 container, and `Glance-<tag>-linux-amd64.deb` and `-arm64.deb` in an `ubuntu:22.04` container, alongside the Windows installers. They are only in the GitHub release, published together with the Windows installers and listed in the same `SHA256SUMS.txt` (releases up to 0.6.5 had a separate `SHA256SUMS-linux.txt`). `publish` waits for them but goes ahead without them if they fail, so a failed Linux build just leaves the release without Linux packages; winget and the Store package still run. `src-tauri/tauri.linux.conf.json` (merged by Tauri on Linux) adds `/usr/bin/glance-mcp`, built by `scripts/mcp-bridge.mjs`, recommends `ghostscript`, and uses `src-tauri/linux/glance.desktop`, whose `MimeType=` line covers the file associations (`tests/packaging.test.ts` checks it). CI's `linux-rpm` and `linux-deb` jobs install the package and run `scripts/mcp-smoke.mjs` against `/usr/bin/glance-mcp`.
