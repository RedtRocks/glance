/**
 * The Ask AI sidebar's chat, as a list of parts built from Agent Client Protocol updates.
 * Pure, so it can be saved, restored and tested without an agent.
 */
import type { ContentBlock, SessionConfigOption, SessionConfigSelectOption, SessionUpdate } from '@agentclientprotocol/sdk'

export type Part =
  /** `context` labels what was attached ("Selected area · page 2"). */
  | { kind: 'user'; text: string; context?: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; id: string; title: string; status: string }
  | { kind: 'plan'; entries: { content: string; status: string }[] }
  | { kind: 'notice'; text: string; error?: boolean }

function blockText(c: ContentBlock): string {
  if (c.type === 'text') return c.text
  if (c.type === 'resource_link') return `[${c.title ?? c.name}](${c.uri})`
  return ''
}

/** Adds one update to the chat. Returns the same array when nothing visible changed. */
export function applyUpdate(parts: Part[], u: SessionUpdate): Part[] {
  const last = parts[parts.length - 1]
  switch (u.sessionUpdate) {
    case 'user_message_chunk': {
      // Agents replay saved chats this way; the live prompt is added by the sidebar itself.
      const text = blockText(u.content)
      if (!text) return parts
      if (last?.kind === 'user') return [...parts.slice(0, -1), { ...last, text: last.text + text }]
      return [...parts, { kind: 'user', text }]
    }
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thought'
      const text = blockText(u.content)
      if (!text) return parts
      if (last?.kind === kind) return [...parts.slice(0, -1), { kind, text: last.text + text }]
      return [...parts, { kind, text }]
    }
    case 'tool_call': {
      const part: Part = { kind: 'tool', id: u.toolCallId, title: u.title, status: u.status ?? 'pending' }
      const i = parts.findIndex((p) => p.kind === 'tool' && p.id === u.toolCallId)
      return i < 0 ? [...parts, part] : parts.map((p, j) => (j === i ? part : p))
    }
    case 'tool_call_update': {
      const i = parts.findIndex((p) => p.kind === 'tool' && p.id === u.toolCallId)
      if (i < 0) return u.title ? [...parts, { kind: 'tool', id: u.toolCallId, title: u.title, status: u.status ?? 'pending' }] : parts
      return parts.map((p, j) => (j === i && p.kind === 'tool' ? { ...p, title: u.title ?? p.title, status: u.status ?? p.status } : p))
    }
    case 'plan': {
      const part: Part = { kind: 'plan', entries: u.entries.map((e) => ({ content: e.content, status: e.status })) }
      // One plan per turn, updated in place.
      let i = parts.length - 1
      while (i >= 0 && parts[i].kind !== 'plan' && parts[i].kind !== 'user') i--
      return i >= 0 && parts[i].kind === 'plan' ? parts.map((p, j) => (j === i ? part : p)) : [...parts, part]
    }
    default:
      return parts
  }
}

export interface Choice {
  value: string
  name: string
  description?: string
}

/** The session's model picker, if the agent offers one. */
export function modelOption(options: SessionConfigOption[] | null | undefined): { id: string; current: string; choices: Choice[] } | null {
  const o = options?.find((x) => x.category === 'model' && x.type === 'select')
  if (!o || o.type !== 'select') return null
  const flat: SessionConfigSelectOption[] = o.options.flatMap((x) => ('group' in x ? x.options : [x]))
  return { id: o.id, current: o.currentValue, choices: flat.map((c) => ({ value: c.value, name: c.name, description: c.description ?? undefined })) }
}

/** What Glance tells the agent before the user's first message in a chat. */
export function preamble(doc: { name: string; path?: string; page?: number; pages?: number } | null): string {
  const lines = [
    'You are the assistant in Glance, a Windows app for viewing and editing PDFs, images and other documents. The user is chatting with you in Glance’s sidebar, next to their document.',
    'Help with whatever they ask about the document: explain it, summarize, find things, check facts, draft text, or edit it. Answer in the user’s language, briefly, in Markdown.',
    'Glance’s tools (the "glance" MCP server) can read the document, see the page the user is looking at (glance_current_view), go to pages, mark redactions, and convert, combine, or edit files. Prefer them over your own file tools for documents and images, and don’t change files unless the user asks.'
  ]
  if (doc) {
    const where = doc.path ? ` (${doc.path})` : ''
    const page = doc.page && doc.pages ? `, on page ${doc.page} of ${doc.pages}` : ''
    lines.push(`The user has ${doc.name}${where} open${page}.`)
  }
  return lines.join('\n')
}

/** A short title for a saved chat: the start of its first question. */
export function chatTitle(parts: Part[]): string {
  const first = parts.find((p) => p.kind === 'user')
  const text = first && first.kind === 'user' ? first.text.replace(/\s+/g, ' ').trim() : ''
  return text.length > 60 ? text.slice(0, 57).trimEnd() + '…' : text
}
