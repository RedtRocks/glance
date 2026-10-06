/**
 * Help → Send Feedback. Glance has no server, so feedback becomes a GitHub issue on the
 * project: the dialog fills in a new-issue link and the person posts it from their browser.
 */

export const FEEDBACK_REPO = 'https://github.com/RedtRocks/glance'

export type FeedbackKind = 'idea' | 'problem' | 'other'

export interface Feedback {
  kind: FeedbackKind
  message: string
  /** "Glance 0.6.2, Windows app on Windows 10.0" etc., or null to leave it out. */
  about: string | null
}

const TITLE_PREFIX: Record<FeedbackKind, string> = { idea: 'Idea', problem: 'Problem', other: 'Feedback' }
const TITLE_LENGTH = 70
// Browsers and GitHub cope with long links, but a few thousand characters is plenty.
const BODY_LENGTH = 6000

/** The first line of the message, cut to a title-sized length. */
function titleFrom(message: string): string {
  const line = message.trim().split(/\r?\n/)[0].trim()
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line
}

/** The new-issue link with the title and text filled in. */
export function feedbackUrl(f: Feedback): string {
  let message = f.message.trim()
  if (message.length > BODY_LENGTH) message = `${message.slice(0, BODY_LENGTH).trimEnd()}…`
  const body = f.about ? `${message}\n\n---\n${f.about}` : message
  const params = new URLSearchParams({
    title: `${TITLE_PREFIX[f.kind]}: ${titleFrom(message)}`,
    body
  })
  return `${FEEDBACK_REPO}/issues/new?${params}`
}

/** "Windows 10.0" style name from a user agent, or null when it isn't recognisable. */
export function systemName(userAgent: string): string | null {
  const win = /Windows NT ([\d.]+)/.exec(userAgent)
  if (win) return `Windows ${win[1]}`
  if (/iPhone|iPad/.test(userAgent)) return 'iOS'
  if (/Android/.test(userAgent)) return 'Android'
  if (/Mac OS X/.test(userAgent)) return 'macOS'
  if (/Linux/.test(userAgent)) return 'Linux'
  return null
}
