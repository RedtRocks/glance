import { describe, expect, it } from 'vitest'
import { FEEDBACK_EMAIL, feedbackUrl } from '../src/core/feedback'

describe('feedback link', () => {
  it('mails the developer with only the written text', () => {
    const url = feedbackUrl('  Love it.\nMore tabs please  ')
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true)
    const params = new URLSearchParams(url.split('?')[1].replace(/\+/g, '%2B'))
    expect(params.get('body')).toBe('Love it.\nMore tabs please')
    expect(params.get('subject')).toBe('Glance feedback')
  })
  it('keeps spaces as %20, not +', () => {
    expect(feedbackUrl('a b')).toContain('body=a%20b')
  })
  it('shortens very long messages', () => {
    expect(decodeURIComponent(feedbackUrl('x'.repeat(10000)).split('body=')[1]).length).toBeLessThan(6100)
  })
})
