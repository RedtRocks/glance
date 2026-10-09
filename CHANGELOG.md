# Changelog

What changed in each version of Glance, newest first. Downloads for every version are on the [releases page](https://github.com/RedtRocks/glance/releases).

<!-- The Release workflow publishes the section for the version it releases (scripts/release-notes.ts). Add a line under the top "## New in" section for anything users will notice. -->

## New in 0.6.7

- **The install count tells Flatpaks apart.** The anonymous daily check-in (**Settings → Count this install**) now says whether the copy is a Flatpak, instead of counting it as a download from GitHub. Nothing else it sends has changed.

## New in 0.6.6

- **Glance as a Flatpak, for any Linux distribution.** Download `Glance-…-linux-x86_64.flatpak` (or the `aarch64` file) from the release and install it with `flatpak install --user`. It includes the AI tools: AI apps connect with `flatpak run --command=glance-mcp io.github.redtrocks.glance`, and Ask AI uses the agents installed on your PC. PostScript files need the `.deb` or `.rpm` version.

## New in 0.6.5

- **Glance for Linux.** Download a package for Ubuntu 22.04+ and Debian 12+ (`.deb`) or Fedora 42+ (`.rpm`), for Intel/AMD and ARM64 PCs. It includes the AI tools, adds Glance to **Open With** for PDFs, images and its other file types, and keeps saved signatures and AI API keys in your login keyring (GNOME Keyring or KWallet). Features that need Windows, such as Text Recognition, scanning and certificate signing, are hidden on Linux.
- **A safer connection for AI apps on Linux.** The address AI apps use to reach Glance is kept in a private folder only your account can open, never in a shared temporary folder, and Glance checks it hasn't been tampered with before using it.
- **Glance in Windows 11's main right-click menu (Microsoft Store version).** **Open in Glance**, **Combine into PDF** and **Remove Location Info** (for photos) now appear without **Show more options**. With the installer from GitHub they stay under **Show more options**.

## New in 0.6.4

- **Send feedback from Glance.** **Help → Send Feedback** opens a box for a bug report or an idea and sends it as an email from your own mail app, so you don't need a GitHub account to tell us.
- **An anonymous count of installs.** Once a day Glance sends one check-in with its version number and whether it came from the Microsoft Store or GitHub, so there's a number for how many copies are in use. There's no ID, and nothing about you or the files you open. Turn it off in **Settings → Count this install**. The [privacy policy](https://github.com/RedtRocks/glance/blob/main/PRIVACY.md) has the details.

## New in 0.6.3

- **The mic in Ask AI works.** **Open Settings** now opens the right Windows Settings page. If the microphone is blocked, Glance says so before listening. If Windows still hears nothing, the sidebar explains why and offers **Use Windows voice typing** (Win+H), which types into the message box.
- **Glance is back on its way to the Microsoft Store.** The Store turned down the 0.6.2 package because of a hidden helper app inside it. AI apps now start Glance itself instead, so the package has just Glance, and connected AI apps keep working as before.

## New in 0.6.2

- **Tell the AI what to change in your document.** In Ask AI, type or say things like "change the tenant to Jordan Ellis" or "add a sentence about renewing under Term". The AI changes, adds or deletes text in the open PDF or photo, in the same font, size, colour and line spacing as the page, and the words and paragraphs after it move along to make room. Each answer's changes show as a card with **Keep** and **Undo**, and nothing is saved until you save. It works with every AI company in the sidebar.
- **Talk instead of typing.** Tap the mic in Ask AI and speak. Glance types what you say, and a short pause sends it. It uses Windows speech recognition, so **Online speech recognition** must be on in Windows Settings (Glance offers a button to it if it's off).
- **Gemini works in Glance chat again.** Glance now uses Google's Antigravity agent, which signs in with your Google account. It downloads once, the first time you pick Gemini.
- **Copying an area for a company's website works.** **Copy an area** no longer fails with "expected RGBA image data".

## New in 0.6.1

Fixes for Ask AI:

- **Signing in on a company's website works.** "Sign in with Google", Apple or Microsoft opens its sign-in window instead of failing.
- **A way back.** Back, Home and Reload buttons sit above the website, with **Back to Glance chat**, so a sign-in page or link can't leave you stuck.
- **Files open again after using a website.** Opening documents stopped working once a company website had been shown.
- **F5 and Ctrl+R no longer reload Glance** and throw away open documents (Ctrl+R still rotates pages).
- **Gemini opens its website,** where you sign in with Google. Google no longer lets its Gemini helper app sign in with a personal account.
- **Switching AI company and back keeps the model list working,** and switching mid-answer no longer leaves the sidebar stuck.
- **The model list is readable in dark mode,** each company shows its logo, and the Ask AI button has a purple sparkle.

## New in 0.6.0

- **Ask AI about what you're looking at.** Press **Ask AI** (toolbar or View menu) to open a sidebar and chat with Claude, ChatGPT, Gemini, GitHub Copilot, Qwen, Kimi, Mistral or OpenCode about the open document, photo or model. Share **This page** or **Select area** to point at one part. It uses each company's own agent signed in with your account (free or paid), or an API key for OpenAI, Anthropic, OpenRouter, Z.ai, Kimi, DeepSeek, Mistral or any compatible address. Keys are kept in Windows Credential Manager. Each document keeps its past chats.
- **Or use the company's own website.** The globe button in Ask AI shows chatgpt.com, claude.ai, Gemini and the others in the sidebar, signed in with your own account. **Copy this page** or **Copy an area** puts what you're looking at on the clipboard to paste into the chat.
- **AI apps start Glance only when they need it.** Connecting Claude Code, Codex, Cursor and the rest no longer opens Glance when the AI app starts. Glance starts in the background on the first request, and again if you quit it mid-session, so the tools no longer disappear until the AI app restarts.
- **Older Office files open too:** Word 97-2003 (.doc), Excel 97-2003 (.xls) and PowerPoint 97-2003 (.ppt), as read-only previews with **Open with…**, in the app and in the browser.
- **Markup on phones and touchscreens:** tap markup to select it, then use the floating bar to edit, recolor, duplicate or delete it. Dragging with a finger moves markup instead of scrolling, and Redo sits next to Undo.
- **The iPhone Home Screen app works offline reliably.** After its first launch online it tells you once everything is stored, and opens without a connection from then on.

## New in 0.5.0

- **Let your AI apps use Glance.** Claude Code, Claude Desktop, Codex, Cursor, VS Code, Windsurf, Gemini CLI, LM Studio and any other MCP app can view every format Glance opens, read text (scanned pages through Windows OCR), convert, combine, split and redact files, remove a photo's location, and see or move to the page you have open in Glance. Turn it on with one **Connect** click in **Settings → AI apps**. Edits always go to new files, so your originals stay as they were. [How it works](https://github.com/RedtRocks/glance/blob/main/docs/AI-APPS.md)
- **Word, PowerPoint and Excel files open in Glance.** Documents, slides and spreadsheets (and CSV) show as a read-only preview, with an **Open with…** bar to edit them in Office or another app.
- **Previews for much more:** text and code with syntax colours, Markdown, video and audio, EPUB e-books, font sample sheets, and .eml and .msg email with attachments. Nothing in these files loads from the internet, and HTML email can't run scripts or tracking images.
- **Glance in your browser.** The same app runs on phones, tablets, Macs and Chromebooks at https://redtrocks.github.io/glance/app/. It can be installed, works offline, and your files never leave the device. On phones it gets a bottom dock, pinch to zoom, double-tap and swipe between pages.

## New in 0.4.2

- **File Explorer shows what's inside your files.** Windows can't preview PDFs, camera RAW (without the RAW extension), XPS, EPS, comic books (CBZ), Photoshop, JPEG XL, JPEG 2000, OpenEXR, HDR, TGA, DDS, QOI, Netpbm and Mac icon files, so with Glance as the default app they showed Glance's icon. Glance now includes its own thumbnail handler, so Explorer shows a PDF's first page, a photo or the cover. Types Windows already previews keep Windows' own thumbnails. If old icons stick around, restart Explorer or clear Thumbnails in Disk Cleanup.
- **Make Glance the Default App…** is now in the File menu, next to Settings.

## New in 0.4.1

- **Fixes the endless update notice in 0.4.0.** The 0.4.0 installer still called itself 0.3.0 inside, so it kept offering 0.4.0 as an update. Installing 0.4.1 stops that.
- **Redaction on images works.** Mark areas, then Apply Redactions: the areas are painted solid black into the pixels, as one step you can undo. Discard and the warning bar work on images like they do on PDFs, and Print uses the edited image.
- **Instant Alpha: hold Shift to add, Alt to subtract.** Like Preview, Shift-drag grows the current selection (of any kind) and Alt-drag takes a region away, with a live preview. Escape keeps the old selection.
- **Pinch to zoom works.** Pinching on a touchpad now zooms images, PDFs and 3D models; before, only Ctrl+scroll did, and 3D models barely moved. The window itself no longer zooms with Ctrl+scroll or Ctrl+plus/minus.
- **Autosave saves when you leave.** Like Preview, edits are saved right away when you switch to another app or tab, or close a tab or the window, so closing only asks about JPEGs and unapplied redactions. Also fixes autosave stopping for every open file after editing a text box or note.
- **The More options (⋯) menu works.** Share, Print, Export and the other items in it did nothing when clicked. The menu also closes with Escape.
- **Pick the highlighter color.** The Highlight button in the main toolbar and in the markup bar now has a dropdown with highlight colors (or any color), underline, strikethrough and squiggly underline. Picking a color recolors the selected highlight or highlights the selected text.
- **Pick Glance in Settings → Default apps.** Glance now registers with Windows as a default app for PDFs, images, camera RAW, XPS, PostScript, comics and 3D models, so it's listed in **Settings → Apps → Default apps** and under **Open with** for each of those types. **Make default** (offered once at startup, and in Glance's Settings) opens Glance's page there; on Windows 11 one **Set default** click makes it the default for everything. Windows requires that confirmation: apps can't make themselves the default.
- **File Explorer shows previews again.** With Glance as the default, photos and PDFs showed Glance's icon instead of a thumbnail of their content. Explorer thumbnails and the Preview pane now keep working (PDF thumbnails come from whichever PDF app provides them, such as Acrobat).
- **System fonts load faster for text boxes.** The font list (Aa in the markup bar) reads only what it needs from each installed font and starts loading when the markup bar opens, so your Windows fonts show up right away.
- **A new app icon.** A layered page-and-photo icon in ocean blues with a frosted-glass look replaces the old page-and-magnifier icon, and stays clear at small sizes in the taskbar, Start and Explorer.

## New in 0.4.0

- **Certificate signatures in PDFs.** A banner above signed PDFs (Adobe, DocuSign and others) says whether each signature is valid, who signed and when, and whether the document changed since; View → Signatures has the details. Trust comes from the Windows certificate store. **Markup → Sign with Certificate** signs with your own certificate or smart card.
- **Header, footer and watermark** (Pages → Header, Footer & Watermark): page numbers, header and footer text with page, date and file-name fields, and text or image watermarks on all pages or a range, with a live preview.
- **Straighten images** (Image → Straighten, Ctrl+Shift+L): rotate by any angle with a slider, an exact value or by dragging, over a grid, with optional crop to fill. Rotate, flip, crop and resize now work on images with markup, which moves with the pixels.
- **Single-key tools** like Photoshop and Figma: V select, H hand, Z zoom, M marquee, L lasso, W Instant Alpha, B draw, U shapes, R rectangle, O oval, T text, S note, C crop, [ and ] for line width, and Space to pan. Every key can be changed in Settings.
- **Reopen tabs on launch** with each tab's page and zoom (off by default; turn it on in Settings).
- **3D viewer:** lighting presets, backgrounds, clay, normals and X-ray materials, ground shadow, floor grid and camera views. Models keep their true colors, and textures show up without having to move the view.
- **Touchpad gestures:** two-finger drag orbits a 3D model (Shift pans), and pinch zooms images and PDFs smoothly.
- **Autosave is calmer:** it saves after 10 seconds without edits, at most once a minute, never while you're typing in a form field, and not at all when nothing changed.
- **Instant Alpha fix:** a quick click no longer leaves a blue tint that Delete can't remove.
- **Ready for translation:** all text now goes through a translation layer, and Glance follows the Windows display language (Settings → Language) as translations are added.

## New in 0.3.0

- **Version history and autosave.** Every save keeps a version (File → Browse Versions: preview, restore or open a copy). Edits save automatically a few seconds after you stop (turn it off in Settings). Versions share unchanged data, so they take little space.
- **Safe with other apps and windows.** A file opens in one window only; if another app changes it, Glance pauses autosave and asks before replacing anything.
- **3D models.** GLB/glTF, OBJ, STL, PLY, 3MF, Collada, FBX, USDZ and 3DS: orbit, zoom, wireframe, turntable, animations and PNG snapshots.
- **XPS and OpenXPS** documents, rendered by Windows.
- **Clean Up PDF** removes comments, links, metadata, attached files and scripts for real, and PDFs are compacted when saving.
- **Create Collage** from photos (rows or grid).
- **Password-protect PDFs** when exporting (AES-256, with printing/copying/editing permissions), **Reduce File Size** for image-heavy PDFs, **New from Clipboard** (Ctrl+N) and **Import from Scanner** (flatbed or feeder, straight into a PDF).
- **Explorer right-click menu:** Open in Glance, Combine into PDF (selected PDFs and images, in name order, as a new PDF next to them) and Remove Location Info. On Windows 11 they're under Show more options.
- **Share** through the Windows share sheet, **Send to → Glance** in Explorer, and **update notifications** you can skip or turn off.

## New in 0.2.0

**Fixes from testing 0.1.0**

- Highlights no longer hide the text underneath.
- Closing a window with unsaved changes asks to save them (pending redactions included).
- The sidebar no longer shows another document's pages after switching tabs.
- Dragging pages between PDFs is easier: hover a tab to open it, then drop exactly where you want. Right-click a page for Copy/Move To, Duplicate, Split and more.
- Menus show only what applies to the open file, and the View menu uses one-choice groups.

**PDF**

- Text boxes in any installed font; highlights in any color; squiggly underline; loupe (magnifier).
- Duplicate pages, Split PDF, and export pages as PNG, JPEG or TIFF.
- Remove Sensitive Text finds names, emails, phone, card and ID numbers to redact.
- Recognize Text (Windows OCR) makes scanned PDFs searchable and selectable.
- Sign with your camera.

**Images**

- Remove Background and Copy Subject, Instant Alpha, selections, crop, Adjust Color (now with Definition and Gamma) and Adjust Size.
- Inspector (Ctrl+I) with EXIF, color profile and **Remove Location**.
- Batch Edit Images: rotate, resize, convert and remove location for many images at once.
- Export in Display P3, Adobe RGB or Gray; copy text from an image; set an image as your desktop background or lock screen.
- Open PSD, AI and RAW files in another app with one click.

## New in 0.1.0

- **The first release.** Viewing PDFs, images and camera RAW, PDF page management, markup, signatures, form filling and redaction.
