import { useState } from 'preact/hooks'
import { settings, updateSettings, type ThemePref } from '../../state/settings'
import { settingsOpen } from '../../state/ui'
import { COMMANDS, bindings } from '../../state/commands'
import { comboFromEvent, displayCombo, findConflicts } from '../../core/shortcuts'
import { Modal } from './Dialog'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import type { ComponentChildren } from 'preact'

/** Windows 11 Settings-style row: icon, title and description, control on the right. */
function SettingsCard({ icon, title, description, children }: { icon: IconName; title: string; description: string; children: ComponentChildren }) {
  return (
    <div class="settings-card">
      <span class="settings-card-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div class="settings-card-text">
        <span class="settings-card-title">{title}</span>
        <span class="settings-card-desc">{description}</span>
      </div>
      <div class="settings-card-control">{children}</div>
    </div>
  )
}

/** WinUI ToggleSwitch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="toggle-switch">
      <span class="toggle-state">{checked ? 'On' : 'Off'}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  )
}

function ShortcutEditor() {
  const [recording, setRecording] = useState<string | null>(null)
  const current = bindings()
  const conflicts = new Map(findConflicts(current).flatMap(([combo, ids]) => ids.map((id) => [id, combo] as const)))
  const setKeys = (id: string, keys: string[] | undefined): void => {
    const next = { ...settings.value.shortcuts }
    if (keys) next[id] = keys
    else delete next[id]
    updateSettings({ shortcuts: next })
  }
  return (
    <div class="shortcut-table" role="table" aria-label="Keyboard shortcuts">
      {COMMANDS.map((c) => (
        <div class="shortcut-row" role="row" key={c.id}>
          <span role="cell">{c.label}</span>
          <button
            role="cell"
            class={`shortcut-key ${recording === c.id ? 'recording' : ''} ${conflicts.has(c.id) ? 'conflict' : ''}`}
            title={conflicts.has(c.id) ? 'This shortcut is also used by another command' : 'Click, then press a new shortcut'}
            onClick={() => setRecording(c.id)}
            onKeyDown={(e) => {
              if (recording !== c.id) return
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Escape') return setRecording(null)
              if (e.key === 'Backspace' || e.key === 'Delete') {
                setKeys(c.id, [])
                return setRecording(null)
              }
              const combo = comboFromEvent(e)
              if (!combo) return
              setKeys(c.id, [combo])
              setRecording(null)
            }}
            onBlur={() => setRecording(null)}
          >
            {recording === c.id ? 'Press keys…' : current[c.id].map(displayCombo).join(', ') || '—'}
          </button>
          {settings.value.shortcuts[c.id] && (
            <button role="cell" class="link-button" onClick={() => setKeys(c.id, undefined)}>
              Reset
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function SettingsDialog() {
  const s = settings.value
  const [tab, setTab] = useState<'general' | 'shortcuts'>('general')
  const close = (): void => void (settingsOpen.value = false)
  return (
    <Modal title="Settings" onClose={close} wide footer={<button class="btn primary" onClick={close}>Done</button>}>
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>General</button>
        <button role="tab" aria-selected={tab === 'shortcuts'} onClick={() => setTab('shortcuts')}>Keyboard shortcuts</button>
      </div>
      {tab === 'general' ? (
        <div class="settings-cards">
          <SettingsCard icon="moon" title="App theme" description="Follow Windows, or always use light or dark.">
            <select value={s.theme} onChange={(e) => updateSettings({ theme: (e.target as HTMLSelectElement).value as ThemePref })}>
              <option value="system">Use Windows setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </SettingsCard>
          <SettingsCard icon="document" title="Dark appearance for PDFs" description="Invert page colors while Glance is dark. Images inside PDFs are inverted too.">
            <Toggle checked={s.darkPdf} label="Dark appearance for PDFs" onChange={(v) => updateSettings({ darkPdf: v })} />
          </SettingsCard>
          <SettingsCard icon="grid" title="Page number field" description="Show it in the toolbar for documents longer than this many pages. Previous/next buttons appear for any multi-page document.">
            <input
              class="number-box"
              type="number"
              min={1}
              max={999}
              aria-label="Pages"
              value={s.pageNumberThreshold}
              onChange={(e) => updateSettings({ pageNumberThreshold: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })}
            />
          </SettingsCard>
        </div>
      ) : (
        <ShortcutEditor />
      )}
    </Modal>
  )
}
