/**
 * Templates: decks to start from, in the person's language. Words in [brackets] are for
 * them (or the AI) to replace; the design check doesn't mind them. Batches of five go to
 * the maintainer for approval before they ship.
 */
import { emptyDeck, slideIdMaker, type Deck } from '../core/deck/model'
import { applyOps, type DeckOp } from '../core/deck/ops'
import { msg, t } from '../i18n'

export interface Template {
  id: string
  name: string
  /** Who it's for, one line. */
  blurb: string
  theme: string
  slides: () => DeckOp[]
}

const add = (layout: Extract<DeckOp, { op: 'add' }>['layout'], slots: Record<string, unknown>, notes?: string): DeckOp => ({ op: 'add', layout, slots, ...(notes ? { notes } : {}) })
const items = (...pairs: [string, string][]) => pairs.map(([heading, body]) => ({ heading: t(heading), body: t(body) }))

export const TEMPLATES: Template[] = [
  {
    id: 'pitch',
    name: msg('Pitch Deck'),
    blurb: msg('Win over investors or your boss in ten slides'),
    theme: 'wollo',
    slides: () => [
      add('title', { title: t('[Company name]'), subtitle: t('[One line on what you do, for whom]') }),
      add('bigNumber', { stat: t('[3 in 5]'), statLabel: t('[people have this problem]'), body: t('[Where the number comes from, and why it matters now]') }),
      add('threeCards', { title: t('How it works'), items: items([msg('[Step one]'), msg('[What happens]')], [msg('[Step two]'), msg('[What happens]')], [msg('[Step three]'), msg('[What they get]')]) }),
      add('comparison', { title: t('Why us'), table: [[t(''), t('[Us]'), t('[Them]')], [t('[Price]'), t('[…]'), t('[…]')], [t('[Speed]'), t('[…]'), t('[…]')], [t('[Ease]'), t('[…]'), t('[…]')]] }),
      add('quote', { quote: t('[What a happy customer said, in their words]'), attribution: t('[Name, role]') }),
      add('timeline', { title: t('Where we’re going'), items: items([msg('[Now]'), msg('[Where you are]')], [msg('[Next]'), msg('[The next milestone]')], [msg('[Later]'), msg('[The big goal]')]) }),
      add('section', { title: t('The ask'), subtitle: t('[How much, and what it pays for]') })
    ]
  },
  {
    id: 'bookReport',
    name: msg('Book Report'),
    blurb: msg('Tell the class about a book you read'),
    theme: 'blossom',
    slides: () => [
      add('title', { title: t('[Book title]'), subtitle: t('[By the author] · [Your name]') }),
      add('bullets', { title: t('What it’s about'), bullets: [t('[Where and when it happens]'), t('[Who it follows]'), t('[The big problem]')] }),
      add('threeCards', { title: t('The main characters'), items: items([msg('[Name]'), msg('[What they’re like]')], [msg('[Name]'), msg('[What they’re like]')], [msg('[Name]'), msg('[What they’re like]')]) }),
      add('timeline', { title: t('What happens'), items: items([msg('Beginning'), msg('[…]')], [msg('Middle'), msg('[…]')], [msg('End'), msg('[…]')]) }),
      add('quote', { quote: t('[Your favourite line from the book]'), attribution: t('[Who says it]') }),
      add('bigNumber', { stat: t('[4/5]'), statLabel: t('My rating'), body: t('[Why you’d tell a friend to read it, or not]') })
    ]
  },
  {
    id: 'weekly',
    name: msg('Weekly Report'),
    blurb: msg('What got done, what’s next and what’s in the way'),
    theme: 'ink',
    slides: () => [
      add('title', { title: t('Week of [date]'), subtitle: t('[Team name]') }),
      add('bigNumber', { stat: t('[12]'), statLabel: t('[things shipped this week]'), body: t('[The one that matters most]') }),
      add('twoColumns', { title: t('Done and next'), left: [t('Done: [item]'), t('Done: [item]'), t('Done: [item]')], right: [t('Next: [item]'), t('Next: [item]'), t('Next: [item]')] }),
      add('threeCards', { title: t('In the way'), items: items([msg('[Blocker]'), msg('[What would unblock it]')], [msg('[Risk]'), msg('[What we’re doing]')], [msg('[Ask]'), msg('[Who can help]')]) }),
      add('bullets', { title: t('Decisions needed'), bullets: [t('[Decision], by [date]'), t('[Decision], by [date]')] })
    ]
  },
  {
    id: 'lesson',
    name: msg('Class Lesson'),
    blurb: msg('Teach one idea, with a check at the end'),
    theme: 'sunrise',
    slides: () => [
      add('title', { title: t('[Lesson topic]'), subtitle: t('[Class] · [Date]') }),
      add('bullets', { title: t('Today we will'), bullets: [t('[Learn what…]'), t('[Practise how to…]'), t('[Explain why…]')] }),
      add('imageRight', { title: t('[The big idea]'), body: t('[Say it in two sentences a ten-year-old would follow]') }),
      add('threeCards', { title: t('Words to know'), items: items([msg('[Word]'), msg('[What it means]')], [msg('[Word]'), msg('[What it means]')], [msg('[Word]'), msg('[What it means]')]) }),
      add('bullets', { title: t('Quick check'), bullets: [t('[Question one]'), t('[Question two]'), t('[Question three]')] }),
      add('section', { title: t('Your turn'), subtitle: t('[The task, and how long you have]') })
    ]
  },
  {
    id: 'event',
    name: msg('Event Plan'),
    blurb: msg('A bake sale, a party or a club night, planned'),
    theme: 'wollo',
    slides: () => [
      add('title', { title: t('[Event name]'), subtitle: t('[Day and date], [place], [time]') }),
      add('bigNumber', { stat: t('[£500]'), statLabel: t('[Our goal]'), body: t('[What the money or the day is for]') }),
      add('threeCards', { title: t('How to help'), items: items([msg('[Bring]'), msg('[What to bring]')], [msg('[Help]'), msg('[Which jobs need people]')], [msg('[Come]'), msg('[Who to invite]')]) }),
      add('timeline', { title: t('On the day'), items: items([msg('[9:00]'), msg('[Set up]')], [msg('[10:00]'), msg('[Doors open]')], [msg('[12:00]'), msg('[Busiest time]')], [msg('[14:00]'), msg('[Tidy up]')]) }),
      add('bullets', { title: t('Who does what'), bullets: [t('[Name]: [job]'), t('[Name]: [job]'), t('[Name]: [job]')] })
    ]
  }
]

/** A new deck from a template, in the person's language. */
export function templateDeck(id: string): Deck | null {
  const tpl = TEMPLATES.find((x) => x.id === id)
  if (!tpl) return null
  const start = emptyDeck(tpl.theme)
  return applyOps(start, tpl.slides(), slideIdMaker(start)).deck
}
