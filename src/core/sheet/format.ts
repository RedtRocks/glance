/**
 * Excel number formats: turns a cell's value and format code ("£#,##0.00",
 * "0%", "ddd d mmm", "[Red]-0.0;0.0") into the text the cell shows, and reads typed text
 * ("£1,200", "12%", "3 Oct 2026") back into a value and a format.
 */
import { generalNumber, isError, type Value } from './model'

const DAY_MS = 86_400_000
/** Excel's day 0 (1900 date system, with its 1900 leap-year bug folded in). */
const EPOCH = Date.UTC(1899, 11, 30)

export const serialFromDate = (y: number, m: number, d: number): number => (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS

export function dateFromSerial(serial: number): { y: number; m: number; d: number; wd: number; h: number; mi: number; s: number; ms: number } {
  const ms = Math.round(serial * DAY_MS)
  const dt = new Date(EPOCH + ms)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds(), ms: dt.getUTCMilliseconds() }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface Formatted {
  text: string
  /** From a [Red]-style colour in the format. */
  color?: string
}

const COLORS: Record<string, string> = { red: '#ff0000', blue: '#0000ff', green: '#008000', black: '#000000', white: '#ffffff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff' }

/** Splits a format into its ;-separated sections, ignoring ; inside quotes. */
function sections(fmt: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]
    if (ch === '\\' && !q) {
      cur += ch + (fmt[i + 1] ?? '')
      i++
    } else if (ch === '"') {
      q = !q
      cur += ch
    } else if (ch === ';' && !q) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Pulls [Red], [$£-809], [>=100] and the like off the front of a section. */
function brackets(sec: string): { body: string; color?: string; cond?: { op: string; v: number } } {
  let color: string | undefined
  let cond: { op: string; v: number } | undefined
  const body = sec.replace(/\[([^\]]*)\]/g, (all, inner: string) => {
    const lower = inner.toLowerCase()
    if (COLORS[lower]) {
      color = COLORS[lower]
      return ''
    }
    if (/^color\d+$/.test(lower)) return ''
    const c = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner)
    if (c) {
      cond = { op: c[1], v: Number(c[2]) }
      return ''
    }
    // [$£-809]: a currency symbol and locale; keep the symbol.
    if (inner.startsWith('$')) return '"' + inner.slice(1).replace(/-[0-9A-Fa-f]+$/, '') + '"'
    // [h], [mm], [ss]: elapsed time.
    if (/^(h+|m+|s+)$/i.test(inner)) return all
    return ''
  })
  return { body, color, cond }
}

const isDateFormat = (body: string): boolean => /(^|[^"\\])[dmyhs]/i.test(body.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? 'h' : ''))) && !/[0#?]/.test(body.replace(/"[^"]*"/g, '').replace(/\\./g, ''))

export function isDateFmt(fmt: string | undefined): boolean {
  if (!fmt) return false
  const { body } = brackets(sections(fmt)[0])
  return isDateFormat(body)
}

function cmp(op: string, a: number, b: number): boolean {
  switch (op) {
    case '<': return a < b
    case '>': return a > b
    case '<=': return a <= b
    case '>=': return a >= b
    case '=': return a === b
    default: return a !== b
  }
}

/** The text a value shows as under a format code. */
export function formatValue(v: Value | undefined, fmt: string | undefined): Formatted {
  if (v === null || v === undefined) return { text: '' }
  if (isError(v)) return { text: v.error }
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE' } // i18n-ignore: Excel's own spelling
  const code = fmt && fmt.toLowerCase() !== 'general' ? fmt : ''
  const secs = code ? sections(code) : []
  if (typeof v === 'string') {
    const textSec = secs.length >= 4 ? secs[3] : secs.find((s) => s.includes('@'))
    if (!textSec) return { text: v }
    const { body, color } = brackets(textSec)
    return { text: literal(body, v), color }
  }
  if (!code) return { text: generalNumber(v) }
  // Pick the section: conditions first, else positive;negative;zero.
  let sec = secs[0]
  let n = v
  const parsed = secs.map(brackets)
  if (parsed.some((p) => p.cond)) {
    const hit = parsed.findIndex((p) => p.cond && cmp(p.cond.op, v, p.cond.v))
    const pick = hit >= 0 ? hit : parsed.findIndex((p, i) => !p.cond && i < 3)
    sec = secs[pick >= 0 ? pick : 0]
    if (v < 0 && pick > 0) n = Math.abs(v)
  } else if (v < 0 && secs.length >= 2) {
    sec = secs[1]
    n = -v
  } else if (v === 0 && secs.length >= 3) sec = secs[2]
  const { body, color } = brackets(sec)
  if (isDateFormat(body)) return { text: formatDate(n, body), color }
  return { text: formatNumber(n, body), color }
}

/** A text section: @ is the text, quoted and escaped characters are literal. */
function literal(body: string, text: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') {
      const j = body.indexOf('"', i + 1)
      out += body.slice(i + 1, j < 0 ? undefined : j)
      i = j < 0 ? body.length : j
    } else if (ch === '\\') out += body[++i] ?? ''
    else if (ch === '@') out += text
    else if (ch === '_') {
      out += ' '
      i++
    } else if (ch === '*') i++
    else out += ch
  }
  return out
}

