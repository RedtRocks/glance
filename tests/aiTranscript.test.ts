import { describe, expect, it } from 'vitest'
import * as acp from '@agentclientprotocol/sdk'
import { applyUpdate, chatTitle, modelOption, preamble, type Part } from '../src/core/ai/transcript'

const chunk = (text: string, kind: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk' = 'agent_message_chunk'): acp.SessionUpdate => ({
  sessionUpdate: kind,
  content: { type: 'text', text }
})

describe('applyUpdate', () => {
  it('joins streamed text into one answer', () => {
    let parts: Part[] = [{ kind: 'user', text: 'Hi' }]
    for (const c of ['Hel', 'lo ', 'there']) parts = applyUpdate(parts, chunk(c))
    expect(parts).toEqual([{ kind: 'user', text: 'Hi' }, { kind: 'text', text: 'Hello there' }])
  })

  it('keeps thinking apart from the answer', () => {
    let parts: Part[] = []
    parts = applyUpdate(parts, chunk('hmm', 'agent_thought_chunk'))
    parts = applyUpdate(parts, chunk('Answer'))
    expect(parts.map((p) => p.kind)).toEqual(['thought', 'text'])
  })

  it('tracks tool calls by id', () => {
    let parts: Part[] = []
    parts = applyUpdate(parts, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Reading page 2', status: 'in_progress' })
    parts = applyUpdate(parts, chunk('Found it'))
    parts = applyUpdate(parts, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    expect(parts[0]).toEqual({ kind: 'tool', id: 't1', title: 'Reading page 2', status: 'completed' })
    expect(parts).toHaveLength(2)
  })

  it('updates the plan in place within a turn', () => {
    let parts: Part[] = [{ kind: 'user', text: 'Do it' }]
    const plan = (status: 'pending' | 'completed'): acp.SessionUpdate => ({ sessionUpdate: 'plan', entries: [{ content: 'Read', priority: 'high', status }] })
    parts = applyUpdate(parts, plan('pending'))
    parts = applyUpdate(parts, chunk('…'))
    parts = applyUpdate(parts, plan('completed'))
    expect(parts.filter((p) => p.kind === 'plan')).toEqual([{ kind: 'plan', entries: [{ content: 'Read', status: 'completed' }] }])
  })

  it('ignores updates it doesn’t show', () => {
    const parts: Part[] = []
    expect(applyUpdate(parts, { sessionUpdate: 'available_commands_update', availableCommands: [] })).toBe(parts)
  })
})

describe('modelOption', () => {
  it('finds the model picker, flattening groups', () => {
    const m = modelOption([
      { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'fast',
        options: [{ group: 'g', name: 'G', options: [{ value: 'fast', name: 'Fast' }, { value: 'smart', name: 'Smart', description: 'Best' }] }]
      }
    ])
    expect(m).toEqual({ id: 'model', current: 'fast', choices: [{ value: 'fast', name: 'Fast', description: undefined }, { value: 'smart', name: 'Smart', description: 'Best' }] })
    expect(modelOption(null)).toBeNull()
  })
})

describe('chat helpers', () => {
  it('titles a chat by its first question', () => {
    expect(chatTitle([{ kind: 'user', text: '  What does\nclause 7 mean? ' }])).toBe('What does clause 7 mean?')
    expect(chatTitle([{ kind: 'user', text: 'x'.repeat(80) }])).toHaveLength(58)
    expect(chatTitle([])).toBe('')
  })

  it('tells the agent about the open document', () => {
    const p = preamble({ name: 'Lease.pdf', path: 'C:\\Docs\\Lease.pdf', page: 2, pages: 6 })
    expect(p).toContain('Lease.pdf (C:\\Docs\\Lease.pdf) open, on page 2 of 6')
    expect(p).toContain('glance_current_view')
  })
})

describe('talking to an agent', () => {
  it('streams an answer through the SDK over newline-delimited JSON', async () => {
    const toAgent = new TransformStream<Uint8Array, Uint8Array>()
    const toClient = new TransformStream<Uint8Array, Uint8Array>()
    let agentConn!: acp.AgentSideConnection
    agentConn = new acp.AgentSideConnection(
      () => ({
        async initialize() {
          return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { promptCapabilities: { image: true } }, authMethods: [] }
        },
        async newSession() {
          return { sessionId: 's1', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'm1', options: [{ value: 'm1', name: 'M1' }] }] }
        },
        async authenticate() {
          return {}
        },
        async prompt({ sessionId, prompt }) {
          const said = prompt.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join(' ')
          for (const piece of ['You said: ', said]) await agentConn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: piece } } })
          return { stopReason: 'end_turn' }
        },
        async cancel() {}
      }),
      acp.ndJsonStream(toClient.writable, toAgent.readable)
    )
    let parts: Part[] = []
    const client = new acp.ClientSideConnection(
      () => ({
        async sessionUpdate({ update }) {
          parts = applyUpdate(parts, update)
        },
        async requestPermission() {
          return { outcome: { outcome: 'cancelled' } }
        }
      }),
      acp.ndJsonStream(toAgent.writable, toClient.readable)
    )
    const init = await client.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { auth: { terminal: true } } })
    expect(init.agentCapabilities?.promptCapabilities?.image).toBe(true)
    const session = await client.newSession({ cwd: '/tmp', mcpServers: [{ name: 'glance', command: 'glance-mcp', args: [], env: [] }] })
    expect(modelOption(session.configOptions)?.current).toBe('m1')
    const res = await client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hello' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] })
    expect(res.stopReason).toBe('end_turn')
    expect(parts).toEqual([{ kind: 'text', text: 'You said: hello [image]' }])
  })
})
