/**
 * Help → Send Feedback. Glance has no server, so feedback is an email to the developer:
 * the dialog fills in a mailto: link and the person sends it from their own mail app.
 * Only what they type is included.
 */

export const FEEDBACK_EMAIL = 'messdank@gmail.com'
const SUBJECT = 'Glance feedback' // i18n-ignore
// Mail apps cope with long links, but a few thousand characters is plenty.
const BODY_LENGTH = 6000

/** The mailto: link with the subject and the person's text filled in. */
export function feedbackUrl(message: string): string {
  let body = message.trim()
  if (body.length > BODY_LENGTH) body = `${body.slice(0, BODY_LENGTH).trimEnd()}…`
  // URLSearchParams would turn spaces into "+", which mail apps show literally.
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(body)}`
}
