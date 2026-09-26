/**
 * A small subset of ICU MessageFormat, enough for UI text:
 *   {name}                                  a variable (numbers are localized)
 *   {count, plural, one {# page} other {# pages}}   plural forms, # is the number
 * Branches may use =0, =1 … for exact values and nest other placeholders.
 * Literal braces are not supported; write them as a variable if ever needed.
 */

export type Vars = Record<string, string | number>

type Node = string | { name: string } | { name: string; branches: Record<string, Node[]> }

const cache = new Map<string, Node[]>()

function parse(src: string): Node[] {
  let cached = cache.get(src)
  if (!cached) {
    let i = 0
    const nodes = (stopAtClose: boolean): Node[] => {
      const out: Node[] = []
      let text = ''
      while (i < src.length) {
        const c = src[i]
        if (c === '}' && stopAtClose) break
        if (c !== '{') {
          text += c
          i++
          continue
        }
        if (text) out.push(text), (text = '')
        const close = src.indexOf('}', i)
        const comma = src.indexOf(',', i)
        if (comma < 0 || (close >= 0 && close < comma)) {
          out.push({ name: src.slice(i + 1, close).trim() })
          i = close + 1
          continue
        }
        const name = src.slice(i + 1, comma).trim()
        i = src.indexOf(',', comma + 1) + 1 // skip the "plural" keyword
        const branches: Record<string, Node[]> = {}
        for (;;) {
          while (src[i] === ' ') i++
          if (src[i] === '}' || i >= src.length) break
          const open = src.indexOf('{', i)
          const key = src.slice(i, open).trim()
          i = open + 1
          branches[key] = nodes(true)
          i++ // the branch's }
        }
        i++ // the placeholder's }
        out.push({ name, branches })
      }
      if (text) out.push(text)
      return out
    }
    cached = nodes(false)
    cache.set(src, cached)
  }
  return cached
}

const rules = new Map<string, Intl.PluralRules>()
const numbers = new Map<string, Intl.NumberFormat>()
const memo = <T>(map: Map<string, T>, locale: string, make: () => T): T => {
  let v = map.get(locale)
  if (!v) map.set(locale, (v = make()))
  return v
}

/**
 * Fills a message's placeholders. `literal` transforms the message's own text but not
 * the values put into it (the pseudo-locale uses it).
 */
export function format(message: string, vars: Vars | undefined, locale: string, literal: (s: string) => string = (s) => s): string {
  const num = (n: number) => memo(numbers, locale, () => new Intl.NumberFormat(locale)).format(n)
  const render = (nodes: Node[], hash?: number): string => {
    let out = ''
    for (const n of nodes) {
      if (typeof n === 'string') {
        out += hash === undefined ? literal(n) : n.split('#').map(literal).join(num(hash))
      } else if (!('branches' in n)) {
        const v = vars?.[n.name]
        out += v === undefined ? `{${n.name}}` : typeof v === 'number' ? num(v) : v
      } else {
        const v = Number(vars?.[n.name] ?? 0)
        const cat = memo(rules, locale, () => new Intl.PluralRules(locale)).select(v)
        const branch = n.branches[`=${v}`] ?? n.branches[cat] ?? n.branches.other ?? []
        out += render(branch, v)
      }
    }
    return out
  }
  return render(parse(message))
}

const ACCENTED: Record<string, string> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž'
}

/** Accents every letter so untranslated text stands out. */
export function pseudoText(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => ACCENTED[c])
}

/**
 * The pseudo-locale's version of a message: accented, about 40% longer (German and
 * Finnish run that much longer than English), and bracketed so clipping is visible.
 */
export function pseudoMessage(message: string, vars: Vars | undefined): string {
  const out = format(message, vars, 'en', pseudoText)
  const pad = Math.ceil(message.replace(/\{[^}]*\}/g, '').length * 0.4)
  return `[${out}${'·'.repeat(pad)}]`
}

/**
 * Picks the catalog for a preference: an exact match, then the base language
 * (de-AT → de), then a regional variant of it (pt → pt-BR), otherwise English.
 */
export function resolveLocale(preferred: readonly string[], available: readonly string[]): string {
  const lower = available.map((a) => a.toLowerCase())
  for (const p of preferred) {
    const want = p.toLowerCase()
    const exact = lower.indexOf(want)
    if (exact >= 0) return available[exact]
    const base = want.split('-')[0]
    const baseMatch = lower.indexOf(base)
    if (baseMatch >= 0) return available[baseMatch]
    const variant = lower.findIndex((a) => a.split('-')[0] === base)
    if (variant >= 0) return available[variant]
  }
  return 'en'
}

/** The placeholder names a message uses, sorted; a translation must use the same ones. */
export function placeholders(message: string): string[] {
  const names = new Set<string>()
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      if (typeof n === 'string') continue
      names.add(n.name)
      if ('branches' in n) Object.values(n.branches).forEach(walk)
    }
  }
  walk(parse(message))
  return [...names].sort()
}
