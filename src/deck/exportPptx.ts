/**
 * Deck to PowerPoint: one slide per deck slide, drawn from the same layout boxes as the
 * HTML view (src/core/deck/html.ts). Shapes, text boxes and pictures stay editable;
 * PowerPoint wraps the text itself, so line breaks can differ a little from Glance.
 *
 * pptxgenjs is loaded only when a deck is exported.
 */
import JSZip from 'jszip'
import { layoutSlide, type Box, type TextBox } from '../core/deck/layout'
import { type Deck } from '../core/deck/model'
import { themeOf, type DeckTheme } from '../core/deck/themes'

/** Inches per slide unit: a 1920 by 1080 slide is 13.333 by 7.5 in. */
const IN = 1 / 144
/** Points per slide unit: the slide is 960 pt wide. */
const PT = 0.5

type Pptx = InstanceType<typeof import('pptxgenjs').default>
type PptxSlide = ReturnType<Pptx['addSlide']>
type TextRun = Exclude<Parameters<PptxSlide['addText']>[0], string>[number]

export async function deckToPptx(deck: Deck, media: Map<string, Uint8Array>): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const theme = themeOf(deck.theme)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.theme = { headFontFace: firstFont(theme.headingFont), bodyFontFace: firstFont(theme.bodyFont) }
  const title = deck.slides.map((s) => s.slots.title).find((v) => v?.kind === 'text' && v.value.trim())
  if (title?.kind === 'text') pptx.title = title.value.trim()

  // Corner radius of each picture, slide by slide, for the XML pass below.
  const pictureRadii: number[][] = []
  for (const slide of deck.slides) {
    const s = pptx.addSlide()
    s.background = { color: hex(theme.bg) }
    s.hidden = slide.hidden
    const radii: number[] = []
    for (const box of layoutSlide(slide, theme)) addBox(s, box, theme, media, radii)
    if (slide.notes.trim()) s.addNotes(slide.notes)
    pictureRadii.push(radii)
  }
  const out = await pptx.write({ outputType: 'uint8array' })
  return finish(out as Uint8Array, theme, pictureRadii)
}

function addBox(s: PptxSlide, box: Box, theme: DeckTheme, media: Map<string, Uint8Array>, radii: number[]) {
  const at = { x: box.x * IN, y: box.y * IN, w: box.w * IN, h: box.h * IN }
  switch (box.type) {
    case 'rect':
      return addRect(s, at, box.radius, box.fill, box.line)
    case 'image': {
      const bytes = box.image ? media.get(box.image.src) : undefined
      const pic = bytes ? picture(bytes) : null
      // Like the HTML view: a picture that can't be shown leaves an empty card.
      if (!pic || !box.image) return addRect(s, at, box.radius, theme.surface)
      const f = box.image.focus ?? { x: 0.5, y: 0.5 }
      // object-fit: cover at the focus point: scale the picture to cover the box, then crop to it.
      const k = Math.max(at.w / pic.width, at.h / pic.height)
      const w = pic.width * k
      const h = pic.height * k
      s.addImage({
        data: pic.data, ...at, w, h, altText: box.image.alt,
        sizing: { type: 'crop', x: (w - at.w) * f.x, y: (h - at.h) * f.y, w: at.w, h: at.h }
      })
      radii.push(Math.min(box.radius, box.w / 2, box.h / 2) * IN)
      return
    }
    case 'text':
      if (!box.placeholder) addText(s, box, at, theme)
  }
}

function addRect(s: PptxSlide, at: { x: number; y: number; w: number; h: number }, radius: number, fill: string, line?: { colour: string; width: number }) {
  const r = Math.min(radius * IN, at.w / 2, at.h / 2)
  const round = Math.abs(at.w - at.h) < 1e-6 && r >= at.w / 2 - 1e-6
  const shape = round ? 'ellipse' : r > 0 ? 'roundRect' : 'rect'
  // pptxgenjs takes rectRadius in inches, whatever its types say.
  // PowerPoint centres an outline on the shape's edge; html.ts draws it inside, so inset by half.
  const inset = line ? (line.width * IN) / 2 : 0
  const box = line ? { x: at.x + inset, y: at.y + inset, w: at.w - 2 * inset, h: at.h - 2 * inset } : at
  s.addShape(shape as never, {
    ...box,
    fill: fill === 'none' ? { type: 'none' } : { color: hex(fill) },
    line: line ? { color: hex(line.colour), width: line.width * PT } : { type: 'none' },
    ...(shape === 'roundRect' ? { rectRadius: Math.max(0, r - inset) } : {})
  })
}

