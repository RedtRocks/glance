/**
 * The Ask AI sidebar: chats with the AI companies' own agents over the Agent Client
 * Protocol. src-tauri/src/agents.rs starts the programs; this file speaks the protocol,
 * signs in, keeps chats, and passes Glance's own tools (glance-mcp) to every session.
 */
import { signal } from '@preact/signals'
import type * as acp from '@agentclientprotocol/sdk'
import * as platform from '../platform'
import { applyUpdate, chatTitle, modelOption, preamble, type Choice, type Part } from '../core/ai/transcript'
import { activeDoc, ImageDoc, PdfDoc, type Doc } from './documents'
import { settings } from './settings'
import { t } from '../i18n'

// ---------------------------------------------------------------------------
// State the sidebar shows

export interface Attachment {
  label: string
  image?: { data: string; mimeType: string }
  text?: string
}

export interface Chat {
  /** Local id; the agent's session id can change when a chat moves to a new session. */
  id: string
  agentId: string
  sessionId: string | null
  docPath: string | null
  parts: Part[]
  updatedAt: number
}

export type Status = 'idle' | 'starting' | 'signIn' | 'ready' | 'working' | 'missing' | 'failed'

export interface PermissionAsk {
  title: string
  options: acp.PermissionOption[]
  answer: (optionId: string | null) => void
}

const PREFS = 'glance.ai.v1'
const CHATS = 'glance.ai.chats.v1'
const MAX_CHATS = 60

export const agents = signal<platform.AgentInfo[]>([])
export const agentId = signal<string>(prefs().agent ?? 'claude')
export const chat = signal<Chat>(newChat(agentId.peek()))
export const status = signal<Status>('idle')
/** Why the agent can't start or answer. `install` links to what's missing (Node.js, uv). */
export const problem = signal<{ text: string; install?: string } | null>(null)
export const signInMethods = signal<acp.AuthMethod[]>([])
export const permission = signal<PermissionAsk | null>(null)
export const model = signal<{ id: string; current: string; choices: Choice[] } | null>(null)
export const attachments = signal<Attachment[]>([])
/** Drawing a rectangle on the document for "Select area". */
export const selectingArea = signal(false)
export const welcomed = signal<boolean>(prefs().welcomed ?? false)
export const savedChats = signal<Chat[]>(loadChats())

// ---------------------------------------------------------------------------
// Preferences and saved chats (on this PC only)

function prefs(): { agent?: string; welcomed?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PREFS) ?? '{}')
  } catch {
    return {}
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ agent: agentId.peek(), welcomed: welcomed.peek() }))
  } catch {
    // Storage full or blocked: preferences reset next time.
  }
}

