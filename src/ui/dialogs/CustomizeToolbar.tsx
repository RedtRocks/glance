import { settings, updateSettings, resetToolbar } from '../../state/settings'
import { customizeOpen } from '../../state/ui'
import { TOOLBAR_ITEMS } from '../Toolbar'
import { Modal } from './Dialog'
import { Icon } from '../Icon'
import { t } from '../../i18n'

/** Add, remove and reorder toolbar items (Preview's View → Customize Toolbar). */
export function CustomizeToolbar() {
  const order = settings.value.toolbar
  const close = (): void => void (customizeOpen.value = false)
  const set = (next: string[]): void => updateSettings({ toolbar: next })
  const move = (i: number, d: -1 | 1): void => {
    const next = [...order]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }
  const available = TOOLBAR_ITEMS.filter((it) => it.id === 'spacer' || !order.includes(it.id))
  const label = (id: string): string => {
    const item = TOOLBAR_ITEMS.find((it) => it.id === id)
    return item ? t(item.label) : id
  }
  return (
    <Modal
      title={t('Customize toolbar')}
      onClose={close}
      wide
      footer={
        <>
          <button class="btn" onClick={resetToolbar}>{t('Restore defaults')}</button>
          <button class="btn primary" onClick={close}>{t('Done')}</button>
        </>
      }
    >
      <p class="muted">{t('Items that don’t apply to the open document (for example page controls on a single image) hide automatically.')}</p>
      <div class="customize">
        <section>
          <h3>{t('In the toolbar')}</h3>
          <ol class="customize-list">
            {order.map((id, i) => (
              <li key={`${id}-${i}`}>
                <span>{label(id)}</span>
                <button class="icon-button" aria-label={t('Move up')} onClick={() => move(i, -1)} disabled={i === 0}><Icon name="up" size={16} /></button>
                <button class="icon-button" aria-label={t('Move down')} onClick={() => move(i, 1)} disabled={i === order.length - 1}><Icon name="down" size={16} /></button>
                <button class="icon-button" aria-label={t('Remove')} onClick={() => set(order.filter((_, k) => k !== i))}><Icon name="close" size={16} /></button>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h3>{t('Available')}</h3>
          <ul class="customize-list">
            {available.map((it) => (
              <li key={it.id}>
                <span>{t(it.label)}</span>
                <button class="icon-button" aria-label={t('Add {item}', { item: t(it.label) })} onClick={() => set([...order.slice(0, -1), it.id, ...order.slice(-1)])}>
                  <Icon name="add" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
