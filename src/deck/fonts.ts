/**
 * The bundled fonts of the designed templates (src/styles/fonts, OFL), for the places that
 * can't use the page's @font-face: slide pictures (raster.ts) inline them, and PDF export
 * embeds them. Keep in step with the @font-face rules in src/styles/web.css.
 */
import urbanist from '../styles/fonts/urbanist.woff2?url'
import fraunces from '../styles/fonts/fraunces.woff2?url'
import frauncesItalic from '../styles/fonts/fraunces-italic.woff2?url'
import bricolage from '../styles/fonts/bricolage-grotesque.woff2?url'
import spaceGrotesk from '../styles/fonts/space-grotesk.woff2?url'
import caveat from '../styles/fonts/caveat.woff2?url'
import dmSerif from '../styles/fonts/dm-serif-display.woff2?url'
import dmSerifItalic from '../styles/fonts/dm-serif-display-italic.woff2?url'
import { toBase64 } from '../core/mcp/helpers'

interface FontFile {
  family: string
  italic: boolean
  /** CSS font-weight: a range for variable fonts. */
  weight: string
  url: string
}

export const FONT_FILES: FontFile[] = [
  { family: 'Urbanist', italic: false, weight: '100 900', url: urbanist },
  { family: 'Fraunces', italic: false, weight: '100 900', url: fraunces },
  { family: 'Fraunces', italic: true, weight: '100 900', url: frauncesItalic },
  { family: 'Bricolage Grotesque', italic: false, weight: '200 800', url: bricolage },
  { family: 'Space Grotesk', italic: false, weight: '300 700', url: spaceGrotesk },
  { family: 'Caveat', italic: false, weight: '400 700', url: caveat },
  { family: 'DM Serif Display', italic: false, weight: '400', url: dmSerif },
  { family: 'DM Serif Display', italic: true, weight: '400', url: dmSerifItalic }
]

const bytes = new Map<string, Promise<Uint8Array | null>>()

/** A font file's bytes (woff2): the upright or italic file of `family`, or null if none is bundled. */
export function fontFile(family: string, italic: boolean): Promise<Uint8Array | null> {
  // A family with no italic file is slanted from its upright one, as browsers do.
  const f = FONT_FILES.find((x) => x.family === family && x.italic === italic) ?? FONT_FILES.find((x) => x.family === family)
  if (!f) return Promise.resolve(null)
  let p = bytes.get(f.url)
  if (!p) {
    p = fetch(f.url).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b), () => null)
    bytes.set(f.url, p)
  }
  return p
}

export const hasItalic = (family: string) => FONT_FILES.some((f) => f.family === family && f.italic)

/** @font-face rules with the files inlined, for the families given. */
export async function inlineFontCss(families: Iterable<string>): Promise<string> {
  const want = new Set(families)
  const rules = await Promise.all(FONT_FILES.filter((f) => want.has(f.family)).map(async (f) => {
    const b = await fontFile(f.family, f.italic)
    return b ? `@font-face{font-family:'${f.family}';font-style:${f.italic ? 'italic' : 'normal'};font-weight:${f.weight};src:url(data:font/woff2;base64,${toBase64(b)}) format('woff2')}` : ''
  }))
  return rules.join('')
}