function loadChats(): Chat[] {
  try {
    const list = JSON.parse(localStorage.getItem(CHATS) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function storeChat(c: Chat): void {
  if (!c.parts.some((p) => p.kind === 'user')) return
  const list = [c, ...savedChats.peek().filter((x) => x.id !== c.id)].slice(0, MAX_CHATS)
  savedChats.value = list
  try {
    localStorage.setItem(CHATS, JSON.stringify(list))
  } catch {
    // Too big: keep the newest half.
    try {
      localStorage.setItem(CHATS, JSON.stringify(list.slice(0, MAX_CHATS / 2)))
    } catch {
      // Storage blocked; chats last until Glance closes.
    }
  }
}

export function deleteChat(id: string): void {
  savedChats.value = savedChats.peek().filter((c) => c.id !== id)
  try {
    localStorage.setItem(CHATS, JSON.stringify(savedChats.peek()))
  } catch {
    // ignore
  }
  if (chat.peek().id === id) chat.value = newChat(agentId.peek())
}

function newChat(agent: string): Chat {
  const doc = activeDoc.peek()
  return { id: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, agentId: agent, sessionId: null, docPath: realPath(doc), parts: [], updatedAt: Date.now() }
}

export const titleOf = (c: Chat): string => chatTitle(c.parts) || t('New chat')

function realPath(doc: Doc | null | undefined): string | null {
  const p = doc?.path.peek()
  return p && !p.startsWith('browser:') ? p : null
}

export function finishWelcome(): void {
  welcomed.value = true
  savePrefs()
}

// ---------------------------------------------------------------------------
// Connections to agents (one per company, kept while Glance runs)

interface Link {
  agentId: string
  run: number
  cwd: string
  conn: acp.ClientSideConnection
  init: acp.InitializeResponse
  /** Sessions this process knows (new or loaded). */
  sessions: Set<string>
  alive: boolean
}

const links = new Map<string, Promise<Link>>()
const byRun = new Map<number, { out: (line: string) => void; exit: () => void; log: string[] }>()
let listening: Promise<unknown> | null = null
/** Updates for a session being reloaded replay the saved chat; they're not shown again. */
const replaying = new Set<string>()

function listen(): Promise<unknown> {
  listening ??= platform.onAgent((e) => {
    const h = byRun.get(e.run)
    if (!h) return
    if (e.kind === 'out') h.out(e.line)
    else if (e.kind === 'log') h.log.push(e.line) > 200 && h.log.shift()
    else h.exit()
  })
  return listening
}

/** Keeps the latest stderr lines of each run for error messages. */
function lastLog(run: number): string {
  return byRun.get(run)?.log.slice(-6).join('\n') ?? ''
}

async function connect(id: string): Promise<Link> {
  await listen()
  const sdk = await import('@agentclientprotocol/sdk')
  const { run, cwd } = await platform.agentStart(id)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let push!: (line: string) => void
  let end!: () => void
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (line) => controller.enqueue(encoder.encode(line + '\n'))
      end = () => {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    }
  })
  const output = new WritableStream<Uint8Array>({
    write: (chunk) => platform.agentSend(run, decoder.decode(chunk, { stream: true }))
  })
  const link = { agentId: id, run, cwd, sessions: new Set<string>(), alive: true } as Link
  byRun.set(run, {
    out: (line) => push(line),
    exit: () => {
      link.alive = false
      links.delete(id)
      end()
      if (agentId.peek() === id && (status.peek() === 'working' || status.peek() === 'starting')) {
        status.value = 'failed'
        problem.value = { text: t('{agent} stopped unexpectedly.', { agent: agentName(id) }) + (lastLog(run) ? `\n\n${lastLog(run)}` : '') }
      }
    },
    log: []
  })
  link.conn = new sdk.ClientSideConnection(() => client(), sdk.ndJsonStream(output, input))
  link.init = await link.conn.initialize({
    protocolVersion: sdk.PROTOCOL_VERSION,
    clientCapabilities: { auth: { terminal: true } },
    // i18n-ignore: for the agent, not the user
    clientInfo: { name: 'glance', title: 'Glance', version: await appVersion() }
  })
  return link
}

async function appVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return '0'
  }
}

function link(id: string): Promise<Link> {
  let p = links.get(id)
  if (!p) {
    p = connect(id)
    links.set(id, p)
    p.catch(() => links.delete(id))
  }
  return p
}

async function restart(id: string): Promise<void> {
  const p = links.get(id)
  links.delete(id)
  const l = await p?.catch(() => null)
  if (l) {
    l.alive = false
    await platform.agentStop(l.run)
  }
}

/** Requests from the agent: it streams its answer and asks before acting. */
function client(): acp.Client {
  return {
    async sessionUpdate({ sessionId, update }) {
      if (update.sessionUpdate === 'config_option_update') {
        if (chat.peek().sessionId === sessionId) model.value = modelOption(update.configOptions)
        return
      }
      if (replaying.has(sessionId)) return
      const c = chat.peek()
      if (c.sessionId !== sessionId) return
      const parts = applyUpdate(c.parts, update)
      if (parts !== c.parts) chat.value = { ...c, parts }
    },
    requestPermission({ toolCall, options }) {
      return new Promise((resolve) => {
        permission.value = {
          title: toolCall.title ?? '',
          options,
          answer: (optionId) => {
            permission.value = null
            resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
          }
        }
      })
    }
  }
}

export const agentName = (id: string): string => agents.peek().find((a) => a.id === id)?.name ?? id

