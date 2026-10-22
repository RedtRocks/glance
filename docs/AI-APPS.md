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
| `glance_templates` | Lists the designed deck and document templates and each slide design's text slots, with sample text and how many characters fit |
| `glance_create` | Makes a deck from layouts, or from a template's designs in any order, and opens it in Glance |
| `glance_deck_outline`, `glance_deck_edit` | Read a deck and change it: add, move, restyle and fill slides, as one step you can undo |
| `glance_deck_check`, `glance_deck_render` | List what to fix in a deck, and look at its slides as pictures |
| `glance_doc_outline`, `glance_doc_edit` | Read a document (sections, text boxes with how many characters fit, table rows, blocks) and change it as one step you can keep or undo |
| `glance_doc_check`, `glance_doc_render` | List what to fix in a document, and look at its pages as pictures |
| `glance_word_replace` | Replaces text in a Word file, writing a new file |
| `glance_create` with kind `spreadsheet` | Makes a workbook, empty or from one of the spreadsheet templates `glance_templates` lists, and opens it in Glance |
| `glance_sheet_read` | Reads a spreadsheet: its sheets, tables and headers, drop-downs and rules, charts, the user's selection and the cells with their values and formulas |
| `glance_sheet_edit` | Changes a spreadsheet: cells, formulas, rows, columns, sheets, formats, rules, drop-downs, charts, sort, filter and frozen panes, as one step you can undo |
| `glance_sheet_check`, `glance_sheet_render` | List formula errors and broken rules in a spreadsheet, and look at a sheet as a picture |
| `glance_export` | Saves a deck as PDF, PowerPoint or PNG pictures, a document as PDF, Word or PNG pictures, or a spreadsheet as .xlsx, .csv, PDF or PNG |
| `glance_plan` | Shows the AI's plan for a new file on Glance's Outline screen, for you to change before it builds |

### Skills and prompts

Glance gives every AI app the same design and writing guidance ([ADR 0019](adr/0019-skills-given-to-any-agent.md)). Its skills (src/skills: `slide-design`, `document-writing`, `spreadsheet-building` and `editing`, each a `SKILL.md` in the shape of Claude's Agent Skills, with examples) are MCP resources at `skill://glance/<name>/SKILL.md`, and the server's instructions tell agents to read the matching one first. Four MCP prompts start the work with the right tools, rules and skills: `create-deck`, `create-document`, `create-spreadsheet` and `edit-file`.

Settings → AI apps lists the skills with an on/off switch, opens the skills folder where you can add your own (a folder with a `SKILL.md`; it replaces Glance's skill of the same name), and can install the skills that are on for Claude Code (`~/.claude/skills/glance-*`) with a note in Codex's `~/.codex/AGENTS.md`, so they are there before the first tool call. Glance never downloads skills.

In the Ask AI sidebar, a request about an open deck, document or spreadsheet reaches the agent with a `<glance-context>` block: the file and tab, what is selected, the template and each slot's maxChars, the tools to use, the check, render and fix loop, the placeholder rule and the skills that fit (src/core/ai/guide.ts).

The four editing tools add markup to the open document, so you can see, undo or keep each change before saving ([ADR 0015](adr/0015-ai-edits-as-matching-markup.md)).

Tools never change the files they're given. Every edit writes a new file, and Glance refuses to overwrite an existing file unless the AI app asks for it explicitly (never the input itself, and never a file with unsaved changes open in Glance). Marked redactions in the window stay pending until you choose Apply Redactions.

Turn **Let AI apps use Glance** off in Settings → AI apps to refuse all requests.

## How it works

AI apps start `glance-mcp.exe` and talk JSON-RPC over its standard input and output. `glance-mcp` (src-tauri/mcp-bridge, a few hundred kilobytes) answers the handshake, the tool and prompt lists and Glance's own skills itself and relays tool calls to the Glance app over a loopback connection that only your Windows user can open: Glance listens on a random local port and writes the port and a secret token to `%LOCALAPPDATA%\io.github.redtrocks.glance\mcp-endpoint`; `glance-mcp` must present the token.

You never need to open Glance for an AI app: when a tool is first used and Glance isn't running, `glance-mcp` starts it with its window hidden, and if you quit Glance, the next tool call starts it again. Glance quits again a few seconds after the last AI app disconnects, unless a tool or you showed the window. The tools run in Glance itself (src/state/mcpTools.ts), with the same decoders, PDF engine, OCR and redaction as the app ([ADR 0014](adr/0014-ai-apps-through-mcp.md)).

## Handing off from Ask AI

The Ask AI sidebar works the other way round: Glance asks the AI company's own agent (Claude through claude-agent-acp, ChatGPT through codex-acp, or whichever company you picked) for what its tools can't make ([ADR 0020](adr/0020-hand-off-to-the-company-agent.md)). It happens when the in-app AI says the rest of a request is beyond Glance's tools, when you ask for a kind of file Glance can't make (a video, audio, an animated GIF, a web page, an SVG, a 3D model or an e-book), or when you tap **Do more with <company>…**.

Glance starts a separate session of that agent, without Glance's tools, gives it your request, the file's path and an empty folder under Glance's app data (`hand-off\<date>`), and opens the file it writes there in a new tab with a **Made by <company>** bar. **Keep** moves the file next to the original (or into Downloads); **Edit with Glance AI** goes back to the chat. Files Glance just made are sent as they are; a file you opened yourself is sent only after you say yes, once per file. Turn this off in **Settings → AI apps → Ask Claude or ChatGPT when Glance can't do it**.

In the website view, files you download from the site are saved in Downloads and open in Glance with an **Opened from <site>** bar (**Settings → AI apps → Open files made on AI websites in Glance**, on by default). **Do more on <site>…** opens the site's new chat with your request filled in, where the site supports it (claude.ai, chatgpt.com, chat.mistral.ai); you press send. Glance never types into or reads the sites. Neither feature is in the browser version.

## Privacy

Glance sends nothing anywhere. An AI app you connect, however, sends what it reads through Glance (page images, text, file names) to its AI provider, like anything else it reads on your PC.
