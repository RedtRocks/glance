import type { LayoutId } from '../../core/deck/model'
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
  }
}