// ---------------------------------------------------------------------------
// Sessions

async function mcpServers(): Promise<acp.McpServer[]> {
  if (settings.peek().aiApps === false) return []
  const { command } = await platform.aiApps().catch(() => ({ command: '' }))
  return command ? [{ name: 'glance', command, args: [], env: [] }] : []
}

function sessionCwd(l: Link): string {
  const p = chat.peek().docPath
  return p ? platform.dirName(p) : l.cwd
}

const isAuthRequired = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: number }).code === -32000

/** Sign-in choices the user can finish in Glance (API keys come with Settings later). */
function usableMethods(methods: acp.AuthMethod[] | undefined): acp.AuthMethod[] {
  return (methods ?? []).filter((m) => !(m._meta && 'api-key' in m._meta) && !/api.?key|gateway|bedrock|vertex/i.test(m.id))
}

export async function refreshAgents(): Promise<void> {
  agents.value = await platform.agentsList()
}

/** Makes sure the chat has a live session; shows sign-in or what's missing when it can't. */
export async function ensureSession(): Promise<boolean> {
  const c = chat.peek()
  const id = c.agentId
  if (status.peek() === 'working') return true
  status.value = 'starting'
  problem.value = null
  let l: Link
  try {
    l = await link(id)
  } catch (e) {
    const text = String(e)
    if (text.startsWith('not-installed:')) {
      status.value = 'missing'
      problem.value = { text: t('{agent} needs a free helper app that isn’t on this PC yet.', { agent: agentName(id) }), install: text.slice('not-installed:'.length) || undefined }
    } else {
      status.value = 'failed'
      problem.value = { text: t('Couldn’t start {agent}: {error}', { agent: agentName(id), error: text }) }
    }
    return false
  }
  if (chat.peek().id !== c.id) return false
  try {
    const servers = await mcpServers()
    const cwd = sessionCwd(l)
    if (c.sessionId && l.sessions.has(c.sessionId)) {
      // Already live.
    } else if (c.sessionId && l.init.agentCapabilities?.loadSession) {
      replaying.add(c.sessionId)
      try {
        const res = await l.conn.loadSession({ sessionId: c.sessionId, cwd, mcpServers: servers })
        l.sessions.add(c.sessionId)
        model.value = modelOption(res.configOptions)
      } catch (e) {
        if (isAuthRequired(e)) throw e
        // The agent forgot it (or can't load): continue in a new session, carrying the chat over.
        await startSession(l, cwd, servers, true)
      } finally {
        replaying.delete(c.sessionId)
      }
    } else {
      await startSession(l, cwd, servers, !!c.sessionId)
    }
    signInMethods.value = []
    status.value = 'ready'
    return true
  } catch (e) {
    if (isAuthRequired(e)) {
      signInMethods.value = usableMethods(l.init.authMethods)
      status.value = 'signIn'
      return false
    }
    status.value = 'failed'
    problem.value = { text: t('{agent} couldn’t start a chat: {error}', { agent: agentName(id), error: errorText(e) }) + (lastLog(l.run) ? `\n\n${lastLog(l.run)}` : '') }
    return false
  }
}

/** Chats moved to a new session start by retelling the earlier messages. */
const carryOver = new Set<string>()

async function startSession(l: Link, cwd: string, servers: acp.McpServer[], carry: boolean): Promise<void> {
  const res = await l.conn.newSession({ cwd, mcpServers: servers })
  l.sessions.add(res.sessionId)
  const c = chat.peek()
  chat.value = { ...c, sessionId: res.sessionId }
  if (carry) carryOver.add(c.id)
  model.value = modelOption(res.configOptions)
}

function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const data = (e as { data?: unknown }).data
    const detail = typeof data === 'string' ? data : data && typeof data === 'object' && 'details' in data ? String((data as { details: unknown }).details) : ''
    return [String((e as { message: unknown }).message), detail].filter(Boolean).join(': ')
  }
  return String(e)
}