function addText(s: PptxSlide, box: TextBox, at: { x: number; y: number; w: number; h: number }, theme: DeckTheme) {
  const size = box.size * PT
  const gap = size * (box.bullets ? 0.5 : 0.3)
  const runs: TextRun[] = []
  box.paragraphs.forEach((p, i) => {
    // List entries collapse white space like HTML; paragraphs keep their line breaks.
    const lines = box.bullets ? [p.replace(/\s+/g, ' ').trim()] : p.split('\n')
    lines.forEach((text, j) => {
      runs.push({
        text,
        options: {
          breakLine: true,
          ...(i > 0 && j === 0 ? { paraSpaceBefore: gap } : {}),
          ...(box.bullets ? { bullet: { indent: size * 1.1 } } : {})
        }
      })
    })
  })
  if (!runs.length) return
  runs[runs.length - 1].options!.breakLine = false
  s.addText(runs, {
    ...at,
    fontFace: firstFont(box.font === 'heading' ? theme.headingFont : theme.bodyFont),
    fontSize: size,
    bold: box.font === 'heading' && theme.headingWeight >= 600,
    color: hex(box.colour),
    align: box.align,
    valign: box.valign,
    lineSpacing: size * box.lineHeight,
    margin: [0, 0, 0, 0],
    fit: 'none',
    wrap: true
  })
}

/**
 * What pptxgenjs can't say itself: bullets in the accent colour (html.ts draws accent
 * dots) and rounded picture corners.
 */
async function finish(bytes: Uint8Array, theme: DeckTheme, pictureRadii: number[][]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes)
  const buClr = `<a:buClr><a:srgbClr val="${hex(theme.accent)}"/></a:buClr>`
  for (let i = 0; i < pictureRadii.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`
    const file = zip.file(path)
    if (!file) continue
    // A bullet glyph is smaller than html.ts's 0.32em dot, so it is drawn at 150%.
    let xml = (await file.async('string')).replaceAll('<a:buSzPct val="100000"/><a:buChar', `${buClr}<a:buSzPct val="150000"/><a:buChar`)
    let n = 0
    xml = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (pic) => {
      const r = pictureRadii[i][n++] ?? 0
      if (!r) return pic
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic)
      const min = ext ? Math.min(Number(ext[1]), Number(ext[2])) : 0
      if (!min) return pic
      // roundRect's adj is the radius as a share of the shorter side, in 1/100000.
      const adj = Math.min(50000, Math.round((r * 914400 * 100000) / min))
      return pic.replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`)
    })
    zip.file(path, xml)
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

/** The first family of a CSS font stack: "Urbanist, 'Helvetica Neue', Arial" is Urbanist. */
function firstFont(stack: string): string {
  return stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}

function hex(css: string): string {
  let h = css.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : '000000'
}

/** PNG, JPEG or GIF bytes as a data URL with their pixel size; null for anything PowerPoint may not show. */
function picture(b: Uint8Array): { data: string; width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let type = ''
  let width = 0
  let height = 0
  if (b.length > 24 && v.getUint32(0) === 0x89504e47) {
    type = 'png'
    width = v.getUint32(16)
    height = v.getUint32(20)
  } else if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    type = 'gif'
    width = v.getUint16(6, true)
    height = v.getUint16(8, true)
  } else if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    type = 'jpeg'
    // The size is in the first start-of-frame marker (C0 to CF, except C4, C8 and CC).
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) break
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        height = v.getUint16(i + 5)
        width = v.getUint16(i + 7)
        break
      }
      i += 2 + v.getUint16(i + 2)
    }
  }
  if (!type || !width || !height) return null
  return { data: `data:image/${type};base64,${base64(b)}`, width, height }
}

function base64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
