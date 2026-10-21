/**
 * Draws a laid-out page (layout.ts) as HTML: the editor's pages, the page strip's
 * thumbnails and PNG export all use this. Sizes are page units (595 by 842); the caller
 * scales the page with a CSS transform.
 *
 * The art comes from the app (trusted). Text and picture paths come from the document,
 * which an AI app may have written, so all of it is escaped, and pictures only show when
 * `resolveSrc` maps them to a URL.
 */
import { escapeHtml, designTextStyle } from '../deck/html'
import { fontStack } from '../deck/design'
import { PAGE_H, PAGE_W, type DocBoard } from './look'
import type { Item, PageLayout, Seg } from './layout'

export interface DocHtmlOptions {
  resolveSrc: (src: string) => string | null
  /** Hint text for empty text boxes; leave it out to draw nothing there (exports). */
  placeholder?: (sample: string) => string
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`

const fontCss = (f: Seg['font']) =>
  `font-family:${fontStack(f.font)};font-size:${px(f.size)};font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'};font-optical-sizing:none;font-variation-settings:'opsz' ${Math.round(f.size * 10) / 10}${f.letterSpacing ? `;letter-spacing:${px(f.letterSpacing)}` : ''}`

function itemHtml(it: Item, board: DocBoard | undefined, opts: DocHtmlOptions): string {
  switch (it.kind) {
    case 'text': {
      const segs = it.segs.map((s) => `<span style="${escapeHtml(`${fontCss(s.font)};color:${s.colour}${s.underline ? ';text-decoration:underline' : ''}`)}">${escapeHtml(s.text)}</span>`).join('')
      const style = `position:absolute;left:${px(it.x)};top:${px(it.y)};height:${px(it.h)};line-height:${px(it.h)};white-space:pre${it.transform ? `;text-transform:${it.transform}` : ''}`
      return `<div style="${escapeHtml(style)}">${segs}</div>`
    }
    case 'rect': {
      const line = it.stroke ? `box-sizing:border-box;border:${px(it.stroke.w)} ${it.stroke.dashed ? 'dashed' : 'solid'} ${it.stroke.colour};` : ''
      return `<div style="${escapeHtml(`position:absolute;left:${px(it.x)};top:${px(it.y)};width:${px(it.w)};height:${px(it.h)};${line}background:${it.fill ?? 'transparent'};border-radius:${px(it.radius ?? 0)}`)}"></div>`
    }
    case 'path':
      return `<svg style="position:absolute;left:0;top:0;overflow:visible" width="${PAGE_W}" height="${PAGE_H}"><path d="${escapeHtml(it.d)}" fill="${escapeHtml(it.fill ?? 'none')}"${it.stroke ? ` stroke="${escapeHtml(it.stroke.colour)}" stroke-width="${it.stroke.w}" stroke-linejoin="round"` : ''}/></svg>`
    case 'image': {
      const url = opts.resolveSrc(it.src)
      const at = `position:absolute;left:${px(it.x)};top:${px(it.y)};width:${px(it.w)};height:${px(it.h)}`
      if (!url) return `<div style="${escapeHtml(`${at};background:#e8e8e8`)}"></div>`
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(it.alt)}" draggable="false" style="${escapeHtml(`${at};object-fit:cover`)}">`
    }
    case 'art': {
      const art = board?.arts[it.art]
      if (!art) return ''
      const k = it.w / art.w
      return `<div style="position:absolute;left:${px(it.x)};top:${px(it.y)};width:${px(art.w)};height:${px(art.h)};transform:scale(${k});transform-origin:0 0;pointer-events:none">${art.html}</div>`
    }
    case 'box': {
      if (it.placeholder && !opts.placeholder) return ''
      const look = designTextStyle(it.box, it.size, 1)
      const key = escapeHtml(it.box.name)
      if (it.placeholder) return `<div class="doc-box empty" data-box="${key}" style="${escapeHtml(`${look};opacity:${0.35 * it.box.opacity}`)}"><p style="margin:0">${escapeHtml(opts.placeholder!(it.box.sample))}</p></div>`
      return `<div class="doc-box" data-box="${key}" style="${escapeHtml(look)}"><p style="margin:0">${escapeHtml(it.text)}</p></div>`
    }
  }
}

/** One page: background, the design's art, boxes under `over`, `over`, then the rest. */
export function pageHtml(page: PageLayout, board: DocBoard | undefined, opts: DocHtmlOptions): string {
  const d = page.design
  const under = (it: Item) => it.kind === 'box' && !!it.box.under
  const items = page.items.filter((it) => !under(it)).map((it) => itemHtml(it, board, opts)).join('')
  const below = page.items.filter(under).map((it) => itemHtml(it, board, opts)).join('')
  const style = `position:relative;overflow:hidden;width:${PAGE_W}px;height:${PAGE_H}px;background:${page.bg}`
  return `<div class="doc-page" data-section="${escapeHtml(page.section)}" data-page="${page.number}" style="${escapeHtml(style)}">${d?.art ?? ''}${below}${d?.over ?? ''}${items}</div>`
}
