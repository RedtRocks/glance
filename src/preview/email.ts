/**
 * Saved email: .eml (postal-mime) and Outlook .msg (@kenjiuno/msgreader). The
 * header and attachments are drawn by Glance; an HTML body is cleaned and shown in a
 * frame of its own, where its styles can't reach the app, scripts can't run and
 * nothing is fetched from the web (so senders can't see it was opened).
 */
import { t } from '../i18n'
import { cleanDocument, keepImagesLocal } from './sanitize'
import { decodeText } from './text'
import { defuseLinks, type PreviewRendering, type RenderOptions } from './render'
import { bytes as formatBytes } from '../ui/InspectorPane'

export interface MailAttachment {
  name: string
  type: string
  contentId?: string
  inline: boolean
  data: Uint8Array
}

export interface Mail {
  subject: string
  from: string
  to: string
  cc: string
  date: Date | null
  html: string | null
  text: string | null
  attachments: MailAttachment[]
}

const toBytes = (c: ArrayBuffer | Uint8Array | string): Uint8Array => (typeof c === 'string' ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c))

type Address = { name?: string; address?: string; group?: Address[] }
function addressList(list: Address[] | Address | undefined): string {
  const flat = (a: Address): string[] => (a.group ? a.group.flatMap(flat) : [a.name && a.address ? `${a.name} <${a.address}>` : (a.name || a.address || '')])
  return (Array.isArray(list) ? list : list ? [list] : []).flatMap(flat).filter(Boolean).join(', ')
}

export async function readEml(bytes: Uint8Array): Promise<Mail> {
  const PostalMime = (await import('postal-mime')).default
  const m = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer' })
  const date = m.date ? new Date(m.date) : null
  return {
    subject: m.subject ?? '',
    from: addressList(m.from as Address),
    to: addressList(m.to as Address[]),
    cc: addressList(m.cc as Address[]),
    date: date && !isNaN(date.getTime()) ? date : null,
    html: m.html ?? null,
    text: m.text ?? null,
    attachments: m.attachments.map((a, i) => ({
      name: a.filename ?? `${i + 1}`,
      type: a.mimeType,
      contentId: a.contentId?.replace(/^<|>$/g, ''),
      inline: a.disposition === 'inline' || !!a.related,
      data: toBytes(a.content)
    }))
  }
}

export async function readMsg(bytes: Uint8Array): Promise<Mail> {
  const MsgReader = (await import('@kenjiuno/msgreader')).default
  const reader = new MsgReader(bytes.slice().buffer)
  const f = reader.getFileData()
  if (f.error) throw new Error(f.error)
  const people = (kind: string) =>
    (f.recipients ?? [])
      .filter((r) => (r.recipType ?? 'to') === kind)
      .map((r) => (r.name && r.email && r.name !== r.email ? `${r.name} <${r.email}>` : r.name || r.email || ''))
      .filter(Boolean)
      .join(', ')
  const when = f.messageDeliveryTime ?? f.clientSubmitTime
  const date = when ? new Date(when) : null
  const html = f.bodyHtml ?? (f.html ? decodeText(f.html) : null)
  return {
    subject: f.subject ?? '',
    from: f.senderName && f.senderEmail && f.senderName !== f.senderEmail ? `${f.senderName} <${f.senderEmail}>` : (f.senderName ?? f.senderEmail ?? ''),
    to: people('to'),
    cc: people('cc'),
    date: date && !isNaN(date.getTime()) ? date : null,
    html,
    text: f.body ?? null,
    attachments: (f.attachments ?? [])
      .filter((a) => !a.innerMsgContent)
      .map((a, i) => {
        const data = reader.getAttachment(a)
        return {
          name: data.fileName || a.fileName || `${i + 1}`,
          type: a.attachMimeTag ?? '',
          contentId: a.pidContentId?.replace(/^<|>$/g, ''),
          inline: !!a.pidContentId,
          data: data.content
        }
      })
  }
}

