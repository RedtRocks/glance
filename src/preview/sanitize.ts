/**
 * HTML written by someone else (Markdown, e-books, email) goes through DOMPurify,
 * and nothing in it may reach the network: Glance works on the device only.
 */
import DOMPurify from 'dompurify'

/** Tags that would restyle or act on the app around the document. */
const FORBID_TAGS = ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'track']

/**
 * Cleans a fragment for showing inside the app. It comes back in a detached
 * document, where pictures don't load yet: callers point them at local copies
 * (keepImagesLocal) and then move it in with adopt(). Markdown task lists keep
 * their (disabled) check boxes.
 */
export function cleanFragment(html: string, opts: { checkboxes?: boolean } = {}): HTMLElement {
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: opts.checkboxes ? FORBID_TAGS.filter((t) => t !== 'input') : FORBID_TAGS })
  const body = new DOMParser().parseFromString(`<!doctype html><body>${clean}`, 'text/html').body
  for (const input of body.querySelectorAll('input')) {
    if (input.type === 'checkbox') input.disabled = true
    else input.remove()
  }
  return body
}

/** Moves a cleaned body's contents into the app's document. */
export function adopt(body: HTMLElement): DocumentFragment {
  const frag = document.createDocumentFragment()
  for (const node of [...body.childNodes]) frag.append(document.adoptNode(node))
  return frag
}

/** Cleans a whole HTML document (an email) that will be shown in its own frame, keeping its styles. */
export function cleanDocument(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'track']
  })
}

/** True for addresses that stay on the device. */
export const isLocalUrl = (src: string): boolean => /^(data:|blob:)/i.test(src.trim())

/**
 * Pictures from the web are not fetched: each becomes a link to the picture
 * (opened in the browser if the reader asks), or its description when it has no address.
 * `resolve` maps a document-relative address to a local one, or null.
 */
export function keepImagesLocal(root: ParentNode, resolve: (src: string) => string | null = () => null): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    img.removeAttribute('srcset')
    const src = img.getAttribute('src') ?? ''
    if (isLocalUrl(src)) continue
    const local = resolve(src)
    if (local) {
      img.setAttribute('src', local)
      continue
    }
    const label = img.getAttribute('alt') || src.split(/[/?#]/).filter(Boolean).pop() || ''
    const link = img.ownerDocument.createElement('a')
    link.className = 'blocked-image'
    link.textContent = label
    if (/^https?:/i.test(src)) link.setAttribute('href', src)
    img.replaceWith(link)
  }
  // SVG pictures and backgrounds point at files the same way.
  for (const el of root.querySelectorAll('image, [background]')) {
    for (const attr of ['href', 'xlink:href', 'background']) {
      const v = el.getAttribute(attr)
      if (v == null || isLocalUrl(v)) continue
      const local = resolve(v)
      if (local) el.setAttribute(attr, local)
      else el.removeAttribute(attr)
    }
  }
}
