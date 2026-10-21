/**
 * The skills Glance gives agents (ADR 0019): the ones that ship in src/skills (loaded when
 * first needed) and the ones the person added to the skills folder in Glance's app data.
 * Settings → AI apps turns each on or off.
 */
import { signal } from '@preact/signals'
import * as platform from '../platform'
import { mergeSkills, parseSkill, skillFile, type Skill } from '../core/ai/skills'
import { settings, updateSettings } from './settings'

const bundled = import.meta.glob('../skills/*/SKILL.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const bundledFiles = import.meta.glob('../skills/*/examples/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

let appSkills: Promise<Skill[]> | null = null

/** The skills that ship with Glance. */
export function loadAppSkills(): Promise<Skill[]> {
  appSkills ??= (async () => {
    const files = await Promise.all(Object.entries(bundledFiles).map(async ([path, load]) => [path, await load()] as const))
    const out = await Promise.all(Object.entries(bundled).map(async ([path, load]) => {
      const dir = path.slice(0, -'SKILL.md'.length)
      const extra = Object.fromEntries(files.filter(([p]) => p.startsWith(dir)).map(([p, text]) => [p.slice(dir.length), text]))
      return parseSkill(await load(), 'app', extra)
    }))
    return out.filter((s): s is Skill => !!s).sort((a, b) => a.name.localeCompare(b.name))
  })()
  return appSkills
}

/** Every skill, on or off: Glance's, then the person's (which replace Glance's of the same name). */
export const allSkills = signal<Skill[]>([])
/** Skills folders that couldn't be read as skills, to show in Settings. */
export const skillProblems = signal<string[]>([])

export async function refreshSkills(): Promise<Skill[]> {
  const app = await loadAppSkills()
  const user: Skill[] = []
  const problems: string[] = []
  for (const f of await platform.userSkills().catch(() => [])) {
    const s = parseSkill(f.text, 'user', f.files)
    if (s) user.push(s)
    else problems.push(f.folder)
  }
  allSkills.value = mergeSkills(app, user)
  skillProblems.value = problems
  return allSkills.peek()
}

let loaded: Promise<Skill[]> | null = null

/** The skills that are on, for guiding requests and for AI apps. */
export async function activeSkills(): Promise<Skill[]> {
  loaded ??= refreshSkills()
  const all = allSkills.peek().length ? allSkills.peek() : await loaded
  const off = new Set(settings.peek().skillsOff)
  return all.filter((s) => !off.has(s.name))
}

export function setSkillOn(name: string, on: boolean): void {
  const off = new Set(settings.peek().skillsOff)
  if (on) off.delete(name)
  else off.add(name)
  updateSettings({ skillsOff: [...off] })
}

/** The note for AGENTS.md: what Glance offers and which skills to read. */
function agentsNote(skills: Skill[]): string {
  return [
    '## Glance',
    'To make or change slide decks, documents and spreadsheets, use the Glance MCP server ("glance") rather than writing .pptx, .docx or .xlsx files or code: glance_templates, glance_create, then the read, edit, check and render tools for the kind of file.',
    'Before you start, read the matching Glance skill (MCP resources skill://glance/<name>/SKILL.md):',
    ...skills.map((s) => `- ${s.name}: ${s.description}`)
  ].join('\n')
}

/** Copies the skills that are on to Claude Code's skills folder and a note to AGENTS.md (Settings → AI apps). */
export async function installSkillsForAgents(): Promise<string[]> {
  const skills = await activeSkills()
  return platform.installSkills(
    skills.map((s) => ({ name: `glance-${s.name}`, text: skillFile(s, `glance-${s.name}`), files: s.files ?? {} })),
    agentsNote(skills)
  )
}
