import { useEffect, useState } from 'preact/hooks'
import * as platform from '../../platform'
import { settings, updateSettings } from '../../state/settings'
import { toast } from '../../state/ui'
import { t } from '../../i18n'
import { Icon } from '../Icon'
import { SettingsCard, Toggle } from './SettingsDialog'

/** Settings → AI apps: lets AI apps (Claude, Codex, Cursor, …) use Glance through MCP. */
export function AiAppsPanel() {
  const [state, setState] = useState<platform.AiApps | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = (): void => void platform.aiApps().then(setState, (e) => toast(String(e), 'error'))
  useEffect(refresh, [])

  const change = async (app: platform.AiApp, connect: boolean): Promise<void> => {
    setBusy(app.id)
    try {
      if (connect) {
        await platform.aiAppConnect(app.id)
        toast(t('{app} can now use Glance. If it’s open, restart it.', { app: app.name }))
      } else {
        await platform.aiAppDisconnect(app.id)
        toast(t('Removed Glance from {app}', { app: app.name }))
      }
    } catch (e) {
      toast(String((e as Error).message ?? e), 'error')
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const copy = (text: string): void => void platform.copyText(text).then(() => toast(t('Copied')))
  const installed = state?.apps.filter((a) => a.installed) ?? []
  const missing = state?.apps.filter((a) => !a.installed) ?? []
  const snippet = state?.command ? JSON.stringify({ mcpServers: { glance: { command: state.command, args: [] } } }, null, 2) : ''

  return (
    <div class="settings-cards">
      <SettingsCard icon="sparkle" title={t('Let AI apps use Glance')}
        description={t('Connected AI apps can view, read and convert your files, combine and redact PDFs (always into new files), and see and control the documents open in Glance. Glance starts in the background when they need it.')}>
        <Toggle checked={settings.value.aiApps} label={t('Let AI apps use Glance')} onChange={(v) => updateSettings({ aiApps: v })} />
      </SettingsCard>
      {state?.problem && <p class="settings-note">{state.problem}</p>}
      {installed.map((app) => (
        <SettingsCard key={app.id} icon="apps" title={app.name}
          description={app.connected ? t('Connected. Ask it to use Glance, for example “open this PDF in Glance”.') : t('Not connected')}>
          <button class={`btn ${app.connected ? '' : 'primary'}`} disabled={!state?.command || busy === app.id || !settings.value.aiApps} onClick={() => void change(app, !app.connected)}>
            {app.connected ? t('Disconnect') : t('Connect')}
          </button>
        </SettingsCard>
      ))}
      {state && !installed.length && !state.problem && <p class="settings-note">{t('No supported AI apps were found for this Windows user. Use the command below to add Glance to any app that supports MCP.')}</p>}
      {state?.command && (
        <SettingsCard icon="copy" title={t('Other apps')}
          description={t('Add Glance as a local (stdio) MCP server with this command: {command}', { command: state.command })}>
          <div class="settings-card-buttons">
            <button class="btn" onClick={() => copy(state.command)}>{t('Copy command')}</button>
            <button class="btn" onClick={() => copy(snippet)}>{t('Copy JSON')}</button>
          </div>
        </SettingsCard>
      )}
      {missing.length > 0 && (
        <p class="settings-note">
          <Icon name="infoFilled" /> {t('Also supported when installed: {apps}', { apps: missing.map((a) => a.name).join(', ') })}
        </p>
      )}
    </div>
  )
}
