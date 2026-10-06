/**
 * Serves AI apps (MCP clients) that reach Glance through glance-mcp; see
 * src-tauri/src/mcp for the transport and mcpTools.ts for the tools.
 */
import catalog from '../core/mcp/tools.json'
import { McpServer, type ToolDefinition } from '../core/mcp/protocol'
import * as platform from '../platform'
import { handlers } from './mcpTools'
import { settings } from './settings'

/**
 * A hidden window (Glance started by an AI app, or minimized) gets no animation frames,
 * and PDF.js renders through them, so tools would wait forever. While the page is
 * hidden, frames come from a timer instead.
 */
function framesWhileHidden(): void {
  const native = window.requestAnimationFrame.bind(window)
  const cancelNative = window.cancelAnimationFrame.bind(window)
  const timers = new Map<number, number>()
  let next = -1
  window.requestAnimationFrame = (cb) => {
    if (document.visibilityState !== 'hidden') return native(cb)
    const id = next--
    timers.set(id, window.setTimeout(() => (timers.delete(id), cb(performance.now())), 16))
    return id
  }
  window.cancelAnimationFrame = (id) => {
    if (id >= 0) return cancelNative(id)
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
}

/** Starts answering AI apps; returns a function that stops. Main window only. */
export async function startMcp(): Promise<() => void> {
  if (!platform.isTauri) return () => {}
  framesWhileHidden()
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
