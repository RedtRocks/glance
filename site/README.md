# Landing page

The site at https://redtrocks.github.io/glance/, published by `.github/workflows/pages.yml` on every push to `main` that touches this folder.

It is plain HTML, CSS and a little JavaScript with no build step: edit `index.html` and open it in a browser (serve the folder, e.g. `npx serve site`, so the font loads). Screenshots and the icon live in `assets/`; `og.jpg` is the link preview image.

## Pages for each file type

`file-viewer/` (every file type, with a drop zone) and one page per format, like `heic-viewer/`, are generated from `scripts/format-pages.mjs` by `node scripts/build-format-pages.mjs`, which also rewrites `sitemap.xml`. They reuse the styles at the top of `index.html`, so run it again after changing those. Screenshots are in `assets/formats/` (`<slug>.webp` and `<slug>-phone.webp`). The "Open a File" buttons hand the picked files to the web app at `app/` through Cache Storage (`assets/open.js`), the same way the Share target does; nothing is uploaded.
