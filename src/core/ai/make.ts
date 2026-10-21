/**
 * "What do you want to make?": turning the person's request into a name for the new file
 * and the first message to the AI, which fills the new deck with Glance's deck tools.
 * The message is read by the AI, so it is English; the AI answers in the person's language.
 * The messages themselves are written by guide.ts, which also shapes later edits.
 */
import { guideCreate } from './guide'
import type { Skill } from './skills'

/** A file name from the request: its first few words, without characters Windows refuses. */
export function nameFromRequest(request: string, fallback: string): string {
  const words = request.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  const name = words.length > 48 ? words.slice(0, 48).trimEnd() : words
  return name ? name[0].toUpperCase() + name.slice(1) : fallback
}

/** The first message for a new deck, already open in Glance as `tab`, built straight away. */
export function deckPrompt(request: string, tab: string, skills: Skill[] = []): string {
  return guideCreate(request, { kind: 'deck', tab }, { skills }).text
}

/** The first message for a deck started from a template, open in Glance as `tab`. */
export function templatePrompt(request: string, template: string, tab: string, id = template, skills: Skill[] = []): string {
  return guideCreate(request, { kind: 'deck', tab, template: { id, name: template } }, { skills }).text
}
