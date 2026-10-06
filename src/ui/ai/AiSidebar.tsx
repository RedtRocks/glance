import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { marked } from 'marked'
import type { Doc } from '../../state/documents'
import { aiOpen, toast } from '../../state/ui'
import * as ai from '../../state/ai'
import type { Part } from '../../core/ai/transcript'
import { cleanFragment, adopt, keepImagesLocal } from '../../preview/sanitize'
import * as platform from '../../platform'
import { Icon } from '../Icon'
import { intlLocale, t } from '../../i18n'

/** Each company's colour, for its badge (custom agents are grey). */
const COLORS: Record<string, string> = {
  claude: '#d97757',
  chatgpt: '#10a37f',
  gemini: '#3b6fd8',
  copilot: '#24292f',
  qwen: '#615ced',
  kimi: '#1f1f1f',
  mistral: '#fa520f',
  opencode: '#4b4b4b'
}

function hint(id: string): string {
  switch (id) {
    case 'claude':
      return t('Sign in with your Claude account (a Pro or Max plan), or a Claude Console account.')
    case 'chatgpt':
      return t('Sign in with your ChatGPT account, free or paid.')
    case 'gemini':
      return t('Sign in with your Google account.')
    case 'copilot':
      return t('Sign in with your GitHub account that has Copilot.')
    case 'qwen':
      return t('Sign in with your Qwen account.')
    case 'kimi':
      return t('Sign in with your Kimi account.')
    case 'mistral':
      return t('Sign in with your Mistral account.')
    case 'opencode':
      return t('Free models built in, or sign in to Z.ai, DeepSeek, xAI and many more.')
    default:
      return t('Your own agent.')
  }
}

function Badge({ id, size = 20 }: { id: string; size?: number }) {
  const name = ai.agentName(id)
  return (
    <span class="ai-badge" style={{ width: size, height: size, background: COLORS[id] ?? '#888', fontSize: size * 0.55 }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  )
}

/** Agent Markdown, cleaned like any other document text; links open in the browser. */
function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => marked.parse(text, { gfm: true, breaks: false, async: false }) as string, [text])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const clean = cleanFragment(html, { checkboxes: true })
    keepImagesLocal(clean)
    el.replaceChildren(adopt(clean))
  }, [html])
  const click = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) void platform.openUrl(href)
  }
  return <div ref={ref} class="ai-md md-body" onClick={click} />
}

function PartView({ part, agent }: { part: Part; agent: string }) {
  switch (part.kind) {
    case 'user':
      return (
        <div class="ai-user">
          {!!part.context?.length && (
            <div class="ai-chips">
              {part.context.map((c) => (
                <span key={c} class="ai-chip">
                  {c}
                </span>
              ))}
            </div>
          )}
          {part.text && <div class="ai-bubble">{part.text}</div>}
        </div>
      )
    case 'text':
      return (
        <div class="ai-answer">
          <div class="ai-who">{ai.agentName(agent)}</div>
          <Markdown text={part.text} />
        </div>
      )
    case 'thought':
      return (
        <details class="ai-thought">
          <summary>{t('Thinking')}</summary>
          <Markdown text={part.text} />
        </details>
      )
    case 'tool':
      return (
        <div class={`ai-tool ${part.status}`}>
          <span class="ai-tool-dot" aria-hidden="true" />
          <span class="ai-tool-title">{part.title}</span>
          {part.status === 'failed' && <span class="ai-tool-status">{t('Failed')}</span>}
        </div>
      )
    case 'plan':
      return (
        <ol class="ai-plan" aria-label={t('Plan')}>
          {part.entries.map((e, i) => (
            <li key={i} class={e.status}>
              {e.content}
            </li>
          ))}
        </ol>
      )
    case 'notice':
      return <p class={`ai-notice${part.error ? ' error' : ''}`}>{part.text}</p>
  }
}

