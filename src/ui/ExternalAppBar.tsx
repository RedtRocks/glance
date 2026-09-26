import { useState } from 'preact/hooks'
import type { Doc } from '../state/documents'
import { canOpenWith, externalHint, openWithOtherApp } from '../state/shellActions'
import { InfoBar } from './InfoBar'

/** For another app's working files (PSD, AI, RAW…): say what Glance shows and offer Open With. */
export function ExternalAppBar({ doc }: { doc: Doc }) {
  const [closed, setClosed] = useState(false)
  const hint = externalHint(doc)
  if (!hint || closed || doc.kind === 'notice') return null
  return (
    <InfoBar
      title={hint.kind}
      actions={
        canOpenWith(doc) && (
          <button class="btn" onClick={() => void openWithOtherApp(doc)}>
            Open with…
          </button>
        )
      }
      onClose={() => setClosed(true)}
    >
      {hint.detail}
    </InfoBar>
  )
}
