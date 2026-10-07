import { describe, expect, it } from 'vitest'
import { McpServer, ToolError, checkArgs, type ToolDefinition } from '../src/core/mcp/protocol'
import { checkOutput, matchOcrLines, parsePages, partPath, searchRegexes, toBase64 } from '../src/core/mcp/helpers'
import { samePath } from '../src/core/paths'
import definitions from '../src/core/mcp/tools.json'

const echo: ToolDefinition = {
  name: 'echo',
  description: 'Echoes',
  inputSchema: { type: 'object', properties: { text: { type: 'string' }, n: { type: 'integer' }, mode: { type: 'string', enum: ['a', 'b'] } }, required: ['text'] }
}

function server(blocked: () => string | null = () => null) {
  return new McpServer(
    { name: 'glance', version: '1.2.3', instructions: 'Use Glance.' },
    [echo],
    {
      echo: async (args) => {
        if (args.text === 'boom') throw new ToolError('it broke')
        return String(args.text)
      }
    },
    blocked
  )
}

const call = async (s: McpServer, msg: unknown) => JSON.parse((await s.handleLine(JSON.stringify(msg)))!)

describe('MCP server', () => {
  it('negotiates the protocol version', async () => {
    const s = server()
    const r = await call(s, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
    expect(r).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'glance', version: '1.2.3' }, instructions: 'Use Glance.' }
    })
    const newer = await call(s, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } })
    expect(newer.result.protocolVersion).toBe('2025-11-25')
  })

  it('ignores notifications', async () => {
    expect(await server().handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull()
  })

  it('lists and calls tools', async () => {
    const s = server()
    expect((await call(s, { jsonrpc: '2.0', id: 'a', method: 'tools/list' })).result.tools).toEqual([echo])
    const r = await call(s, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })
    expect(r).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'hi' }] } })
  })

  it('reports tool failures as results the AI can read', async () => {
    const s = server()
    const r = await call(s, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { text: 'boom' } } })
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'it broke' }], isError: true })
    const bad = await call(s, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { n: 1.5 } } })
    expect(bad.result.content[0].text).toBe('missing required argument "text"')
  })

  it('answers unknown tools and methods with errors', async () => {
    const s = server()
    expect((await call(s, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } })).error.code).toBe(-32602)
    expect((await call(s, { jsonrpc: '2.0', id: 7, method: 'sampling/whatever' })).error.code).toBe(-32601)
    expect((await call(s, { jsonrpc: '2.0', id: 8, method: 'ping' })).result).toEqual({})
  })

  it('rejects malformed input', async () => {
    expect(JSON.parse((await server().handleLine('{not json'))!).error.code).toBe(-32700)
  })

  it('handles batches', async () => {
    const out = await call(server(), [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    ])
    expect(out).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }])
  })

  it('refuses calls while AI access is off', async () => {
    const s = server(() => 'AI apps are turned off in Glance')
    const r = await call(s, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'echo', arguments: { text: 'x' } } })
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'AI apps are turned off in Glance' }], isError: true })
  })

  it('checks argument types and enums', () => {
    expect(checkArgs(echo, { text: 'a', n: 2, mode: 'a' })).toBeNull()
    expect(checkArgs(echo, { text: 1 })).toBe('argument "text" must be a string')
    expect(checkArgs(echo, { text: 'a', n: 1.5 })).toBe('argument "n" must be an integer')
    expect(checkArgs(echo, { text: 'a', mode: 'c' })).toBe('argument "mode" must be one of "a", "b"')
  })
})

describe('Glance tool definitions', () => {
  it('are well formed', () => {
    const names = definitions.tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of definitions.tools) {
      expect(t.name).toMatch(/^glance_[a-z_]+$/)
      expect(t.description.length).toBeGreaterThan(20)
      expect(t.inputSchema.type).toBe('object')
      for (const r of (t.inputSchema as { required?: string[] }).required ?? []) expect(Object.keys(t.inputSchema.properties)).toContain(r)
    }
  })
})

describe('AI tool helpers', () => {
  it('parses page lists', () => {
    expect(parsePages(undefined, 3)).toEqual([0, 1, 2])
    expect(parsePages('all', 2)).toEqual([0, 1])
    expect(parsePages('1-3, 7, 2', 10)).toEqual([0, 1, 2, 6])
    expect(parsePages('8-', 10)).toEqual([7, 8, 9])
    expect(parsePages('-2', 10)).toEqual([0, 1])
    expect(() => parsePages('0', 3)).toThrow(ToolError)
    expect(() => parsePages('2-9', 3)).toThrow('outside 1-3')
    expect(() => parsePages('one', 3)).toThrow(ToolError)
  })

  it('never writes over an input', () => {
    expect(() => checkOutput('C:\\a\\out.pdf', ['C:\\a\\in.pdf'], false, false, 'windows')).not.toThrow()
    expect(() => checkOutput('c:/A/IN.pdf', ['C:\\a\\in.pdf'], true, true, 'windows')).toThrow('never overwrites')
    expect(() => checkOutput('C:\\a\\out.pdf', ['C:\\a\\in.pdf'], true, false, 'windows')).toThrow('already exists')
    expect(() => checkOutput('C:\\a\\out.pdf', ['C:\\a\\in.pdf'], true, true, 'windows')).not.toThrow()
    expect(() => checkOutput('out.pdf', [], false, false, 'windows')).toThrow('absolute')
    expect(samePath('C:\\x\\Y.pdf', 'c:/x/y.pdf', 'windows')).toBe(true)
    expect(() => checkOutput('/home/A.pdf', ['/home/a.pdf'], false, false, 'posix')).not.toThrow()
    expect(() => checkOutput('/home/a.pdf', ['/home//a.pdf'], true, true, 'posix')).toThrow('never overwrites')
  })

  it('numbers split parts', () => {
    expect(partPath('C:\\out\\Report.pdf', 2)).toBe('C:\\out\\Report 2.pdf')
    expect(partPath('C:\\out\\Report', 1)).toBe('C:\\out\\Report 1')
  })

  it('builds the redaction search', () => {
    const res = searchRegexes({ terms: ['Jane Doe'], patterns: ['email'], regex: 'AB-\\d+' })
    expect(res).toHaveLength(3)
    expect(() => searchRegexes({})).toThrow('say what to redact')
    expect(() => searchRegexes({ regex: '(' })).toThrow('regex')
  })

  it('finds matches in OCR lines with their word boxes', () => {
    const word = (text: string, x: number) => ({ text, x, y: 10, w: text.length * 10, h: 12 })
    const lines = [{ words: [word('Contact', 0), word('jane@example.com', 80), word('today', 250)] }]
    const found = matchOcrLines(lines, searchRegexes({ patterns: ['email'], terms: ['contact today'] }))
    expect(found.map((f) => f.text)).toEqual(['jane@example.com'])
    const phrase = matchOcrLines(lines, searchRegexes({ terms: ['example.com today'], whole_word: false }))
    expect(phrase[0].boxes.map((b) => b.x)).toEqual([80, 250])
  })

  it('encodes base64', () => {
    expect(toBase64(new TextEncoder().encode('Glance'))).toBe('R2xhbmNl')
    expect(toBase64(new Uint8Array(100_000)).length).toBe(133_336)
  })
})
