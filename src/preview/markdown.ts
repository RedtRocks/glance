/**
 * Markdown, laid out like a readme: marked turns it into HTML, DOMPurify cleans it,
 * and fenced code gets the same colours as code files.
 */
import { marked } from 'marked'
import { adopt, cleanFragment, keepImagesLocal } from './sanitize'
import { decodeText, highlightInto } from './text'
import { zoomable, type PreviewRendering } from './render'

/** Front matter (the --- block some sites put at the top), shown as code above the text. */
export function splitFrontMatter(text: string): { front: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: null, body: text }
}

export async function renderMarkdown(bytes: Uint8Array, container: HTMLElement): Promise<PreviewRendering> {
  const { front, body } = splitFrontMatter(decodeText(bytes).replace(/\r\n?/g, '\n'))
  const html = await marked.parse(body, { gfm: true, breaks: false })
  const article = document.createElement('article')
  article.className = 'md-body'
  if (front) {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.className = 'language-yaml'
    code.textContent = front
    pre.append(code)
    article.append(pre)
  }
  const clean = cleanFragment(html, { checkboxes: true })
  keepImagesLocal(clean)
  article.append(adopt(clean))
  container.append(article)
  for (const code of article.querySelectorAll<HTMLElement>('pre > code')) {
    const lang = /language-([\w+-]+)/.exec(code.className)?.[1] ?? ''
    if (lang) await highlightInto(code, code.textContent ?? '', lang.toLowerCase())
  }
  return zoomable(article)
}