/** Signs in with one of the agent's methods, then starts the chat. */
export async function signIn(method: acp.AuthMethod): Promise<void> {
  const id = chat.peek().agentId
  status.value = 'starting'
  try {
    if ('type' in method && method.type === 'terminal') {
      await platform.agentLogin(id, method.args ?? [], method.env ?? {})
      // The running agent read its sign-in state when it started.
      await restart(id)
    } else {
      const l = await link(id)
      await l.conn.authenticate({ methodId: method.id })
    }
  } catch (e) {
    status.value = 'signIn'
    problem.value = { text: t('Signing in didn’t finish: {error}', { error: errorText(e) }) }
    return
  }
  await ensureSession()
}

// ---------------------------------------------------------------------------
// Chatting

function docContext(doc: Doc | null): Parameters<typeof preamble>[0] {
  if (!doc) return null
  const pages = 'pageCount' in doc ? doc.pageCount.peek() : 0
  const page = 'current' in doc ? doc.current.peek() + 1 : 0
  return { name: doc.name.peek(), path: realPath(doc) ?? undefined, page, pages }
}

function retell(parts: Part[]): string {
  const lines = parts.flatMap((p) => (p.kind === 'user' ? [`User: ${p.text}`] : p.kind === 'text' ? [`You: ${p.text}`] : []))
  return lines.length ? `Earlier in this chat:\n\n${lines.join('\n\n')}` : ''
}

export async function send(text: string): Promise<void> {
  text = text.trim()
  const files = attachments.peek()
  if (!text && !files.length) return
  if (status.peek() === 'working') return
  if (!(await ensureSession())) return
  const l = await link(chat.peek().agentId)
  const c = chat.peek()
  const sessionId = c.sessionId!
  const first = !c.parts.some((p) => p.kind === 'user')
  const blocks: acp.ContentBlock[] = []
  if (first || carryOver.has(c.id)) {
    const intro = [preamble(docContext(activeDoc.peek())), carryOver.has(c.id) ? retell(c.parts) : ''].filter(Boolean).join('\n\n')
    blocks.push({ type: 'text', text: intro })
    carryOver.delete(c.id)
  }
  const images = l.init.agentCapabilities?.promptCapabilities?.image
  for (const a of files) {
    const note = `[Attached: ${a.label}]${a.text ? `\n${a.text}` : ''}`
    blocks.push({ type: 'text', text: note })
    if (a.image && images) blocks.push({ type: 'image', data: a.image.data, mimeType: a.image.mimeType })
  }
  if (files.some((a) => a.image) && !images) {
    // i18n-ignore: for the agent, not the user
    blocks.push({ type: 'text', text: 'This agent can’t receive images here; use the glance_current_view tool to see the page.' })
  }
  blocks.push({ type: 'text', text: text || 'Please look at what I attached.' })
  attachments.value = []
  chat.value = { ...c, parts: [...c.parts, { kind: 'user', text, context: files.map((a) => a.label) }], updatedAt: Date.now() }
  status.value = 'working'
  try {
    const res = await l.conn.prompt({ sessionId, prompt: blocks })
    if (res.stopReason === 'refusal') addNotice(t('{agent} declined to answer that.', { agent: agentName(c.agentId) }))
    else if (res.stopReason === 'max_tokens' || res.stopReason === 'max_turn_requests') addNotice(t('{agent} stopped early. Ask it to continue.', { agent: agentName(c.agentId) }))
    status.value = 'ready'
  } catch (e) {
    if (isAuthRequired(e)) {
      signInMethods.value = usableMethods(l.init.authMethods)
      status.value = 'signIn'
    } else {
      if (status.peek() === 'working') status.value = l.alive ? 'ready' : 'failed'
      addNotice(errorText(e), true)
    }
  } finally {
    const done = chat.peek()
    if (done.id === c.id) storeChat({ ...done, updatedAt: Date.now() })
  }
}

function addNotice(text: string, error = false): void {
  const c = chat.peek()
  chat.value = { ...c, parts: [...c.parts, { kind: 'notice', text, error }] }
}

export async function stop(): Promise<void> {
  const c = chat.peek()
  const p = links.get(c.agentId)
  if (!p || !c.sessionId) return
  permission.peek()?.answer(null)
  await (await p).conn.cancel({ sessionId: c.sessionId })
}

