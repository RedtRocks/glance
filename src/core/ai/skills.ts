/**
 * Glance skills (ADR 0019): a folder with a SKILL.md in the shape of Claude's Agent Skills
 * (frontmatter with name and description, then the guidance), plus optional examples.
 * Glance picks the skills for the file and the request and gives them to whichever agent
 * is running: in the Ask AI sidebar's messages, and as MCP resources and prompts.
 *
 * Which skills fit what comes from the frontmatter's metadata:
 *   kinds: deck, document, spreadsheet or any (default any)
 *   when: create, edit or both (default both)
 *   keywords: words, at least one of which the request must contain (default none needed)
 */

export type FileKind = 'deck' | 'document' | 'spreadsheet'
export const FILE_KINDS: FileKind[] = ['deck', 'document', 'spreadsheet']

export type Mode = 'create' | 'edit'

export interface Skill {
  /** Lowercase letters, digits and hyphens, as Agent Skills require. */
  name: string
  description: string
  /** The guidance, without the frontmatter. */
  body: string
  kinds: FileKind[] | 'any'
  when: Mode[]
  keywords: string[]
  /** Shipped with Glance, or added by the person to their skills folder. */
  source: 'app' | 'user'
  /** Extra files (examples), by path inside the skill's folder. */
  files?: Record<string, string>
}

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

const unquote = (v: string) => {
  const s = v.trim()
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) ? s.slice(1, -1) : s
}

/**
 * Reads a SKILL.md. Only the frontmatter's top-level keys and the `metadata` map are read,
 * which is all Agent Skills define. Returns null for a file that isn't a usable skill.
 */
export function parseSkill(text: string, source: Skill['source'], files?: Record<string, string>): Skill | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return null
  const top: Record<string, string> = {}
  const meta: Record<string, string> = {}
  let inMeta = false
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const kv = /^(\s*)([\w-]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, indent, key, value] = kv
    if (!indent) {
      inMeta = key === 'metadata' && !value.trim()
      top[key] = unquote(value)
    } else if (inMeta) meta[key] = unquote(value)
  }
  const name = top.name?.trim()
  const description = top.description?.trim()
  if (!name || !NAME.test(name) || !description) return null
  const kinds = list(meta.kinds).filter((k): k is FileKind => (FILE_KINDS as string[]).includes(k))
  const when = list(meta.when).filter((w): w is Mode => w === 'create' || w === 'edit')
  return {
    name,
    description,
    body: text.slice(m[0].length).trim(),
    kinds: !kinds.length || list(meta.kinds).includes('any') ? 'any' : kinds,
    when: when.length ? when : ['create', 'edit'],
    keywords: list(meta.keywords),
    source,
    ...(files && Object.keys(files).length ? { files } : {})
  }
}

/** Whether a word list matches the request, by whole words, ignoring case. */
function mentions(request: string, words: string[]): boolean {
  const text = ` ${request.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  return words.some((w) => text.includes(` ${w.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `))
}

/**
 * The skills for this file and request, most specific first: skills for this kind before
 * skills for any kind, and the person's own before Glance's.
 */
export function pickSkills(skills: Skill[], kind: FileKind, mode: Mode, request: string): Skill[] {
  const fits = skills.filter((s) => (s.kinds === 'any' || s.kinds.includes(kind)) && s.when.includes(mode) && (!s.keywords.length || mentions(request, s.keywords)))
  const rank = (s: Skill) => (s.kinds === 'any' ? 2 : 0) + (s.source === 'user' ? 0 : 1)
  return fits.sort((a, b) => rank(a) - rank(b))
}

/** Skills by name, later ones replacing earlier ones, so a person's skill can stand in for Glance's. */
export function mergeSkills(...groups: Skill[][]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const s of groups.flat()) byName.set(s.name, s)
  return [...byName.values()]
}

/** The MCP resource address of a skill's SKILL.md, or of one of its files. */
export const skillUri = (name: string, file = 'SKILL.md') => `skill://glance/${name}/${file}`

/** The skill name and file an address names, or null. */
export function parseSkillUri(uri: string): { name: string; file: string } | null {
  const m = /^skill:\/\/glance\/([a-z0-9-]+)\/([\w./-]+)$/.exec(uri)
  return m && !m[2].includes('..') ? { name: m[1], file: m[2] } : null
}

/** A skill as SKILL.md text, for installing it where other agents look for skills. */
export function skillFile(skill: Skill, name = skill.name): string {
  const desc = skill.description.replace(/\s+/g, ' ')
  return `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${skill.body}\n`
}
