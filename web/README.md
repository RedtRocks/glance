# The browser version

Glance also runs as a web app at <https://redtrocks.github.io/glance/app/>: the same
interface as the Windows app, with no installer. It is useful on a phone or on a
machine you can't install software on.

Files are opened and edited **on the device**. Nothing is uploaded, and the app has no
server beyond the static files it is served from.

## What's here

| Path | What it is |
|---|---|
| `decoder/` | The Windows app's own image decoders (`src-tauri/src/decode`), built for WebAssembly. Browsers can't read TIFF, camera RAW, PSD, JPEG 2000, JPEG XL, EXR, TGA and the rest, so the same Rust code decodes them here too. |
| `sw.js` | The service worker, which caches the app so it keeps working with no network. |

`scripts/build-web.mjs` builds all of it into `dist-web/`, and `.github/workflows/pages.yml`
publishes that under `/app/` beside the landing page.

```sh
rustup target add wasm32-unknown-unknown   # once
node scripts/build-web.mjs
npx vite preview --outDir dist-web
```

## What the browser version can't do

Anything that needs Windows itself: text recognition (the Windows OCR engine), scanning,
Explorer integration and default-app registration, the share sheet, certificate
signatures, saved signatures, Ghostscript for PostScript, XPS, and the Windows RAW and
HEIF codecs (RAW files fall back to the full-size preview the camera embedded, as they
do on Windows without the codec installed). Those commands hide or explain themselves
rather than failing.

Saving downloads the file instead of writing it back in place, so there is no autosave
or version history.
