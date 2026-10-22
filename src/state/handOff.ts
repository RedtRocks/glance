/**
 * Handing off: when Glance can't make something itself (core/ai/handOff.ts), it asks the AI
 * company's own agent, the one the Ask AI sidebar runs, to make it into a folder Glance
 * picks, then opens the file in a new tab with a "Made by …" bar. Files the user downloads
 * from the company's website in the sidebar open the same way. Desktop app only.
 */
import { effect, signal } from '@preact/signals'
import * as platform from '../platform'
import { handOffFolderName, handOffPrompt, madeByName, resultFiles, siteHost, type HandOffFile } from '../core/ai/handOff'
import * as ai from './ai'
import { activeDoc, docs, type Doc } from './documents'
import { settings } from './settings'
import { aiOpen, toast } from './ui'
import { t } from '../i18n'

export type HandOffStep = 'sending' | 'waiting' | 'opening'

export interface HandOff {
  agentId: string
  request: string
  file: string | null
  step: HandOffStep
  /** What the agent is doing now, from its tool calls. */
  doing?: string
  cancel?: () => Promise<void>
}

/** The job being handed off, shown in the sidebar with Stop. */
export const handOff = signal<HandOff | null>(null)

/** Where an open document came from, for its bar: made by the agent, or downloaded from a site. */
export interface Origin {
  kind: 'agent' | 'site'
  /** The company (agent id). */
  agentId: string
  /** For 'site': the site's host, like claude.ai. */
  site?: string
  /** For 'agent': the folder to keep it in (the source file's), or null for Downloads. */
  keepIn?: string | null
}

export const origins = signal<ReadonlyMap<string, Origin>>(new Map())

export function dismissOrigin(doc: Doc): void {
  const next = new Map(origins.peek())
  next.delete(doc.id)
  origins.value = next
}

function setOrigin(doc: Doc, o: Origin): void {
  origins.value = new Map(origins.peek()).set(doc.id, o)
}

// ---------------------------------------------------------------------------
// Which files may go to the AI company

/** Documents Glance made this session (they started with no file on disk). */
const made = new WeakSet<Doc>()
effect(() => {
  for (const d of docs.value) if (d.path.peek() === null) made.add(d)
})

const ALLOWED = 'glance.handOff.allowed.v1'

function allowed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ALLOWED) ?? '[]'))
  } catch {
    return new Set()
  }
}

function allow(path: string): void {
  try {
    localStorage.setItem(ALLOWED, JSON.stringify([...allowed(), path].slice(-200)))
  } catch {
    // Storage blocked: Glance asks again next time.
  }
}

/** The file to send with the job: files Glance made go as they are; ones the user opened are asked about once. */
async function fileFor(doc: Doc | null, company: string): Promise<HandOffFile | null | 'no'> {
  if (!doc || doc.kind === 'notice') return null
  const glanceMade = made.has(doc) || origins.peek().get(doc.id)?.kind === 'agent'
  if (!doc.path.peek()) {
    const { save } = await import('./actions')
    await save(doc)
  }
  const path = doc.path.peek()
  if (!path || path.startsWith('browser:')) return null
  if (!glanceMade && !allowed().has(path)) {
    const ok = await platform.confirmDialog(
      t('Glance will send {file} to {agent} with your request, so it can work on it. Glance asks once for each file you opened yourself.', { file: platform.baseName(path), agent: company }),
      t('Send {file} to {agent}?', { file: platform.baseName(path), agent: company }),
      t('Send')
    )
    if (!ok) return 'no'
    allow(path)
  }
  return { path, made: glanceMade }
}

// ---------------------------------------------------------------------------
// The hand-off

