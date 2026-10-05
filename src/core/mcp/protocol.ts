/**
 * A Model Context Protocol server (tools only), independent of where messages come from.
 *
 * AI apps reach Glance through glance-mcp (src-tauri/mcp-bridge), which relays MCP's
 * JSON-RPC messages unchanged; src/state/mcp.ts feeds them to handle() and sends back
 * what it returns. https://modelcontextprotocol.io/specification
 */

/** Newest first; an AI app asking for another version gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface ToolResult {
  content: Content[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface ToolDefinition {
  name: string
  title?: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  annotations?: Record<string, unknown>
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult | string>

/** A tool's mistake the AI app should see as a failed call (not a protocol error). */
export class ToolError extends Error {}

export interface ServerInfo {
  name: string
  title?: string
  version: string
  instructions?: string
}

type Id = string | number | null
interface Request {
  jsonrpc?: string
  id?: Id
  method?: unknown
  params?: unknown
}
type Response = { jsonrpc: '2.0'; id: Id; result: unknown } | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } }

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603

const fail = (id: Id, code: number, message: string): Response => ({ jsonrpc: '2.0', id, error: { code, message } })

/** Checks arguments against the parts of JSON Schema the tool definitions use. */
export function checkArgs(def: ToolDefinition, args: Record<string, unknown>): string | null {
  for (const key of def.inputSchema.required ?? []) {
    if (args[key] === undefined || args[key] === null) return `missing required argument "${key}"`
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = def.inputSchema.properties?.[key] as { type?: string; enum?: unknown[]; items?: { type?: string } } | undefined
    if (!schema || value === undefined || value === null) continue
    const want = schema.type
    const ok =
      want === 'string' ? typeof value === 'string'
      : want === 'integer' ? Number.isInteger(value)
      : want === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : want === 'boolean' ? typeof value === 'boolean'
      : want === 'array' ? Array.isArray(value) && (!schema.items?.type || value.every((v) => typeof v === (schema.items!.type === 'integer' ? 'number' : schema.items!.type)))
      : want === 'object' ? typeof value === 'object' && !Array.isArray(value)
      : true
    if (!ok) return `argument "${key}" must be ${want === 'array' && schema.items?.type ? `an array of ${schema.items.type}s` : `a${/^[aeiou]/.test(want ?? '') ? 'n' : ''} ${want}`}`
    if (schema.enum && !schema.enum.includes(value)) return `argument "${key}" must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`
  }
  return null
}

export class McpServer {
  private readonly handlers = new Map<string, ToolHandler>()

  constructor(
    private readonly info: ServerInfo,
    private readonly definitions: ToolDefinition[],
    handlers: Record<string, ToolHandler>,
    /** Returns why tools are unavailable right now (the user turned AI access off), or null. */
    private readonly blocked: () => string | null = () => null
  ) {
    for (const d of definitions) {
      const h = handlers[d.name]
      if (!h) throw new Error(`no handler for ${d.name}`)
      this.handlers.set(d.name, h)
    }
  }

  /** Handles one incoming line. Returns the line to send back, or null (notifications). */
  async handleLine(line: string): Promise<string | null> {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return JSON.stringify(fail(null, PARSE_ERROR, 'Parse error'))
    }
    if (Array.isArray(msg)) {
      if (!msg.length) return JSON.stringify(fail(null, INVALID_REQUEST, 'Empty batch'))
      const out = (await Promise.all(msg.map((m) => this.handle(m)))).filter((r): r is Response => !!r)
      return out.length ? JSON.stringify(out) : null
    }
    const res = await this.handle(msg)
    return res ? JSON.stringify(res) : null
  }

  async handle(msg: unknown): Promise<Response | null> {
    if (!msg || typeof msg !== 'object') return fail(null, INVALID_REQUEST, 'Invalid request')
    const req = msg as Request
    const isRequest = 'id' in req && req.id !== undefined
    const id: Id = isRequest ? (req.id as Id) : null
    if (typeof req.method !== 'string') {
      // A response to a request we never send, or garbage.
      return isRequest && !('result' in req || 'error' in req) ? fail(id, INVALID_REQUEST, 'Invalid request') : null
    }
    // Notifications (initialized, cancelled, …) need no answer.
    if (!isRequest) return null
    const params = (req.params && typeof req.params === 'object' ? req.params : {}) as Record<string, unknown>
    try {
      return { jsonrpc: '2.0', id, result: await this.dispatch(req.method, params) }
    } catch (e) {
      if (e instanceof RpcError) return fail(id, e.code, e.message)
      return fail(id, INTERNAL_ERROR, String((e as Error)?.message ?? e))
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.info.name, title: this.info.title, version: this.info.version },
          ...(this.info.instructions ? { instructions: this.info.instructions } : {})
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: this.definitions }
      case 'tools/call':
        return this.call(params)
      // Asked by some apps even when not advertised; empty beats an error.
      case 'resources/list':
        return { resources: [] }
      case 'resources/templates/list':
        return { resourceTemplates: [] }
      case 'prompts/list':
        return { prompts: [] }
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  }

  private async call(params: Record<string, unknown>): Promise<ToolResult> {
    const name = params.name
    const def = this.definitions.find((d) => d.name === name)
    if (typeof name !== 'string' || !def) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${String(name)}`)
    const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
    const problem = checkArgs(def, args)
    if (problem) return errorResult(problem)
    const blocked = this.blocked()
    if (blocked) return errorResult(blocked)
    try {
      const out = await this.handlers.get(name)!(args)
      return typeof out === 'string' ? { content: [{ type: 'text', text: out }] } : out
    } catch (e) {
      return errorResult(String((e as Error)?.message ?? e))
    }
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
