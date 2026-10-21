/**
 * Glance's skills and prompts for AI apps (ADR 0019): each skill's SKILL.md and examples
 * are MCP resources, and prompts.json lists the prompts (create-deck, create-document,
 * create-spreadsheet, edit-file), whose text guide.ts writes. glance-mcp answers the lists
 * and the app's own skills without starting Glance (src-tauri/mcp-bridge); Glance answers
 * the rest, including skills the person added.
 */
import catalog from './prompts.json'
import { INVALID_PARAMS, RpcError, type Guidance } from './protocol'
import { parseSkillUri, skillUri, type Skill } from '../ai/skills'
import { promptText } from '../ai/guide'

export const PROMPTS = catalog.prompts

/** The resources for a set of skills: each SKILL.md, then each example. */
export function skillResources(skills: Skill[]): { uri: string; name: string; title: string; description: string; mimeType: string }[] {
  return skills.flatMap((s) => [
    // i18n-ignore: for AI apps
    { uri: skillUri(s.name), name: s.name, title: `Skill: ${s.name}`, description: s.description, mimeType: 'text/markdown' },
    // i18n-ignore: for AI apps
    ...Object.keys(s.files ?? {}).sort().map((f) => ({ uri: skillUri(s.name, f), name: `${s.name}/${f}`, title: `Skill ${s.name}: ${f}`, description: `An example for the ${s.name} skill.`, mimeType: 'text/markdown' }))
  ])
}

/** The text of a skill resource as an agent reads it: the SKILL.md with its frontmatter. */
export function skillText(s: Skill): string {
  return `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body}\n`
}

/** Prompts and resources over the skills that are on right now. */
export function guidance(skills: () => Promise<Skill[]>): Guidance {
  return {
    prompts: () => PROMPTS,
    async getPrompt(name, args) {
      const def = PROMPTS.find((p) => p.name === name)
      const missing = def?.arguments.find((a) => a.required && !args[a.name]?.trim())
      if (!def) throw new RpcError(INVALID_PARAMS, `Unknown prompt: ${name}`)
      if (missing) throw new RpcError(INVALID_PARAMS, `missing required argument "${missing.name}"`)
      const text = promptText(name, args, await skills())!
      return { description: def.description, messages: [{ role: 'user', content: { type: 'text', text } }] }
    },
    resources: async () => skillResources(await skills()),
    async readResource(uri) {
      const ref = parseSkillUri(uri)
      const skill = ref && (await skills()).find((s) => s.name === ref.name)
      const text = skill && (ref.file === 'SKILL.md' ? skillText(skill) : skill.files?.[ref.file])
      if (!text) throw new RpcError(INVALID_PARAMS, `Unknown resource: ${uri}`)
      return { contents: [{ uri, mimeType: 'text/markdown', text }] }
    }
  }
}
