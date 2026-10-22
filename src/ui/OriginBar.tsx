import type { Doc } from '../state/documents'
import { editWithGlance, keep, origins } from '../state/handOff'
import { agentName } from '../state/ai'
import { InfoBar } from './InfoBar'
import { t } from '../i18n'

/** On a file the AI company made: who made it, with Keep and Edit with Glance AI. */
export function OriginBar({ doc }: { doc: Doc }) {
  const o = origins.value.get(doc.id)
  if (!o) return null
  const company = agentName(o.agentId)
  return (
    <InfoBar
      title={o.kind === 'site' ? t('Opened from {site}', { site: o.site ?? company }) : t('Made by {agent}', { agent: company })}
      actions={
        <>
          <button class="btn" onClick={() => void keep(doc)}>
            {t('Keep')}
          </button>
          <button class="btn primary" onClick={() => editWithGlance(doc)}>
            {t('Edit with Glance AI')}
          </button>
        </>
      }
    >
      {o.kind === 'site' ? t('Saved in Downloads') : o.keepIn ? t('Keep saves it next to the original file.') : t('Keep saves it in Downloads.')}
    </InfoBar>
  )
}
