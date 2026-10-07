Glance is a free, open-source, lightweight viewer and editor for PDFs, images, camera RAW and 3D models on Windows, inspired by macOS Preview. It also previews Word, PowerPoint and Excel files, and runs in any browser at https://redtrocks.github.io/glance/app/.

> **Early preview.** Most of Preview's everyday features work, plus version history, 3D models, certificate signatures and more. On Windows 11, the Microsoft Store version puts Glance's entries in Explorer's main right-click menu; with the installer from GitHub they're under **Show more options**. See the [README](https://github.com/RedtRocks/glance#features) for the full list.

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

## Download

| Your PC | Installer |
|---|---|
| Most Windows PCs (Intel/AMD) | `Glance-…-windows-x64-setup.exe` |
| ARM laptops (Snapdragon, Surface Pro X) | `Glance-…-windows-arm64-setup.exe` |
| Fedora 42+ (Intel/AMD) | `Glance-…-linux-x86_64.rpm` |
| Fedora 42+ (ARM64) | `Glance-…-linux-aarch64.rpm` |

Not sure? Open **Settings → System → About** and look at **System type**.

## Install

1. Download the installer and run it. It installs for your account only; no administrator rights are needed.
2. **Windows SmartScreen will warn** that the app is from an unknown publisher, because releases aren't code-signed yet. Click **More info → Run anyway**.
3. To make Glance your PDF or image viewer: open **Settings → Apps → Default apps → Glance** and pick the file types, or right-click a file → **Open with → Choose another app → Glance** and choose **Always**.

Requires Windows 10 (1809+) or Windows 11. The installer downloads the WebView2 runtime if it's missing (it's preinstalled on Windows 11).

On Fedora, run `sudo dnf install ./Glance-…-linux-x86_64.rpm` (or the `aarch64` file).

## Privacy

No account and nothing you open leaves your PC. Glance makes two optional daily requests, both with a switch in Settings: an update check, and an anonymous count of installs (version number only, no ID). Background removal and text recognition run on your PC. Saved signatures are encrypted with your Windows account.

## Verify your download

Compare the file's hash with `SHA256SUMS.txt`: in PowerShell, run `Get-FileHash .\Glance-…-setup.exe`. For the Linux RPMs, run `sha256sum -c SHA256SUMS-linux.txt --ignore-missing` in the download folder.