export async function chooseModel(value: string): Promise<void> {
  const c = chat.peek()
  const m = model.peek()
  if (!m || !c.sessionId) return
  model.value = { ...m, current: value }
  try {
    const l = await link(c.agentId)
    const res = await l.conn.setSessionConfigOption({ sessionId: c.sessionId, configId: m.id, value })
    model.value = modelOption(res.configOptions) ?? model.peek()
  } catch (e) {
    model.value = m
    addNotice(errorText(e), true)
  }
}

/** Switches company; the chat starts fresh (earlier chats stay under Past chats). */
export function chooseAgent(id: string): void {
  agentId.value = id
  savePrefs()
  if (chat.peek().agentId !== id || chat.peek().parts.length) chat.value = newChat(id)
  model.value = null
  signInMethods.value = []
  void ensureSession()
}

export function startNewChat(): void {
  if (status.peek() === 'working') void stop()
  chat.value = newChat(agentId.peek())
  model.value = null
  void ensureSession()
}

export function openChat(c: Chat): void {
  if (status.peek() === 'working') void stop()
  agentId.value = c.agentId
  savePrefs()
  chat.value = c
  model.value = null
  void ensureSession()
}

/** Adds the user's custom agent (after Windows asks them to confirm its command). */
export async function addAgent(name: string, command: string): Promise<boolean> {
  const id = await platform.agentAdd(name, command)
  await refreshAgents()
  if (id) chooseAgent(id)
  return !!id
}

export async function removeAgent(id: string): Promise<void> {
  await restart(id)
  await platform.agentRemove(id)
  await refreshAgents()
  if (agentId.peek() === id) chooseAgent('claude')
}

// ---------------------------------------------------------------------------
// What the user shows the AI: this page, or an area they draw

const SIZE = 1600

async function capture(doc: Doc, index: number, crop?: { x: number; y: number; w: number; h: number }): Promise<Attachment['image'] & { text: string }> {
  const { renderTab, encodeForAi } = await import('./mcpTools')
  const r = await renderTab(doc, index, crop ? SIZE * 2 : SIZE)
  let c: HTMLCanvasElement | OffscreenCanvas = r.canvas
  if (crop) {
    const sx = Math.round(crop.x * c.width)
    const sy = Math.round(crop.y * c.height)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(crop.w * c.width))
    out.height = Math.max(1, Math.round(crop.h * c.height))
    out.getContext('2d')!.drawImage(c, sx, sy, out.width, out.height, 0, 0, out.width, out.height)
    c = out
  }
  return { ...(await encodeForAi(c, r.png)), text: crop ? '' : r.text }
}

export async function attachPage(doc: Doc): Promise<void> {
  if (!(doc instanceof PdfDoc || doc instanceof ImageDoc)) return
  const index = doc.current.peek()
  const shot = await capture(doc, index)
  const label = t('Page {page}', { page: index + 1 })
  const text = shot.text ? `Text on ${doc.name.peek()}, page ${index + 1}:\n${shot.text}` : `${doc.name.peek()}, page ${index + 1}`
  attachments.value = [...attachments.peek().filter((a) => a.label !== label), { label, image: { data: shot.data, mimeType: shot.mimeType }, text }]
}

/** `rect` is a fraction of page `index` (0 to 1 on each side). */
export async function attachArea(doc: Doc, index: number, rect: { x: number; y: number; w: number; h: number }): Promise<void> {
  if (!(doc instanceof PdfDoc || doc instanceof ImageDoc)) return
  const shot = await capture(doc, index, rect)
  const label = t('Selected area · page {page}', { page: index + 1 })
  // i18n-ignore: for the agent, not the user
  attachments.value = [...attachments.peek(), { label, image: { data: shot.data, mimeType: shot.mimeType }, text: `An area the user selected on ${doc.name.peek()}, page ${index + 1}` }]
}

export function removeAttachment(i: number): void {
  attachments.value = attachments.peek().filter((_, j) => j !== i)
}