/** The first-run guide: what Ask AI does and how to start. */
function Welcome() {
  return (
    <div class="ai-welcome">
      <h3>{t('Ask AI about your documents')}</h3>
      <p>{t('Chat with the AI you already use, right next to your PDF or image. It can explain, summarize, find things, and edit when you ask.')}</p>
      <ol class="ai-steps">
        <li>
          <strong>{t('Pick an AI company.')}</strong> {t('Claude, ChatGPT, Gemini, Copilot and more. You can switch any time, and pick the model too.')}
        </li>
        <li>
          <strong>{t('Sign in once with your own account.')}</strong> {t('Free accounts work where the company allows it. No API key needed. You stay signed in.')}
        </li>
        <li>
          <strong>{t('Show it what you mean.')}</strong> {t('Use This page, or Select area and drag a box on the document, then type your question.')}
        </li>
      </ol>
      <p class="muted small">
        {t('The AI runs through each company’s own free helper app on your PC. Most need Node.js; Glance tells you if it’s missing and where to get it.')}
      </p>
      <p class="muted small">{t('Chats are saved on this PC for each document. The AI asks before it changes any file.')}</p>
      <button class="btn primary" onClick={() => ai.finishWelcome()}>
        {t('Get started')}
      </button>
    </div>
  )
}

const URL_HINT = 'https://'

/** Ready-made addresses; the user can change any of them. */
const PRESETS: { name: string; kind: 'anthropic' | 'openai'; url: string }[] = [
  { name: 'OpenAI', kind: 'openai', url: '' },
  { name: 'Anthropic', kind: 'anthropic', url: '' },
  { name: 'OpenRouter', kind: 'openai', url: 'https://openrouter.ai/api/v1' },
  { name: 'Z.ai', kind: 'anthropic', url: 'https://api.z.ai/api/anthropic' },
  { name: 'Kimi', kind: 'anthropic', url: 'https://api.moonshot.ai/anthropic' },
  { name: 'DeepSeek', kind: 'anthropic', url: 'https://api.deepseek.com/anthropic' },
  { name: 'Mistral', kind: 'openai', url: 'https://api.mistral.ai/v1' }
]

/** Use an API key: pick a service (or type an address), paste the key. */
function ApiKeyForm({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState(0)
  const [name, setName] = useState(PRESETS[0].name)
  const [kind, setKind] = useState<'anthropic' | 'openai'>(PRESETS[0].kind)
  const [url, setUrl] = useState(PRESETS[0].url)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const choose = (i: number): void => {
    setPreset(i)
    if (i < PRESETS.length) {
      setName(PRESETS[i].name)
      setKind(PRESETS[i].kind)
      setUrl(PRESETS[i].url)
    } else {
      setName('')
      setUrl('')
    }
  }
  const save = async (e: Event): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await ai.addKeyAgent(name, kind, url, key)
      onDone()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form class="ai-key-form" onSubmit={(e) => void save(e)}>
      <h3>{t('Use an API key')}</h3>
      <p class="muted small">{t('Optional. Signing in is easier; an API key is for when you pay a company per use, or run your own server.')}</p>
      <label class="field">
        <span>{t('Service')}</span>
        <select value={preset} onChange={(e) => choose(Number((e.target as HTMLSelectElement).value))}>
          {PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
          <option value={PRESETS.length}>{t('Other…')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('Name in Glance')}</span>
        <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required />
      </label>
      <label class="field">
        <span>{t('Kind of API')}</span>
        <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as 'anthropic' | 'openai')}>
          <option value="openai">{t('OpenAI-compatible')}</option>
          <option value="anthropic">{t('Anthropic-compatible')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('Address (leave empty for the company’s own)')}</span>
        <input value={url} placeholder={URL_HINT} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} spellcheck={false} />
      </label>
      <label class="field">
        <span>{t('API key')}</span>
        <input type="password" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} required autocomplete="off" />
      </label>
      <p class="muted small">{t('The key is kept in Windows Credential Manager on this PC and only given to the AI helper when it starts.')}</p>
      {error && <p class="ai-notice error">{error}</p>}
      <div class="ai-permission-buttons">
        <button class="btn primary" type="submit" disabled={saving || !key.trim() || !name.trim()}>
          {t('Save')}
        </button>
        <button class="btn" type="button" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}

