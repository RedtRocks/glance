#!/usr/bin/env node
/**
 * End-to-end check of the AI tools, the way an AI app uses them: starts glance-mcp,
 * speaks MCP over its stdin/stdout, and calls tools on a generated PDF. glance-mcp
 * starts Glance in the background (hidden window) and Glance quits when we disconnect.
 *
 *   node scripts/mcp-smoke.mjs <path to glance-mcp(.exe)>
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'

const bridge = process.argv[2]
if (!bridge || !existsSync(bridge)) throw new Error(`usage: mcp-smoke.mjs <glance-mcp>; not found: ${bridge}`)

const dir = mkdtempSync(join(tmpdir(), 'glance-mcp-'))
const input = join(dir, 'letter.pdf')
{
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const first = doc.addPage([612, 792])
  first.drawText('Dear Jane,', { x: 72, y: 700, size: 14, font })
  first.drawText('Write to jane.doe@example.com about the lease.', { x: 72, y: 676, size: 14, font })
  doc.addPage([612, 792]).drawText('Page two', { x: 72, y: 700, size: 14, font })
  writeFileSync(input, await doc.save())
}

const child = spawn(bridge, [], { stdio: ['pipe', 'pipe', 'inherit'] })
const pending = new Map()
let nextId = 1
createInterface({ input: child.stdout }).on('line', (line) => {
  const msg = JSON.parse(line)
  pending.get(msg.id)?.(msg)
  pending.delete(msg.id)
})
child.on('exit', (code) => {
  if (pending.size) {
    console.error(`glance-mcp exited (${code}) with requests pending`)
    process.exit(1)
  }
})

function request(method, params, timeout = 120_000) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeout)
    pending.set(id, (msg) => {
      clearTimeout(timer)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    })
  })
}

async function tool(name, args) {
  const r = await request('tools/call', { name, arguments: args })
  if (r.isError) throw new Error(`${name}: ${r.content.map((c) => c.text).join(' ')}`)
  return r
}
const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
function check(ok, what) {
  if (!ok) throw new Error(`failed: ${what}`)
  console.log(`ok - ${what}`)
}

try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } })
  check(init.serverInfo.name === 'glance', `initialize (Glance ${init.serverInfo.version}, protocol ${init.protocolVersion})`)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  const { tools } = await request('tools/list', {})
  check(tools.length >= 13 && tools.some((t) => t.name === 'glance_redact'), `tools/list (${tools.length} tools)`)

  const info = (await tool('glance_info', { path: input })).structuredContent
  check(info.kind === 'pdf' && info.pages === 2, 'glance_info reads the page count')

  check(text(await tool('glance_read_text', { path: input, ocr: 'never' })).includes('jane.doe@example.com'), 'glance_read_text finds the text')

  const view = await tool('glance_view', { path: input, max_size: 400 })
  const image = view.content.find((c) => c.type === 'image')
  check(image?.mimeType === 'image/png' && Buffer.from(image.data, 'base64').subarray(1, 4).toString() === 'PNG', 'glance_view returns a PNG')

  const redacted = join(dir, 'letter (redacted).pdf')
  const report = text(await tool('glance_redact', { path: input, output_path: redacted, patterns: ['email'] }))
  check(existsSync(redacted) && report.includes('1 match'), 'glance_redact writes a redacted copy')
  check(!text(await tool('glance_read_text', { path: redacted, ocr: 'never' })).includes('example.com'), 'the redacted text is gone')
  check(readFileSync(input).length > 0 && text(await tool('glance_read_text', { path: input, ocr: 'never' })).includes('example.com'), 'the original is untouched')

  const refused = await request('tools/call', { name: 'glance_pdf_pages', arguments: { path: input, action: 'rotate', degrees: 90, output_path: input } })
  check(refused.isError, 'refuses to overwrite the input')

  const rotated = join(dir, 'rotated.pdf')
  await tool('glance_pdf_pages', { path: input, action: 'rotate', degrees: 90, output_path: rotated })
  check(existsSync(rotated), 'glance_pdf_pages rotates into a new file')

  const png = join(dir, 'page2.png')
  await tool('glance_convert', { path: input, output_path: png, page: 2, max_size: 300 })
  check(readFileSync(png).subarray(1, 4).toString() === 'PNG', 'glance_convert writes a PNG')

  const combined = join(dir, 'combined.pdf')
  await tool('glance_combine', { inputs: [input, png], output_path: combined })
  check((await tool('glance_info', { path: combined })).structuredContent.pages === 3, 'glance_combine adds PDFs and images')

  check(Array.isArray((await tool('glance_list_open', {})).structuredContent.tabs), 'glance_list_open answers')
  console.log('all good')
  child.stdin.end()
  process.exitCode = 0
} catch (e) {
  console.error(e.message)
  child.kill()
  process.exit(1)
}
