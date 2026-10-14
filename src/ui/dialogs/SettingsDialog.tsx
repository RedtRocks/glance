import { useEffect, useState } from 'preact/hooks'
import { settings, updateSettings, type ThemePref, type LookPref } from '../../state/settings'
import { customizeOpen, settingsOpen } from '../../state/ui'
import { storeInstall } from '../../state/updates'
import { defaultApp, makeDefault, refreshDefaultApp } from '../../state/defaultApp'
import { toast } from '../../state/ui'
import { COMMANDS, bindings, keyScope } from '../../state/commands'
import { comboFromEvent, displayCombo, findConflicts } from '../../core/shortcuts'
import { Modal } from './Dialog'
import { LANGUAGES, PSEUDO, languageName, t } from '../../i18n'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import type { ComponentChildren } from 'preact'
import * as platform from '../../platform'
import { AiAppsPanel } from './AiAppsPanel'
import { ColourPanel } from './ColourPanel'

/** Windows 11 Settings-style row: icon, title and description, control on the right. */
export function SettingsCard({ icon, title, description, children }: { icon: IconName; title: string; description: string; children: ComponentChildren }) {
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

/** "Default app": whether Windows opens PDFs and images with Glance, and a button to change it. */
function DefaultAppCard() {
  useEffect(() => void refreshDefaultApp(), [])
  const s = defaultApp.value
  const description = !s
    ? t('Open PDFs and images with Glance when you double-click them.')
    : s.pdf && s.images
      ? t('Glance opens your PDFs and images.')
      : s.pdf
        ? t('Glance opens your PDFs. Images open in another app.')
        : s.images
          ? t('Glance opens your images. PDFs open in another app.')
          : t('PDFs and images open in another app.')
  return (
    <SettingsCard icon="apps" title={t('Default app')} description={description}>
      <button class="btn" onClick={() => void makeDefault().catch((e: Error) => toast(e.message))}>
        {s?.pdf && s.images ? t('Change in Windows Settings') : t('Make default')}
      </button>
    </SettingsCard>
  )
}

/** WinUI ToggleSwitch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="toggle-switch">
      <span class="toggle-state">{checked ? t('On') : t('Off')}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  )
}

function ShortcutEditor() {
  const [recording, setRecording] = useState<string | null>(null)
  const current = bindings()
  const conflicts = new Map(findConflicts(current, keyScope).flatMap(([combo, ids]) => ids.map((id) => [id, combo] as const)))
  const setKeys = (id: string, keys: string[] | undefined): void => {
    const next = { ...settings.value.shortcuts }
    if (keys) next[id] = keys
    else delete next[id]
    updateSettings({ shortcuts: next })
  }
  return (
    <div class="shortcut-table" role="table" aria-label={t('Keyboard shortcuts')}>
      {COMMANDS.map((c) => (
        <div class="shortcut-row" role="row" key={c.id}>
          <span role="cell">{t(c.label)}</span>
          <button
            role="cell"
            class={`shortcut-key ${recording === c.id ? 'recording' : ''} ${conflicts.has(c.id) ? 'conflict' : ''}`}
            title={conflicts.has(c.id) ? t('This shortcut is also used by another command') : t('Click, then press a new shortcut')}
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
            {recording === c.id ? t('Press keys…') : current[c.id].map(displayCombo).join(', ') || '—'}
          </button>
          {settings.value.shortcuts[c.id] && (
            <button role="cell" class="link-button" onClick={() => setKeys(c.id, undefined)}>
              {t('Reset')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function SettingsDialog() {
  const s = settings.value
  const [tab, setTab] = useState<'general' | 'customise' | 'shortcuts' | 'ai'>('general')
  const close = (): void => void (settingsOpen.value = false)
  // The pseudo-locale is for developers; it stays listed once chosen so it can be turned off.
  const languages = import.meta.env.DEV || s.language === PSEUDO ? [...LANGUAGES, PSEUDO] : LANGUAGES
  return (
    <Modal title={t('Settings')} onClose={close} wide footer={<button class="btn primary" onClick={close}>{t('Done')}</button>}>
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>{t('General')}</button>
        <button role="tab" aria-selected={tab === 'customise'} onClick={() => setTab('customise')}>{t('Customise')}</button>
        <button role="tab" aria-selected={tab === 'shortcuts'} onClick={() => setTab('shortcuts')}>{t('Keyboard shortcuts')}</button>
        {platform.isTauri && <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>{t('AI apps')}</button>}
      </div>
      {tab === 'general' ? (
        <div class="settings-cards">
          {platform.windowsShell && <DefaultAppCard />}
          <SettingsCard icon="language" title={t('Language')} description={platform.windowsShell ? t('Follow Windows, or pick the language Glance uses.') : t('Follow the system, or pick the language Glance uses.')}>
            <select value={s.language} onChange={(e) => updateSettings({ language: (e.target as HTMLSelectElement).value })}>
              <option value="system">{platform.windowsShell ? t('Use Windows setting') : t('Use system setting')}</option>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </select>
          </SettingsCard>
          <SettingsCard icon="save" title={t('Save changes automatically')}
            description={t('About ten seconds after you stop editing (at most once a minute), and right away when you switch to another app or tab or close the file. Every save keeps a version you can go back to (File → Browse Versions). JPEG images and documents with pending redactions are only saved when you choose Save.')}>
            <Toggle checked={s.autosave} label={t('Save changes automatically')} onChange={(v) => updateSettings({ autosave: v })} />
          </SettingsCard>
          <SettingsCard icon="tabs" title={t('Reopen tabs on launch')}
            description={t('Open the files you had open when Glance last closed, on the same page and zoom. Files that were moved or deleted are skipped.')}>
            <Toggle checked={s.reopenTabs} label={t('Reopen tabs on launch')} onChange={(v) => updateSettings({ reopenTabs: v })} />
          </SettingsCard>
          {storeInstall.value ? null : (
            <SettingsCard icon="info" title={t('Check for updates')}
              description={t('Once a day Glance asks GitHub whether a newer version exists and tells you. Nothing is downloaded or sent until you choose Download.')}>
              <Toggle checked={s.checkForUpdates} label={t('Check for updates')} onChange={(v) => updateSettings({ checkForUpdates: v })} />
            </SettingsCard>
          )}
          {platform.isTauri ? (
            <SettingsCard icon="info" title={t('Count this install')}
              description={t('Once a day Glance tells its developer that a copy is in use, with its version number, so they know how many people use Glance. No ID, file names or anything you open is sent. See the privacy policy.')}>
              <Toggle checked={s.countInstall} label={t('Count this install')} onChange={(v) => updateSettings({ countInstall: v })} />
            </SettingsCard>
          ) : null}
          <SettingsCard icon="grid" title={t('Page number field')}
            description={t('Show it in the toolbar for documents longer than this many pages. Previous/next buttons appear for any multi-page document.')}>
            <input
              class="number-box"
              type="number"
              min={1}
              max={999}
              aria-label={t('Pages')}
              value={s.pageNumberThreshold}
              onChange={(e) => updateSettings({ pageNumberThreshold: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })}
            />
          </SettingsCard>
        </div>
      ) : tab === 'customise' ? (
        <div class="settings-cards">
          <SettingsCard icon="moon" title={t('App theme')} description={platform.windowsShell ? t('Follow Windows, or always use light or dark.') : t('Follow the system, or always use light or dark.')}>
            <select value={s.theme} onChange={(e) => updateSettings({ theme: (e.target as HTMLSelectElement).value as ThemePref })}>
              <option value="system">{platform.windowsShell ? t('Use Windows setting') : t('Use system setting')}</option>
              <option value="light">{t('Light')}</option>
              <option value="dark">{t('Dark')}</option>
            </select>
          </SettingsCard>
          {platform.isTauri && (
            <SettingsCard icon="adjustColor" title={t('Design')} description={t('Match Windows, or use the look of the Glance website.')}>
              <select value={s.look} onChange={(e) => updateSettings({ look: (e.target as HTMLSelectElement).value as LookPref })}>
                <option value="fluent">{t('Windows')}</option>
                <option value="wollo">{t('Glance')}</option>
              </select>
            </SettingsCard>
          )}
          <div class="settings-card settings-card-stack">
            <div class="settings-card-head">
              <span class="settings-card-icon" aria-hidden="true">
                <Icon name="paintBrush" />
              </span>
              <div class="settings-card-text">
                <span class="settings-card-title">{t('Window colours')}</span>
                <span class="settings-card-desc">{t('Pick up to three colours on the wheel for a gradient. The first is also the accent colour for selections, switches and highlights.')}</span>
              </div>
            </div>
            <ColourPanel />
          </div>
          {platform.isTauri && (
            <SettingsCard icon="tabs" title={t('Tabs')} description={t('Show open files across the top, or down the left side.')}>
              <select value={s.tabs} onChange={(e) => updateSettings({ tabs: (e.target as HTMLSelectElement).value as 'top' | 'side' })}>
                <option value="top">{t('Top')}</option>
                <option value="side">{t('Side')}</option>
              </select>
            </SettingsCard>
          )}
          {platform.isTauri && (
            <SettingsCard icon="tabs" title={t('Collapse tabs')} description={t('Shrink tabs to their icons to give the document more room. View → Collapse Tabs does the same.')}>
              <Toggle checked={s.tabsCollapsed} label={t('Collapse tabs')} onChange={(v) => updateSettings({ tabsCollapsed: v })} />
            </SettingsCard>
          )}
          {platform.isTauri && (
            <SettingsCard icon="edit" title={t('Toolbar')} description={t('Choose which buttons the toolbar shows, and in what order.')}>
              <button class="btn" onClick={() => void (customizeOpen.value = true)}>{t('Customize Toolbar…')}</button>
            </SettingsCard>
          )}
          <SettingsCard icon="document" title={t('Dark appearance for PDFs')} description={t('Invert page colors while Glance is dark. Images inside PDFs are inverted too.')}>
            <Toggle checked={s.darkPdf} label={t('Dark appearance for PDFs')} onChange={(v) => updateSettings({ darkPdf: v })} />
          </SettingsCard>
        </div>
      ) : tab === 'ai' ? (
        <AiAppsPanel />
      ) : (
        <ShortcutEditor />
      )}
    </Modal>
  )
}