function Companies({ onDone, onKey }: { onDone: () => void; onKey: () => void }) {
  const list = ai.agents.value
  const current = ai.agentId.value
  const add = async (): Promise<void> => {
    const { promptText } = await import('../../state/ui')
    const name = await promptText(t('Add an AI agent'), t('Name'), { ok: t('Next') })
    if (!name?.trim()) return
    const command = await promptText(t('Add an AI agent'), t('Command that starts it in Agent Client Protocol mode, for example: npx -y some-agent --acp'), { ok: t('Add') })
    if (!command?.trim()) return
    try {
      if (await ai.addAgent(name, command)) onDone()
    } catch (e) {
      toast(String(e), 'error')
    }
  }
  return (
    <div class="ai-companies" role="listbox" aria-label={t('AI company')}>
      <p class="muted small">{t('Pick who answers. Each one signs in with your own account.')}</p>
      {list.map((a) => (
        <div key={a.id} class={`ai-company${a.id === current ? ' current' : ''}`}>
          <button
            role="option"
            aria-selected={a.id === current}
            class="ai-company-main"
            onClick={() => {
              ai.chooseAgent(a.id)
              onDone()
            }}
          >
            <Badge id={a.id} size={28} />
            <span class="ai-company-text">
              <span class="ai-company-name">{a.name}</span>
              <span class="ai-company-hint">
                {!a.ready ? t('Needs a free helper app first. Pick it to see how.') : a.api ? t('Uses your API key{address}', { address: a.api.baseUrl ? ` · ${a.api.baseUrl}` : '' }) : hint(a.id)}
              </span>
            </span>
          </button>
          {a.custom && (
            <button class="icon-button" aria-label={t('Remove {agent}', { agent: a.name })} onClick={() => void ai.removeAgent(a.id)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      ))}
      <button class="btn ai-add" onClick={() => void add()}>
        <Icon name="add" size={16} />
        {t('Add your own agent…')}
      </button>
      <button class="btn ai-add" onClick={onKey}>
        <Icon name="lock" size={16} />
        {t('Use an API key…')}
      </button>
      <p class="muted small">{t('Any agent that speaks the Agent Client Protocol works, from any company.')}</p>
    </div>
  )
}

function History({ onDone }: { onDone: () => void }) {
  const doc = ai.chat.value.docPath
  const list = ai.savedChats.value
  const here = list.filter((c) => c.docPath === doc)
  const rest = list.filter((c) => c.docPath !== doc)
  const when = (ms: number) => new Date(ms).toLocaleString(intlLocale.value, { dateStyle: 'medium', timeStyle: 'short' })
  const row = (c: ai.Chat) => (
    <div key={c.id} class="ai-history-row">
      <button
        class="ai-history-main"
        onClick={() => {
          ai.openChat(c)
          onDone()
        }}
      >
        <Badge id={c.agentId} size={18} />
        <span class="ai-history-text">
          <span class="ai-history-title">{ai.titleOf(c)}</span>
          <span class="ai-history-meta">{c.docPath ? `${platform.baseName(c.docPath)} · ${when(c.updatedAt)}` : when(c.updatedAt)}</span>
        </span>
      </button>
      <button class="icon-button" aria-label={t('Delete chat')} onClick={() => ai.deleteChat(c.id)}>
        <Icon name="trash" size={16} />
      </button>
    </div>
  )
  return (
    <div class="ai-history">
      {!list.length && <p class="muted">{t('Your chats will show up here.')}</p>}
      {!!here.length && <h3>{t('This document')}</h3>}
      {here.map(row)}
      {!!rest.length && <h3>{t('Other chats')}</h3>}
      {rest.map(row)}
    </div>
  )
}

function StatusCard() {
  const status = ai.status.value
  const agent = ai.chat.value.agentId
  const name = ai.agentName(agent)
  const problem = ai.problem.value
  if (status === 'starting')
    return (
      <div class="ai-card">
        <span class="spinner" aria-hidden="true" />
        <p>{t('Starting {agent}… The first time can take a minute while its helper app downloads.', { agent: name })}</p>
      </div>
    )
  if (status === 'signIn') {
    const methods = ai.signInMethods.value
    return (
      <div class="ai-card">
        <h3>{t('Sign in to {agent}', { agent: name })}</h3>
        <p>{t('Use your own account. You only do this once; the sign-in is remembered.')}</p>
        <p class="muted small">{hint(agent)}</p>
        {problem && <p class="ai-notice error">{problem.text}</p>}
        {methods.map((m) => (
          <button key={m.id} class="btn primary" onClick={() => void ai.signIn(m)}>
            {m.name}
          </button>
        ))}
        {!methods.length && <p class="muted">{t('{agent} has no sign-in Glance can start. Sign in with its own app, then try again.', { agent: name })}</p>}
        {methods.some((m) => 'type' in m && m.type === 'terminal') && (
          <p class="muted small">{t('A window opens for signing in. Follow the steps there, then close it to come back here.')}</p>
        )}
      </div>
    )
  }
  if (status === 'missing') {
    const info = ai.agents.value.find((a) => a.id === agent)
    const uv = problem?.install?.includes('astral')
    return (
      <div class="ai-card">
        <h3>{t('One more step for {agent}', { agent: name })}</h3>
        <p>{problem?.text}</p>
        <ol class="ai-steps">
          <li>{uv ? t('Install uv, a free helper from Astral.') : t('Install Node.js (the LTS version), a free helper app.')}</li>
          <li>{t('Close and reopen Glance.')}</li>
          <li>{t('Pick {agent} again and sign in.', { agent: name })}</li>
        </ol>
        {problem?.install && (
          <button class="btn primary" onClick={() => void platform.openUrl(problem.install!)}>
            {uv ? t('Get uv') : t('Get Node.js')}
          </button>
        )}
        {info?.command && <p class="muted small">{t('Glance runs: {command}', { command: info.command })}</p>}
      </div>
    )
  }
  if (status === 'failed' && problem)
    return (
      <div class="ai-card">
        <p class="ai-notice error">{problem.text}</p>
        <button class="btn" onClick={() => void ai.ensureSession()}>
          {t('Try again')}
        </button>
      </div>
    )
  return null
}

function PermissionCard() {
  const ask = ai.permission.value
  if (!ask) return null
  return (
    <div class="ai-card ai-permission" role="alertdialog" aria-label={t('{agent} asks', { agent: ai.agentName(ai.chat.value.agentId) })}>
      <p>
        <strong>{t('{agent} wants to:', { agent: ai.agentName(ai.chat.value.agentId) })}</strong> {ask.title}
      </p>
      <div class="ai-permission-buttons">
        {ask.options.map((o) => (
          <button key={o.optionId} class={`btn${o.kind === 'allow_once' ? ' primary' : ''}`} onClick={() => ask.answer(o.optionId)}>
            {o.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function Composer({ doc }: { doc: Doc }) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const working = ai.status.value === 'working'
  const canShow = doc.kind === 'pdf' || doc.kind === 'image'
  useEffect(() => input.current?.focus(), [ai.chat.value.id])
  const send = (): void => {
    if (working) return
    const value = text
    setText('')
    void ai.send(value)
  }
  const attachPage = async (): Promise<void> => {
    try {
      await ai.attachPage(doc)
    } catch (e) {
      toast(String(e), 'error')
    }
  }
  return (
    <div class="ai-composer">
      {!!ai.attachments.value.length && (
        <div class="ai-chips">
          {ai.attachments.value.map((a, i) => (
            <span key={i} class="ai-chip">
              {a.image && <img src={`data:${a.image.mimeType};base64,${a.image.data}`} alt="" />}
              {a.label}
              <button class="ai-chip-x" aria-label={t('Remove {item}', { item: a.label })} onClick={() => ai.removeAttachment(i)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div class="ai-input">
        <label class="sr-only" for="ai-ask">
          {t('Ask about this document')}
        </label>
        <textarea
          id="ai-ask"
          ref={input}
          rows={2}
          value={text}
          placeholder={t('Ask about this document…')}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div class="ai-input-row">
          {canShow && (
            <button class="ai-tool-button" title={t('Drag a box on the document to show the AI just that part')} onClick={() => (ai.selectingArea.value = true)} aria-pressed={ai.selectingArea.value}>
              <Icon name="selectArea" size={16} />
              {t('Select area')}
            </button>
          )}
          {canShow && (
            <button class="ai-tool-button" title={t('Show the AI the page you’re looking at')} onClick={() => void attachPage()}>
              <Icon name="onePage" size={16} />
              {t('This page')}
            </button>
          )}
          <div class="tb-spacer" />
          {working ? (
            <button class="ai-send" aria-label={t('Stop')} title={t('Stop')} onClick={() => void ai.stop()}>
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button class="ai-send" aria-label={t('Send')} title={t('Send (Enter)')} disabled={!text.trim() && !ai.attachments.value.length} onClick={send}>
              <Icon name="sendUp" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Ask AI: a chat with the user's chosen AI company about the open document. */
export function AiSidebar({ doc }: { doc: Doc }) {
  const [view, setView] = useState<'chat' | 'companies' | 'history' | 'apiKey'>('chat')
  const scroller = useRef<HTMLDivElement>(null)
  const c = ai.chat.value
  const model = ai.model.value
  const welcomed = ai.welcomed.value

  useEffect(() => {
    void ai.refreshAgents().then(() => {
      if (ai.welcomed.peek() && ai.status.peek() === 'idle') void ai.ensureSession()
    })
  }, [])
  useEffect(() => {
    if (welcomed && ai.status.peek() === 'idle') setView('companies')
  }, [welcomed])
  // Follow the answer as it streams in, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
  }, [c.parts])

  const agent = ai.agents.value.find((a) => a.id === c.agentId)
  return (
    <aside class="side-pane ai-pane" aria-label={t('Ask AI')}>
      <header class="ai-header">
        <button class="ai-who-button" aria-label={t('AI company: {agent}. Change', { agent: agent?.name ?? c.agentId })} aria-expanded={view === 'companies'} onClick={() => setView(view === 'companies' ? 'chat' : 'companies')}>
          <Badge id={c.agentId} />
          <span class="ai-who-name">{agent?.name ?? c.agentId}</span>
          <Icon name="chevronSmall" size={12} />
        </button>
        <div class="tb-spacer" />
        <button class={`icon-button${view === 'history' ? ' pressed' : ''}`} aria-label={t('Past chats')} title={t('Past chats')} onClick={() => setView(view === 'history' ? 'chat' : 'history')}>
          <Icon name="history" size={16} />
        </button>
        <button
          class="icon-button"
          aria-label={t('New chat')}
          title={t('New chat')}
          onClick={() => {
            ai.startNewChat()
            setView('chat')
          }}
        >
          <Icon name="chatAdd" size={16} />
        </button>
        <button class="icon-button" aria-label={t('Close')} title={t('Close')} onClick={() => (aiOpen.value = false)}>
          <Icon name="close" size={16} />
        </button>
      </header>
      {model && view === 'chat' && (
        <div class="ai-model">
          <label for="ai-model">{t('Model')}</label>
          <select id="ai-model" value={model.current} disabled={ai.status.value === 'working'} onChange={(e) => void ai.chooseModel((e.target as HTMLSelectElement).value)}>
            {model.choices.map((m) => (
              <option key={m.value} value={m.value} title={m.description}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div class="ai-body" ref={scroller}>
        {!welcomed ? (
          <Welcome />
        ) : view === 'companies' ? (
          <Companies onDone={() => setView('chat')} onKey={() => setView('apiKey')} />
        ) : view === 'apiKey' ? (
          <ApiKeyForm onDone={() => setView('chat')} />
        ) : view === 'history' ? (
          <History onDone={() => setView('chat')} />
        ) : (
          <>
            {!c.parts.length && ai.status.value === 'ready' && (
              <div class="ai-empty">
                <p>{t('Ask {agent} anything about {file}.', { agent: agent?.name ?? c.agentId, file: doc.name.value })}</p>
                <p class="muted small">{t('Try: “Summarize this”, “What does this clause mean?”, or Select area and ask about a chart.')}</p>
              </div>
            )}
            {c.parts.map((p, i) => (
              <PartView key={i} part={p} agent={c.agentId} />
            ))}
            {ai.status.value === 'working' && c.parts[c.parts.length - 1]?.kind === 'user' && (
              <p class="ai-thinking muted">
                <span class="spinner" aria-hidden="true" />
                {t('{agent} is working…', { agent: agent?.name ?? c.agentId })}
              </p>
            )}
            <PermissionCard />
            <StatusCard />
          </>
        )}
      </div>
      {welcomed && view === 'chat' && <Composer doc={doc} />}
    </aside>
  )
}
