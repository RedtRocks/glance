/**
 * Deck themes: the colours and type a deck's layouts are drawn with. A theme changes the
 * whole deck at once and never moves anything, so swapping one is always safe.
 */

export interface DeckTheme {
  id: string
  /** Font stacks, first choice first. PowerPoint export uses the first name. */
  headingFont: string
  bodyFont: string
  /** Wollo uses one weight everywhere; other themes may set a heavier heading. */
  headingWeight: number
  bg: string
  text: string
  muted: string
  accent: string
  onAccent: string
  /** Cards, table headers and caption backgrounds. */
  surface: string
  stroke: string
  /** Corner radius of cards and pictures, in slide units (a slide is 1920 by 1080). */
  radius: number
}

const URBANIST = "Urbanist, 'Helvetica Neue', Arial, sans-serif"

/** The website's look, as in src/styles/web.css. */
export const THEMES: Record<string, DeckTheme> = {
  wollo: {
    id: 'wollo',
    headingFont: URBANIST,
    bodyFont: URBANIST,
    headingWeight: 400,
    bg: '#ffffff',
    text: '#0a0a0a',
    muted: '#6b6b6b',
    accent: '#6312f6',
    onAccent: '#ffffff',
    surface: '#f4f3f7',
    stroke: '#dcdcdc',
    radius: 28
  },
  wolloDark: {
    id: 'wolloDark',
    headingFont: URBANIST,
    bodyFont: URBANIST,
    headingWeight: 400,
    bg: '#0e0d12',
    text: '#f4f3f7',
    muted: '#a9a6b3',
    accent: '#b49bff',
    onAccent: '#0e0d12',
    surface: '#1a1920',
    stroke: '#34323d',
    radius: 28
  },
  /** Wollo with the website's orange: warm, for classes and clubs. */
  sunrise: {
    id: 'sunrise',
    headingFont: URBANIST,
    bodyFont: URBANIST,
    headingWeight: 400,
    bg: '#fffaf5',
    text: '#0a0a0a',
    muted: '#6b6b6b',
    accent: '#f47933',
    onAccent: '#0a0a0a',
    surface: '#fdeee2',
    stroke: '#ecd9c8',
    radius: 28
  },
  /** Wollo with the website's pink: for celebrations and stories. */
  blossom: {
    id: 'blossom',
    headingFont: URBANIST,
    bodyFont: URBANIST,
    headingWeight: 400,
    bg: '#ffffff',
    text: '#0a0a0a',
    muted: '#6b6b6b',
    accent: '#d63d8c',
    onAccent: '#ffffff',
    surface: '#fdeef6',
    stroke: '#f1d3e3',
    radius: 28
  },
  /** Near black with the website's yellow: for numbers and reports. */
  ink: {
    id: 'ink',
    headingFont: URBANIST,
    bodyFont: URBANIST,
    headingWeight: 400,
    bg: '#0a0a0a',
    text: '#f4f3f7',
    muted: '#a9a6b3',
    accent: '#f8d32c',
    onAccent: '#0a0a0a',
    surface: '#1a1920',
    stroke: '#34323d',
    radius: 28
  }
}

export const DEFAULT_THEME = 'wollo'

/** The deck's theme, or Wollo when the deck names one this version doesn't have. */
export function themeOf(id: string): DeckTheme {
  return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME]
}
