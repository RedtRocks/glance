// Pure logic for the Support page, shared with tests/support.test.ts.

/** Payment links. Change these only with the maintainer's go-ahead; the test pins their hosts. */
export const LINKS = {
  // Playto handles UPI, cards and netbanking for donors in India.
  indiaOnce: '',
  indiaMonthly: '',
  // GitHub Sponsors takes cards from everywhere, one-time or monthly.
  worldOnce: 'https://github.com/sponsors/RedtRocks',
  worldMonthly: 'https://github.com/sponsors/RedtRocks'
}

/** India's time zones; everyone else is sent to GitHub Sponsors. */
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
