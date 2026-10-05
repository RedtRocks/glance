/**
 * Serves AI apps (MCP clients) that reach Glance through glance-mcp; see
 * src-tauri/src/mcp for the transport and mcpTools.ts for the tools.
 */
import catalog from '../core/mcp/tools.json'
import { McpServer, type ToolDefinition } from '../core/mcp/protocol'
import * as platform from '../platform'
import { handlers } from './mcpTools'
import { settings } from './settings'

/** Starts answering AI apps; returns a function that stops. Main window only. */
export async function startMcp(): Promise<() => void> {
  if (!platform.isTauri) return () => {}
  const { getVersion } = await import('@tauri-apps/api/app')
  const server = new McpServer(
    // i18n-ignore: the server's name for AI apps
    { name: 'glance', title: 'Glance', version: await getVersion(), instructions: catalog.instructions },
    catalog.tools as ToolDefinition[],
    handlers,
    () => (settings.peek().aiApps === false ? 'The user turned off AI access in Glance (Settings → AI apps).' : null)
  )
  return platform.onMcp((e) => {
    if (e.type !== 'message') return
    void server
      .handleLine(e.message)
      .then((reply) => (reply ? platform.mcpSend(e.conn, reply) : undefined))
      .catch((err) => console.error('[mcp]', err))
  })
}