export async function renderEmail(ext: string, bytes: Uint8Array, container: HTMLElement, opts: RenderOptions): Promise<PreviewRendering> {
  const mail = ext === 'msg' ? await readMsg(bytes) : await readEml(bytes)
  const urls: string[] = []
  const blobUrl = (a: MailAttachment) => {
    const url = URL.createObjectURL(new Blob([a.data as Uint8Array<ArrayBuffer>], { type: a.type }))
    urls.push(url)
    return url
  }

  const view = document.createElement('div')
  view.className = 'email-view'
  const head = document.createElement('header')
  head.className = 'email-head'
  const h1 = document.createElement('h1')
  h1.textContent = mail.subject || t('No subject')
  head.append(h1)
  const rows: [string, string][] = [
    [t('From'), mail.from],
    [t('To'), mail.to],
    [t('Cc'), mail.cc],
    [t('Date'), mail.date ? mail.date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : '']
  ]
  const dl = document.createElement('dl')
  for (const [label, value] of rows) {
    if (!value) continue
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    dl.append(dt, dd)
  }
  head.append(dl)

  // Pictures the body shows itself aren't listed again as attachments.
  const byCid = new Map(mail.attachments.filter((a) => a.contentId).map((a) => [a.contentId!, a]))
  const usedCids = new Set<string>()
  if (mail.html) for (const m of mail.html.matchAll(/cid:([^"'\s)>]+)/gi)) usedCids.add(decodeURIComponent(m[1]))
  const listed = mail.attachments.filter((a) => !(a.contentId && usedCids.has(a.contentId)))
  if (listed.length) {
    const list = document.createElement('div')
    list.className = 'email-attachments'
    list.setAttribute('role', 'list')
    for (const a of listed) {
      const chip = document.createElement('button')
      chip.className = 'email-attachment'
      chip.setAttribute('role', 'listitem')
      chip.title = t('Open {name}', { name: a.name })
      const name = document.createElement('span')
      name.textContent = a.name
      const size = document.createElement('small')
      size.textContent = formatBytes(a.data.length)
      chip.append(name, size)
      chip.addEventListener('click', () => opts.openAttachment(a.name, a.data))
      list.append(chip)
    }
    head.append(list)
  }
  view.append(head)

  let resize: ResizeObserver | null = null
  if (mail.html) {
    const frame = document.createElement('iframe')
    frame.className = 'email-body'
    frame.title = t('Message')
    // Same origin so the frame can be measured and its links handled; no scripts.
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    const doc = new DOMParser().parseFromString(cleanDocument(mail.html), 'text/html')
    keepImagesLocal(doc, (src) => {
      const m = /^cid:(.+)$/i.exec(src.trim())
      const a = m && byCid.get(decodeURIComponent(m[1]))
      return a ? blobUrl(a) : null
    })
    defuseLinks(doc.body)
    const base = doc.createElement('style')
    base.textContent = 'html{background:#fff;color:#111}body{margin:20px;font:15px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}a.blocked-image{display:inline-block;padding:2px 8px;border:1px dashed #bbb;border-radius:6px;color:#666;font-size:13px;text-decoration:none}'
    doc.head.prepend(base)
    const csp = doc.createElement('meta')
    csp.httpEquiv = 'Content-Security-Policy'
    csp.content = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"
    doc.head.prepend(csp)
    frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML
    view.append(frame)
    await new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true })
      container.append(view)
    })
    const inner = frame.contentDocument
    if (inner) {
      const fit = () => (frame.style.height = `${inner.documentElement.scrollHeight}px`)
      fit()
      resize = new ResizeObserver(fit)
      resize.observe(inner.body)
      inner.addEventListener('click', (e) => {
        const a = (e.target as Element).closest?.('a')
        const href = a?.getAttribute('href')
        if (!a) return
        e.preventDefault()
        if (href && /^(https?:|mailto:)/i.test(href)) opts.openLink(href)
      })
    }
  } else {
    const pre = document.createElement('pre')
    pre.className = 'email-text'
    pre.textContent = mail.text ?? ''
    view.append(pre)
    container.append(view)
  }
  return {
    pageCount: 1,
    sheetNames: [],
    goTo: () => {},
    setZoom: (scale) => (view.style.zoom = String(scale)),
    dispose: () => {
      resize?.disconnect()
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }
}
