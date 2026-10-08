# Using Glance from AI apps

Glance can be a tool for AI apps such as Claude Code, Claude Desktop, Codex, Antigravity, Muse Code, Cursor, VS Code (Copilot), Windsurf, Gemini CLI and LM Studio. It speaks the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), so any app that supports local MCP servers can use it.

## Connecting an app

Open **Settings → AI apps** in Glance. Every supported app installed for your Windows user has a **Connect** button, which adds Glance to that app's MCP settings. Restart the app if it's open. **Disconnect** removes Glance again.

Glance keeps everything else in those settings files as it was. The first time it changes a file, it saves a copy of the original next to it (`….glance-backup`). Files with comments (JSONC) are left alone; add Glance to those by hand.

For any other app, add a local (stdio) MCP server that runs `glance-mcp.exe`, installed next to Glance (Settings → AI apps → Copy command):

```json
{
  "mcpServers": {
    "glance": { "command": "C:\\Users\\you\\AppData\\Local\\Glance\\glance-mcp.exe", "args": [] }
  }
}
```

In Claude Code you can also run `claude mcp add --scope user glance -- "%LOCALAPPDATA%\Glance\glance-mcp.exe"`.

The Microsoft Store version installs `glance-mcp.exe` as an app alias in `%LOCALAPPDATA%\Microsoft\WindowsApps`, so the command keeps working across updates.

On Linux, the .deb and .rpm install `/usr/bin/glance-mcp`. The Flatpak's command is `flatpak run --command=glance-mcp io.github.redtrocks.glance` (Settings → AI apps → Copy command shows it); AI apps that are themselves Flatpaks can't run it.

## What AI apps can do

| Tool | What it does |
|---|---|
| `glance_info` | Kind, size, pages, image size, PDF properties, photo metadata |
| `glance_view` | Shows a page or image to the AI: PDF, EPS, XPS, TIFF, comics, RAW, HEIC, PSD, JPEG XL and every other format Glance opens |
| `glance_read_text` | Text of a PDF or image; scanned pages and images are read with Windows OCR |
| `glance_convert` | Saves a page or image as PNG, JPEG, WebP, TIFF, BMP or PDF |
| `glance_combine` | Combines PDFs and images into one PDF |
| `glance_pdf_pages` | Extracts, deletes, rotates or reorders pages, or splits a PDF |
| `glance_redact` | Redacts words, patterns (emails, phone, card and ID numbers, IBANs, dates) or a regex so the text is really gone |
| `glance_remove_location` | Copies a photo without its GPS location |
| `glance_open` | Opens files in the Glance window, optionally at a page |
| `glance_list_open` | Lists the open tabs and the page you're on |
| `glance_current_view` | The page you're looking at, as an image with its text, unsaved markup included |
| `glance_go_to_page` | Shows a page in an open document |
| `glance_mark_redactions` | Marks text for redaction in an open PDF, for you to review and apply |
| `glance_text_layout` | Paragraphs on a page of an open PDF or image, with where each is and its font, size, colour and line spacing |
| `glance_edit_text` | Changes or deletes text in an open PDF or image in the same style; the words after it move along |
| `glance_add_text` | Writes new text after or before a paragraph, or at a point, in the page's own style |
| `glance_erase` | Removes a paragraph or an area by covering it with its background |

The four editing tools add markup to the open document, so you can see, undo or keep each change before saving ([ADR 0015](adr/0015-ai-edits-as-matching-markup.md)).

Tools never change the files they're given. Every edit writes a new file, and Glance refuses to overwrite an existing file unless the AI app asks for it explicitly (never the input itself, and never a file with unsaved changes open in Glance). Marked redactions in the window stay pending until you choose Apply Redactions.

Turn **Let AI apps use Glance** off in Settings → AI apps to refuse all requests.

## How it works

AI apps start `glance-mcp.exe` and talk JSON-RPC over its standard input and output. `glance-mcp` (src-tauri/mcp-bridge, a few hundred kilobytes) answers the handshake and the tool list itself and relays tool calls to the Glance app over a loopback connection that only your Windows user can open: Glance listens on a random local port and writes the port and a secret token to `%LOCALAPPDATA%\io.github.redtrocks.glance\mcp-endpoint`; `glance-mcp` must present the token.

You never need to open Glance for an AI app: when a tool is first used and Glance isn't running, `glance-mcp` starts it with its window hidden, and if you quit Glance, the next tool call starts it again. Glance quits again a few seconds after the last AI app disconnects, unless a tool or you showed the window. The tools run in Glance itself (src/state/mcpTools.ts), with the same decoders, PDF engine, OCR and redaction as the app ([ADR 0014](adr/0014-ai-apps-through-mcp.md)).

## Privacy

Glance sends nothing anywhere. An AI app you connect, however, sends what it reads through Glance (page images, text, file names) to its AI provider, like anything else it reads on your PC.
