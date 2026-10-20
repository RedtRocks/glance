import { useMemo } from 'preact/hooks'
import { slideHtml } from '../../core/deck/html'
import { SLIDE_H, SLIDE_W, type SlotRef } from '../../core/deck/layout'
import type { Slide } from '../../core/deck/model'
import { themeOf } from '../../core/deck/themes'
import type { DeckDoc } from '../../state/documents'
import { mediaUrl } from '../../state/deckMedia'
import { designsVersion, findDesign, sampleText } from '../../state/designs'
import { measureDesignText } from '../../deck/measure'
import { t } from '../../i18n'

/** The hint an empty slot shows while editing: a designed slide's own sample, or a word on what goes there. */
export function slotHint(ref: SlotRef, sample?: string): string {
  if (sample) return sampleText(sample)
  switch (ref.slot) {
    case 'title':
      return t('Add a title')
    case 'subtitle':
      return t('Add a subtitle')
    case 'image':
      return t('Add a picture')
    case 'caption':
      return t('Add a caption')
    case 'quote':
      return t('Add a quote')
    case 'attribution':
      return t('Who said it')
    case 'stat':
      return t('A number')
    case 'statLabel':
      return t('What the number means')
    case 'items':
      return ref.part === 'heading' ? t('Heading') : t('A line or two')
    case 'table':
      return ref.index === 0 ? t('Heading') : t('Cell')
    default:
      return t('Add text')
  }
}

/**
 * One slide drawn at `width` CSS pixels. The slide is laid out at 1920 by 1080 and scaled,
 * so a thumbnail and the full view always match. The HTML is built from escaped text
 * (core/deck/html.ts), so it is safe to set directly.
 */
export function SlideFrame({ doc, slide, width, hints = false }: { doc: DeckDoc; slide: Slide; width: number; hints?: boolean }) {
  const theme = doc.deck.value.theme
  const version = doc.mediaVersion.value
  const designs = designsVersion.value
  const html = useMemo(
    () => slideHtml(slide, themeOf(theme), { resolveSrc: (src) => mediaUrl(doc, src), placeholder: hints ? slotHint : undefined, designs: findDesign, measure: measureDesignText }),
    [slide, theme, version, hints, designs]
  )
  const scale = width / SLIDE_W
  return (
    <div class="slide-frame" style={{ width: `${width}px`, height: `${SLIDE_H * scale}px` }}>
      <div class="slide-frame-inner" style={{ transform: `scale(${scale})`, '--deck-scale': scale }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

/** A slide that isn't in an open deck yet, like a template's first slide. It has no pictures. */
export function SlidePreview({ slide, theme, width }: { slide: Slide; theme: string; width: number }) {
  const designs = designsVersion.value
  const html = useMemo(() => slideHtml(slide, themeOf(theme), { resolveSrc: () => '', designs: findDesign, measure: measureDesignText }), [slide, theme, designs])
  const scale = width / SLIDE_W
  return (
    <div class="slide-frame" style={{ width: `${width}px`, height: `${SLIDE_H * scale}px` }}>
      <div class="slide-frame-inner" style={{ transform: `scale(${scale})`, '--deck-scale': scale }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
