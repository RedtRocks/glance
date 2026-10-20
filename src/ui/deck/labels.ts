import type { LayoutId } from '../../core/deck/model'
import type { Purpose } from '../../core/deck/design'
import { t } from '../../i18n'

/** What each layout is called in pickers and menus. */
export function layoutLabel(id: LayoutId): string {
  switch (id) {
    case 'title':
      return t('Title')
    case 'section':
      return t('Section')
    case 'bullets':
      return t('Bullet points')
    case 'twoColumns':
      return t('Two columns')
    case 'imageLeft':
      return t('Picture on the left')
    case 'imageRight':
      return t('Picture on the right')
    case 'fullImage':
      return t('Full picture')
    case 'bigNumber':
      return t('Big number')
    case 'threeCards':
      return t('Three cards')
    case 'quote':
      return t('Quote')
    case 'comparison':
      return t('Table')
    case 'timeline':
      return t('Timeline')
    case 'design':
      return t('Designed slide')
  }
}

/** What each deck theme is called in the theme menu. */
export function themeLabel(id: string): string {
  switch (id) {
    case 'wolloDark':
      return t('Wollo dark')
    case 'sunrise':
      return t('Sunrise')
    case 'blossom':
      return t('Blossom')
    case 'ink':
      return t('Ink')
    default:
      return t('Wollo')
  }
}

/** What each template purpose is called on the start screen's tabs. */
export function purposeLabel(p: Purpose | 'All'): string {
  switch (p) {
    case 'School':
      return t('School')
    case 'Work':
      return t('Work')
    case 'Events':
      return t('Events')
    case 'Personal':
      return t('Personal')
    case 'Clubs':
      return t('Clubs')
    default:
      return t('All')
  }
}
