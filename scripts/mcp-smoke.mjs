#!/usr/bin/env node
/**
 * End-to-end check of the AI tools, the way an AI app uses them: starts glance-mcp,
 * speaks MCP over its stdin/stdout, and calls tools on a generated PDF. glance-mcp
 * starts Glance in the background (hidden window) and Glance quits when we disconnect.
 *
 *   node scripts/mcp-smoke.mjs <path to glance-mcp(.exe)> [--live]
 *
 * --live also opens the PDF in the window and uses the live tools; Glance then stays
 * open (as it would for a user).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'

const bridge = process.argv[2]
const live = process.argv.includes('--live')
/** The email address in the test letter. */
const hasEmail = (t) => /jane\.doe@/.test(t)
// Node can't stat the Store package's app alias (a reparse point), only start it.
const alias = /[\\/]WindowsApps[\\/]/i.test(bridge ?? '')
if (!bridge || (!alias && !existsSync(bridge))) throw new Error(`usage: mcp-smoke.mjs <glance-mcp>; not found: ${bridge}`)

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
child.on('error', (e) => {
  console.error(`couldn't start ${bridge}: ${e.message}`)
  process.exit(1)
})
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
/** Where Glance writes its endpoint (src-tauri/src/mcp/endpoint.rs). */
function endpointDir() {
  if (process.env.GLANCE_MCP_DIR) return process.env.GLANCE_MCP_DIR
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA, 'io.github.redtrocks.glance')
  const abs = (key) => (process.env[key]?.startsWith('/') ? process.env[key] : undefined)
  if (abs('XDG_RUNTIME_DIR')) return join(abs('XDG_RUNTIME_DIR'), 'glance')
  return join(abs('XDG_STATE_HOME') ?? join(abs('HOME') ?? '/', '.local/state'), 'glance')
}
const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
function check(ok, what) {
  if (!ok) throw new Error(`failed: ${what}`)
  console.log(`ok - ${what}`)
}

/** Flatpak runs Glance in its own PID namespace: find the host PID whose innermost PID is `pid`. */
// ponytail: first match wins; two sandboxes reusing the PID would confuse it (CI runs one).
function hostPid(pid) {
  if (process.platform !== 'linux') return pid
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      const s = readFileSync(`/proc/${d}/status`, 'utf8')
      if (/^Name:\s+glance$/m.test(s) && Number(/^NSpid:\s+(.+)$/m.exec(s)?.[1].trim().split(/\s+/).at(-1)) === pid) return Number(d)
    } catch {}
  }
  return pid
}

try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } })
  check(init.serverInfo.name === 'glance', `initialize (Glance ${init.serverInfo.version}, protocol ${init.protocolVersion})`)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  const { tools } = await request('tools/list', {})
  check(tools.length >= 13 && tools.some((t) => t.name === 'glance_redact'), `tools/list (${tools.length} tools)`)

  const info = (await tool('glance_info', { path: input })).structuredContent
  check(info.kind === 'pdf' && info.pages === 2, 'glance_info reads the page count')

  check(hasEmail(text(await tool('glance_read_text', { path: input, ocr: 'never' }))), 'glance_read_text finds the text')

  const view = await tool('glance_view', { path: input, max_size: 400 })
  const image = view.content.find((c) => c.type === 'image')
  check(image?.mimeType === 'image/png' && Buffer.from(image.data, 'base64').subarray(1, 4).toString() === 'PNG', 'glance_view returns a PNG')

  const redacted = join(dir, 'letter (redacted).pdf')
  const report = text(await tool('glance_redact', { path: input, output_path: redacted, patterns: ['email'] }))
  check(existsSync(redacted) && report.includes('1 match'), 'glance_redact writes a redacted copy')
  check(!hasEmail(text(await tool('glance_read_text', { path: redacted, ocr: 'never' }))), 'the redacted text is gone')
  check(readFileSync(input).length > 0 && hasEmail(text(await tool('glance_read_text', { path: input, ocr: 'never' }))), 'the original is untouched')

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

  // The user quits Glance mid-session: the next call starts it again.
  const endpoint = join(endpointDir(), 'mcp-endpoint')
  const pidOf = () => Number(readFileSync(endpoint, 'utf8').trim().split(/\s+/)[2])
  const pid = pidOf()
  process.kill(hostPid(pid))
  // (On Linux the killed Glance stays a zombie of glance-mcp, so don't wait for it to vanish.)
  await new Promise((r) => setTimeout(r, 2000))
  check((await tool('glance_info', { path: input })).structuredContent.pages === 2 && pidOf() !== pid, 'after Glance quits, the next call starts it again')

  if (live) {
    const opened = (await tool('glance_open', { paths: [input], page: 2 })).structuredContent.opened
    check(opened.length === 1 && opened[0].page === 2, 'glance_open shows page 2')
    const tabs = (await tool('glance_list_open', {})).structuredContent.tabs
    check(tabs.some((t) => t.active && t.path === input), 'glance_list_open lists the active tab')
    await tool('glance_go_to_page', { page: 1 })
    const current = await tool('glance_current_view', { max_size: 400 })
    check(current.content.some((c) => c.type === 'image') && hasEmail(text(current)), 'glance_current_view returns page 1 with its text')
    check(text(await tool('glance_mark_redactions', { patterns: ['email'] })).includes('1 match'), 'glance_mark_redactions marks the email for review')
  }
  // Like an AI app: close glance-mcp's input and wait for its output to end. If Glance
  // inherited glance-mcp's pipes, the output never ends.
  const closed = new Promise((resolve) => child.on('close', resolve))
  child.stdin.end()
  const timer = setTimeout(() => {
    console.error('glance-mcp output stayed open after it exited (Glance holds the pipe?)')
    process.exit(1)
  }, 20_000)
  await closed
  clearTimeout(timer)
  check(true, 'glance-mcp exits and its output closes')
  console.log('all good')
  process.exitCode = 0
} catch (e) {
  console.error(e.message)
  child.kill()
  process.exit(1)
}