function formatNumber(n: number, body: string): string {
  // Separate literal text from the digit pattern.
  type Part = { lit: string } | { pat: string }
  const parts: Part[] = []
  let pat = ''
  const flush = () => {
    if (pat) parts.push({ pat })
    pat = ''
  }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') {
      const j = body.indexOf('"', i + 1)
      flush()
      parts.push({ lit: body.slice(i + 1, j < 0 ? undefined : j) })
      i = j < 0 ? body.length : j
    } else if (ch === '\\') {
      flush()
      parts.push({ lit: body[++i] ?? '' })
    } else if (ch === '_') {
      flush()
      parts.push({ lit: ' ' })
      i++
    } else if (ch === '*') i++
    else if ('0#?.,%Ee+-'.includes(ch) && (ch !== '-' && ch !== '+' ? true : /[Ee]$/.test(pat))) pat += ch
    else if (ch === '/' && /[0#?]$/.test(pat)) pat += ch
    else {
      flush()
      parts.push({ lit: ch === '@' ? '' : ch })
    }
  }
  flush()
  const pats = parts.filter((p): p is { pat: string } => 'pat' in p)
  if (!pats.length) return parts.map((p) => ('lit' in p ? p.lit : '')).join('')
  const whole = pats.map((p) => p.pat).join('')
  const percent = (whole.match(/%/g) ?? []).length
  let x = n * Math.pow(100, percent)
  const main = pats.find((p) => /[0#?]/.test(p.pat))?.pat ?? '0'
  const exp = /[Ee][+-]/.test(main)
  let text: string
  if (exp) {
    const [mant, ex] = main.split(/[Ee][+-]/)
    const dec = (mant.split('.')[1] ?? '').replace(/[^0#?]/g, '').length
    const e = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x)))
    const m = x / Math.pow(10, e)
    text = `${m.toFixed(dec)}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(ex.replace(/[^0]/g, '').length || 1, '0')}`
  } else {
    // Trailing commas after the digits scale by 1000 each.
    const trail = /,+$/.exec(main.replace(/%/g, ''))
    if (trail) x /= Math.pow(1000, trail[0].length)
    const core = main.replace(/,+$/, '').replace(/%/g, '')
    const [ip, dp = ''] = core.split('.')
    const decDigits = dp.replace(/[^0#?]/g, '')
    const minDec = (decDigits.match(/0/g) ?? []).length
    const maxDec = decDigits.length
    const grouped = ip.includes(',')
    const minInt = (ip.match(/0/g) ?? []).length
    let fixed = Math.abs(x).toFixed(maxDec)
    // Rounding like Excel (half away from zero) rather than binary float rounding.
    fixed = roundHalfUp(Math.abs(x), maxDec)
    let [iPart, dPart = ''] = fixed.split('.')
    while (dPart.length > minDec && dPart.endsWith('0')) dPart = dPart.slice(0, -1)
    if (iPart === '0' && minInt === 0) iPart = ''
    iPart = iPart.padStart(minInt, '0')
    if (grouped) iPart = iPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    text = iPart + (core.includes('.') && (dPart || maxDec === 0 && core.endsWith('.')) ? '.' + dPart : '')
    if (text === '' ) text = minInt ? '0' : ''
  }
  const neg = x < 0 && /[1-9]/.test(text)
  let out = ''
  let placed = false
  for (const p of parts) {
    if ('lit' in p) out += p.lit
    else if (!placed && /[0#?]/.test(p.pat)) {
      out += (neg ? '-' : '') + text
      placed = true
    } else if (/%/.test(p.pat) && !/[0#?]/.test(p.pat)) out += p.pat.replace(/[^%]/g, '')
    else if (/[0#?]/.test(p.pat)) continue
    else out += p.pat.replace(/[,.]/g, '')
  }
  if (/%/.test(main)) out = out.includes('%') ? out : out + '%'.repeat(percent)
  return out
}

function roundHalfUp(x: number, dp: number): string {
  const f = Math.pow(10, dp)
  const r = Math.round((x + Number.EPSILON * x) * f) / f
  return r.toFixed(dp)
}

function formatDate(serial: number, body: string): string {
  // Without fractions of a second shown, times round to the nearest second, as in Excel.
  if (!/\.0/.test(body)) serial = Math.round(serial * 86400) / 86400
  const d = dateFromSerial(serial)
  const ampm = /AM\/PM|A\/P/i.test(body)
  let out = ''
  const toks = body.match(/"[^"]*"|\\.|\[[hms]+\]|AM\/PM|A\/P|y+|m+|d+|h+|s+|\.0+|./gi) ?? []
  let lastWasHour = false
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const low = t.toLowerCase()
    if (t.startsWith('"')) out += t.slice(1, -1)
    else if (t.startsWith('\\')) out += t[1]
    else if (/^\[h+\]$/i.test(t)) {
      out += String(Math.floor(serial * 24 + 1e-9))
      lastWasHour = true
      continue
    }
    else if (/^\[m+\]$/i.test(t)) out += String(Math.floor(serial * 1440))
    else if (/^\[s+\]$/i.test(t)) out += String(Math.floor(serial * 86400))
    else if (low === 'am/pm') out += d.h < 12 ? 'AM' : 'PM'
    else if (low === 'a/p') out += d.h < 12 ? 'A' : 'P'
    else if (low[0] === 'y') out += low.length <= 2 ? String(d.y).slice(-2) : String(d.y)
    else if (low[0] === 'd') out += low.length === 1 ? String(d.d) : low.length === 2 ? String(d.d).padStart(2, '0') : low.length === 3 ? DAYS[d.wd].slice(0, 3) : DAYS[d.wd]
    else if (low[0] === 'h') {
      const h = ampm ? d.h % 12 || 12 : d.h
      out += low.length >= 2 ? String(h).padStart(2, '0') : String(h)
      lastWasHour = true
      continue
    } else if (low[0] === 's') out += low.length >= 2 ? String(d.s).padStart(2, '0') : String(d.s)
    else if (low[0] === 'm') {
      // m after h or before s is minutes.
      const nextReal = toks.slice(i + 1).find((x) => /[a-z]/i.test(x) && !x.startsWith('"'))
      const minutes = lastWasHour || (nextReal && /^s/i.test(nextReal))
      if (minutes) out += low.length >= 2 ? String(d.mi).padStart(2, '0') : String(d.mi)
      else out += low.length === 1 ? String(d.m) : low.length === 2 ? String(d.m).padStart(2, '0') : low.length === 3 ? MONTHS[d.m - 1].slice(0, 3) : low.length === 5 ? MONTHS[d.m - 1][0] : MONTHS[d.m - 1]
    } else if (/^\.0+$/.test(t)) out += (d.ms / 1000).toFixed(t.length - 1).slice(1)
    else if (t === '_') {
      out += ' '
      i++
    } else if (t !== '*') out += t
    if (/[a-z]/i.test(t)) lastWasHour = false
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading what someone typed

const MONTH_INDEX = (s: string): number => MONTHS.findIndex((m) => m.toLowerCase().startsWith(s.toLowerCase().slice(0, 3)) && s.length >= 3)

/**
 * A typed entry as a value: numbers (with £/$/€, thousands commas, %), TRUE/FALSE, and
 * dates like 3 Oct 2026, 03/10/2026 (day first) or 2026-10-03. Returns the format a
 * typed currency, percent or date suggests, so the cell keeps showing it that way.
 */
export function parseEntry(text: string, opts: { dayFirst?: boolean; year?: number } = {}): { value: Value; numFmt?: string } {
  const s = text.trim()
  if (s === '') return { value: null }
  if (/^(true|false)$/i.test(s)) return { value: /^true$/i.test(s) }
  const num = /^([-+−]?)\s*([£$€¥]?)\s*([-+−]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*(%?)$/.exec(s)
  if (num) {
    const sign = num[1] || num[3] ? -1 : 1
    const isNeg = /[-−]/.test(num[1] + num[3])
    const n = Number(num[4].replace(/,/g, '')) * (isNeg ? sign : 1) / (num[5] ? 100 : 1)
    const dec = (num[4].split('.')[1] ?? '').length
    if (num[2]) {
      const body = `${num[2]}#,##0${dec ? '.00' : ''}`
      // A typed true minus sign (−£62) keeps showing as one.
      return { value: n, numFmt: /−/.test(num[1] + num[3]) ? `${body};−${body}` : body }
    }
    if (num[5]) return { value: n, numFmt: dec ? `0.${'0'.repeat(dec)}%` : '0%' }
    if (num[4].includes(',')) return { value: n, numFmt: dec ? `#,##0.${'0'.repeat(dec)}` : '#,##0' }
    return { value: n }
  }
  if (/^[-+]?\d+(\.\d+)?[eE][-+]?\d+$/.test(s)) return { value: Number(s) }
  const time = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\s*([ap]m)?$/i.exec(s)
  if (time) {
    let h = +time[1]
    if (time[4]) h = (h % 12) + (/p/i.test(time[4]) ? 12 : 0)
    const secs = h * 3600 + +time[2] * 60 + +(time[3] ?? 0)
    const numFmt = time[4] ? 'h:mm AM/PM' : `${h >= 24 ? '[h]' : /^0\d/.test(time[1]) ? 'hh' : 'h'}:mm${time[3] ? ':ss' : ''}`
    return { value: secs / 86400, numFmt }
  }
  const date = parseDate(s, opts)
  if (date) return date
  return { value: s }
}

function parseDate(s: string, opts: { dayFirst?: boolean; year?: number }): { value: number; numFmt: string } | null {
  const year = opts.year ?? new Date().getFullYear()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return ok(+m[1], +m[2], +m[3], 'yyyy-mm-dd')
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    const [d, mo] = opts.dayFirst === false ? [+m[2], +m[1]] : [+m[1], +m[2]]
    return ok(y, mo, d, opts.dayFirst === false ? 'm/d/yyyy' : 'dd/mm/yyyy')
  }
  m = /^(?:([A-Za-z]{3,9}),?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{2,4}))?$/.exec(s)
  if (m && MONTH_INDEX(m[3]) >= 0 && (!m[1] || DAYS.some((d) => d.toLowerCase().startsWith(m![1].toLowerCase().slice(0, 3))))) {
    // Keep the shape it was typed in: "Thu 01 Oct" stays a weekday, a padded day and a short month.
    const fmt = `${m[1] ? (m[1].length > 3 ? 'dddd ' : 'ddd ') : ''}${m[2].length === 2 ? 'dd' : 'd'} ${m[3].length > 3 ? 'mmmm' : 'mmm'}${m[4] ? (m[4].length === 2 ? ' yy' : ' yyyy') : ''}`
    return ok(m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : year, MONTH_INDEX(m[3]) + 1, +m[2], fmt)
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/.exec(s)
  if (m && MONTH_INDEX(m[1]) >= 0) return ok(m[3] ? +m[3] : year, MONTH_INDEX(m[1]) + 1, +m[2], m[3] ? 'mmm d, yyyy' : 'mmm d')
  return null
  function ok(y: number, mo: number, d: number, numFmt: string) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const dt = new Date(Date.UTC(y, mo - 1, d))
    if (dt.getUTCDate() !== d) return null
    return { value: serialFromDate(y, mo, d), numFmt }
  }
}
