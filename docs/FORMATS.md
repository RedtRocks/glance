# Supported formats

"WIC" means Windows Imaging Component: formats decode through Windows' own codecs when installed, with the listed fallback otherwise.

## Documents
| Format | Extensions | Engine |
|---|---|---|
| PDF | `.pdf` | PDF.js (view), pdf-lib (edit) |
| Adobe Illustrator (PDF-compatible) | `.ai` | Opened as PDF |
| PostScript / EPS | `.ps`, `.eps`, `.epsf` | Ghostscript if installed (external program); else embedded EPS preview |
| XPS / OpenXPS | `.xps`, `.oxps` | Windows XPS Rasterization Service |
| Comic book archives | `.cbz` | Zip of images, shown as pages |

## Office files (read-only preview)
| Format | Extensions | Engine |
|---|---|---|
| Word | `.docx .docm .dotx .dotm` | `docx-preview`, loaded on demand |
| PowerPoint | `.pptx .pptm .ppsx .ppsm .potx .potm` | `@aiden0z/pptx-renderer`, loaded on demand |
| Excel | `.xlsx .xlsm .xltx .xltm` | `src/preview/xlsx.ts` (saved values, formats, fills, merges; no charts) |
| CSV / TSV | `.csv .tsv` | `src/preview/render.ts` |

Each shows a bar with **Open with…** (Windows app) to edit the file in Office or another app. Older binary files (`.doc .xls .ppt`) and OpenDocument aren't previewed.

## Text, media, books, fonts and email (read-only preview)
| Format | Extensions | Engine |
|---|---|---|
| Text and code | `.txt .log .ini .toml .yaml .json .xml .html .css .js .ts .py .rs .go .java .cs .cpp .sql .sh .ps1` and more (see `src/core/previews.ts`) | `src/preview/text.ts`, colours by `highlight.js` |
| Markdown | `.md .markdown .mdown .mkd` | `marked`, cleaned by `DOMPurify` |
| Video | `.mp4 .m4v .webm .mov .ogv .mkv` | the web view's player (codecs the system has) |
| Audio | `.mp3 .m4a .aac .wav .ogg .oga .opus .flac .weba` | the web view's player |
| EPUB | `.epub` | `src/preview/ebook.ts` (chapters in reading order, the book's own styles left out) |
| Fonts | `.ttf .otf .woff .woff2` | sample sheet; the font is never installed |
| Email | `.eml .msg` | `postal-mime`, `@kenjiuno/msgreader`; HTML bodies in a sandboxed frame |

Nothing in these files is fetched from the web: pictures from the internet become links, and HTML email can't run scripts or load tracking images. Email and e-books also show **Open with…** in the Windows app.

## Images
| Format | Extensions | Engine |
|---|---|---|
| JPEG, PNG, GIF, WebP, BMP, ICO, SVG, AVIF | `.jpg .jpeg .jfif .png .apng .gif .webp .bmp .dib .ico .cur .svg .avif` | WebView2 native decoders |
| TIFF (multi-page) | `.tif .tiff` | WIC → `image` crate |
| HEIF / HEIC | `.heic .heif .hif` | WIC (HEIF extension) → libheif (WASM, loaded on demand) |
| JPEG 2000 | `.jp2 .j2k .jpf .jpx .j2c` | `hayro-jpeg2000` |
| JPEG XL | `.jxl` | WIC → `jxl-oxide` |
| JPEG XR | `.jxr .wdp .hdp` | WIC |
| OpenEXR | `.exr` | `image` crate (tone-mapped) |
| Radiance HDR | `.hdr` | `image` crate (tone-mapped) |
| TGA | `.tga` | `image` crate |
| DDS | `.dds` | WIC → `image` crate |
| QOI, PNM (PPM/PGM/PBM/PAM) | `.qoi .ppm .pgm .pbm .pam .pnm` | `image` crate |
| ICNS | `.icns` | `icns` crate |
| Photoshop | `.psd` | `psd` crate (flattened composite; view-only) |

## Camera RAW
`.cr2 .cr3 .crw .nef .nrw .arw .srf .sr2 .raf .orf .rw2 .raw .dng .pef .srw .x3f .erf .mef .mos .mrw .kdc .dcr .3fr .fff .iiq .rwl .gpr`

Decoded through WIC with Microsoft's Raw Image Extension (built into Windows 11 22H2+, free from the Store on Windows 10). Without it, Glance shows the full-size JPEG preview embedded in the RAW file.

## 3D models
`.glb .gltf .obj .stl .ply .fbx .usdz .usda .usdc .dae .3mf .3ds`: three.js, loaded on demand.

## Also
- Multi-page TIFFs and CBZ files show pages in the sidebar; animated GIF, APNG and animated WebP show read-only **Frames**.
- New from Clipboard, and screenshots via the Windows Snipping Tool.