/** Hands `request` about the active document to the sidebar's company. */
export async function startHandOff(request: string): Promise<void> {
  if (!platform.isTauri || handOff.peek() || !request.trim()) return
  const agentId = ai.chat.peek().agentId
  const company = ai.agentName(agentId)
  const doc = activeDoc.peek()
  const file = await fileFor(doc, company)
  if (file === 'no') return
  aiOpen.value = true
  ai.siteView.value = false
  handOff.value = { agentId, request, file: file?.path ?? null, step: 'sending' }
  const here = (): boolean => handOff.peek()?.request === request
  try {
    const dir = await platform.handOffFolder(handOffFolderName(new Date(), Math.random().toString(36).slice(2)))
    const task = await ai.runTask(agentId, dir, handOffPrompt(request, file ? [file] : [], dir), (u) => {
      const h = handOff.peek()
      if (!h || !here()) return
      if (u.sessionUpdate === 'tool_call' && u.title) handOff.value = { ...h, doing: u.title }
    })
    if (!here()) return void task.cancel()
    handOff.value = { ...handOff.peek()!, step: 'waiting', cancel: task.cancel }
    const reason = await task.done
    if (!here()) return
    if (reason === 'cancelled') return void (handOff.value = null)
    handOff.value = { ...handOff.peek()!, step: 'opening' }
    const result = resultFiles(await platform.handOffFiles(dir))[0]
    if (!result) {
      toast(t('{agent} finished without making a file.', { agent: company }), 'error')
      return
    }
    const opened = await openAs(result.path)
    if (opened) setOrigin(opened, { kind: 'agent', agentId, keepIn: file && !file.path.startsWith('browser:') ? platform.dirName(file.path) : null })
  } catch (e) {
    if (here()) toast(t('Couldn’t ask {agent}: {error}', { agent: company, error: String((e as Error).message ?? e) }), 'error')
  } finally {
    if (here()) handOff.value = null
  }
}

/** The in-app AI said the rest is beyond Glance's tools: hand it off, if the setting allows. */
export async function handOffFromChat(request: string): Promise<void> {
  if (settings.peek().handOff === false) return
  await startHandOff(request)
}

export async function stopHandOff(): Promise<void> {
  const h = handOff.peek()
  handOff.value = null
  await h?.cancel?.().catch(() => undefined)
}

async function openAs(path: string): Promise<Doc | null> {
  const { openFiles } = await import('./actions')
  await openFiles([path])
  return docs.peek().find((d) => d.path.peek() === path) ?? null
}

/** Keep: the agent's file moves next to the source file (or into Downloads); a site's is already saved. */
export async function keep(doc: Doc): Promise<void> {
  const o = origins.peek().get(doc.id)
  const path = doc.path.peek()
  if (o?.kind === 'agent' && path) {
    try {
      const to = await platform.handOffKeep(path, o.keepIn ?? null, madeByName(platform.baseName(path), ai.agentName(o.agentId)))
      doc.path.value = to
      doc.name.value = platform.baseName(to)
      toast(t('Saved in {folder}', { folder: platform.dirName(to) }))
    } catch (e) {
      toast(String((e as Error).message ?? e), 'error')
      return
    }
  }
  dismissOrigin(doc)
}

/** Edit with Glance AI: back to Glance's chat in the sidebar, about this file. */
export function editWithGlance(doc: Doc): void {
  dismissOrigin(doc)
  aiOpen.value = true
  ai.siteView.value = false
  ai.startNewChat()
}

// ---------------------------------------------------------------------------
// Downloads from the company websites in the sidebar

let listening = false

export function listenForSiteDownloads(): void {
  if (listening || !platform.isTauri) return
  listening = true
  void platform.onWebsiteDownload(async (e) => {
    if (!e.ok || !e.path) return
    const site = siteHost(ai.agents.peek().find((a) => a.id === e.site)?.website) || ai.agentName(e.site)
    if (settings.peek().openSiteDownloads === false) {
      toast(t('Saved {file} in Downloads', { file: platform.baseName(e.path) }))
      return
    }
    const doc = await openAs(e.path)
    if (doc) setOrigin(doc, { kind: 'site', agentId: e.site, site })
  })
}

/** "Do more on <site>": the site's new chat with the request filled in; the user presses send. */
export async function doMoreOnSite(id: string, url: string): Promise<void> {
  ai.siteView.value = true
  aiOpen.value = true
  // The site's web view may still be opening.
  for (let i = 0; ; i++) {
    try {
      return await platform.websiteGo(id, url)
    } catch (e) {
      if (i >= 20 || !String(e).includes('not open')) throw e
      await new Promise((r) => setTimeout(r, 150))
    }
  }
}
