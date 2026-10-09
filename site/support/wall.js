// Pure logic for the Support page, shared with tests/support.test.ts.

/** Payment links. Change these only with the maintainer's go-ahead; the test pins their hosts. */
// Playto takes UPI and netbanking in India and cards, Apple Pay and Google Pay from abroad,
// and pays out in rupees. GitHub Sponsors needs Stripe, which won't take individuals in India.
const PLAYTO_ONCE = ''
const PLAYTO_MONTHLY = ''
export const LINKS = {
  indiaOnce: PLAYTO_ONCE,
  indiaMonthly: PLAYTO_MONTHLY,
  worldOnce: PLAYTO_ONCE,
  worldMonthly: PLAYTO_MONTHLY
}

/** India's time zones. Only the wording differs: India sees UPI, everyone else sees cards. */
export function regionFor(timeZone) {
  return timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' ? 'in' : 'world'
}

/** The checkout to open, or '' when that one isn't set up yet. */
export function checkoutFor(region, freq, links = LINKS) {
  if (region === 'in') return freq === 'monthly' ? links.indiaMonthly : links.indiaOnce
  return freq === 'monthly' ? links.worldMonthly : links.worldOnce
}

/**
 * Supporters ranked by total given, highest first. "month" keeps only people who gave
 * in the current calendar month. Amounts are only for ordering; the page never shows them.
 */
export function rankSupporters(list, period = 'all', now = new Date()) {
  const month = now.toISOString().slice(0, 7)
  return list
    .filter((s) => period === 'all' || (s.lastGiven ?? '').startsWith(month))
    .slice()
    // On a tie, named supporters come before anonymous ones, then alphabetical.
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || !a.name - !b.name || String(a.name ?? '').localeCompare(String(b.name ?? '')))
    .map((s, i) => ({ rank: i + 1, name: s.name || null, monthly: !!s.monthly }))
}

/** A steady avatar colour per name, from the site's palette. */
export function colourFor(name) {
  const palette = ['#6312f6', '#7182e7', '#f258a8', '#f47933', '#c99a00']
  if (!name) return '#a9a6b3'
  let h = 0
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0
  return palette[h % palette.length]
}
