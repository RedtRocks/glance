import { useEffect, useState } from 'preact/hooks'
import * as platform from '../../platform'
import { settings, updateSettings } from '../../state/settings'
import { toast } from '../../state/ui'
import { t } from '../../i18n'
import { Icon } from '../Icon'
import { SettingsCard, Toggle } from './SettingsDialog'
import { allSkills, installSkillsForAgents, refreshSkills, setSkillOn, skillProblems } from '../../state/skills'

/** Settings → AI apps → Skills: Glance's design and writing guidance for agents, each on or off. */
function SkillsPanel() {
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void refreshSkills()
    void platform.skillsInstalled().then(setInstalled)
  }, [])
  const off = new Set(settings.value.skillsOff)
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await f()
      toast(done)
    } catch (e) {
      toast(String((e as Error).message ?? e), 'error')
    } finally {
      setBusy(false)
      void platform.skillsInstalled().then(setInstalled)
    }
  }
  return (
    <>
      <h3 class="settings-subhead">{t('Skills')}</h3>
      <p class="settings-note">{t('Skills are Glance’s design and writing guidance for making slides, documents and spreadsheets. Glance gives the ones that are on to the AI with each request, and to AI apps.')}</p>
      {allSkills.value.map((s) => (
        <SettingsCard key={s.name} icon="sparkle" title={s.source === 'user' ? t('{name} (yours)', { name: s.name }) : s.name} description={s.description}>
          <Toggle checked={!off.has(s.name)} label={s.name} onChange={(v) => setSkillOn(s.name, v)} />
        </SettingsCard>
      ))}
      {skillProblems.value.length > 0 && <p class="settings-note">{t('These folders have no usable SKILL.md (it needs a name and a description): {folders}', { folders: skillProblems.value.join(', ') })}</p>}
      <SettingsCard icon="open" title={t('Your own skills')} description={t('Add a folder with a SKILL.md to the skills folder, in the same shape as Claude’s Agent Skills. Glance reads it next time you open this page.')}>
        <button class="btn" onClick={() => void platform.skillsFolder().then(platform.revealInExplorer).catch((e) => toast(String(e), 'error'))}>{t('Open skills folder')}</button>
      </SettingsCard>
      <SettingsCard icon="apps" title={t('Give the skills to Claude Code and Codex')}
        description={installed ? t('Installed as Claude Code skills and a note in Codex’s AGENTS.md. Install again after changing skills.') : t('Copies the skills that are on to Claude Code’s skills folder and adds a note to Codex’s AGENTS.md, so they have them before they first use Glance.')}>
        <div class="settings-card-buttons">
          <button class="btn primary" disabled={busy} onClick={() => void run(installSkillsForAgents, t('Skills installed'))}>{installed ? t('Install again') : t('Install')}</button>
          {installed && <button class="btn" disabled={busy} onClick={() => void run(platform.uninstallSkills, t('Skills removed'))}>{t('Remove')}</button>}
        </div>
      </SettingsCard>
    </>
  )
}

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
  const line = state?.command ? [state.command, ...state.args].join(' ') : ''
  const snippet = state?.command ? JSON.stringify({ mcpServers: { glance: { command: state.command, args: state.args } } }, null, 2) : ''

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
          description={t('Add Glance as a local (stdio) MCP server with this command: {command}', { command: line })}>
          <div class="settings-card-buttons">
            <button class="btn" onClick={() => copy(line)}>{t('Copy command')}</button>
            <button class="btn" onClick={() => copy(snippet)}>{t('Copy JSON')}</button>
          </div>
        </SettingsCard>
      )}
      {missing.length > 0 && (
        <p class="settings-note">
          <Icon name="infoFilled" /> {t('Also supported when installed: {apps}', { apps: missing.map((a) => a.name).join(', ') })}
        </p>
      )}
      <h3 class="settings-subhead">{t('Ask AI')}</h3>
      <SettingsCard icon="sparkle" title={t('Ask Claude or ChatGPT when Glance can’t do it')}
        description={t('When Glance can’t make something, it hands the request to the company you use in Ask AI and opens the file it makes. Files you opened yourself are sent only after you say yes.')}>
        <Toggle checked={settings.value.handOff} label={t('Ask Claude or ChatGPT when Glance can’t do it')} onChange={(v) => updateSettings({ handOff: v })} />
      </SettingsCard>
      <SettingsCard icon="globe" title={t('Open files made on AI websites in Glance')}
        description={t('Files you download from claude.ai, chatgpt.com and other AI websites in the sidebar open in a new tab. They’re also saved in Downloads.')}>
        <Toggle checked={settings.value.openSiteDownloads} label={t('Open files made on AI websites in Glance')} onChange={(v) => updateSettings({ openSiteDownloads: v })} />
      </SettingsCard>
      <SkillsPanel />
    </div>
  )
}
