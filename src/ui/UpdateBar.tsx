import { availableUpdate } from '../state/updates'
import { updateSettings } from '../state/settings'
import * as platform from '../platform'
import { InfoBar } from './InfoBar'

/** "Glance 0.3.0 is available": Download opens the release page; nothing installs by itself. */
export function UpdateBar() {
  const u = availableUpdate.value
  if (!u) return null
  return (
    <InfoBar
      title={`Glance ${u.version} is available`}
      actions={
        <>
          <button class="btn" onClick={() => (updateSettings({ skippedVersion: `v${u.version}` }), (availableUpdate.value = null))}>
            Skip this version
          </button>
          <button class="btn primary" onClick={() => void platform.openUrl(u.url)}>
            Download
          </button>
        </>
      }
      onClose={() => (availableUpdate.value = null)}
    >
      See what’s new and download the installer from GitHub.
    </InfoBar>
  )
}
