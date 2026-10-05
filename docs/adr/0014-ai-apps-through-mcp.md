# AI apps use Glance through MCP, with the tools running in the app

The maintainer wants AI apps (Claude Code, Claude Desktop, Codex, Antigravity, Muse Code and others) to be able to use Glance, including what's open in its window. They all speak the Model Context Protocol, and on the desktop they start an MCP server as a program and talk JSON-RPC over its stdin and stdout.

glance.exe can't be that program: it is a GUI-subsystem program, a second launch hands its arguments to the running instance and exits (single-instance plugin), and an AI app's process tree is torn down when it stops, which would take the user's window with it. So a small std-only console program, `glance-mcp.exe` (src-tauri/mcp-bridge), relays the messages unchanged to the running Glance over loopback TCP. The port and a secret token are in a file only the user can read; the token keeps other local users and web pages out. A named pipe was the other option, but synchronous pipe handles serialize reads and writes, and TCP behaves the same on every platform, so the bridge and the app's listener are tested on Linux CI too.

The MCP server and the tools live in the UI (src/core/mcp, src/state/mcpTools.ts), not in Rust: the PDF engine (PDF.js, pdf-lib), redaction, rendering of every format, and the open tabs are all there. When no Glance is running, glance-mcp starts it with `--mcp`: the window stays hidden until a tool shows it, and Glance quits a few seconds after the last AI app disconnects.

## Consequences
- Tools never modify their inputs; edits go to a new `output_path` (the maintainer's choice), and overwriting any existing file needs an explicit `overwrite`.
- Settings → AI apps writes a `glance` entry into each installed app's MCP config file, keeping the rest of the file and a one-time backup. Config locations change between app versions; `src-tauri/src/mcp/apps.rs` lists them.
- A claude.ai connector for cloud sessions needs a hosted (remote) MCP server instead; it would reuse the web build's code, not this bridge.
