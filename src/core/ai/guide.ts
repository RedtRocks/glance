/**
 * Guided requests: turns what the person typed, and what they have open, into the message
 * the AI gets, for making a new deck, document or spreadsheet and for changing one. The
 * person sees their own words in the chat; the AI also gets the file's kind and tab, what
 * is selected, the template and its limits, the skills for the job, the tools to use, the
 * check → render → fix loop and the placeholder rule.
 *
 * The message is read by the AI, so it is English; the AI answers in the person's language.
 */
import type { FileKind, Mode, Skill } from './skills'
import { pickSkills, skillUri } from './skills'
import { HAND_OFF_RULE } from './handOff'

export type { FileKind } from './skills'

/** The tools for each kind of file. Documents and spreadsheets: see BUILD-DOCS/BUILD-SHEETS. */
export const KIND_TOOLS: Record<FileKind, { read: string; edit: string; check: string; render: string; noun: string; parts: string; part: string; office: string }> = {
  deck: { read: 'glance_deck_outline', edit: 'glance_deck_edit', check: 'glance_deck_check', render: 'glance_deck_render', noun: 'deck', parts: 'slides', part: 'slide', office: '.pptx' },
  document: { read: 'glance_doc_outline', edit: 'glance_doc_edit', check: 'glance_doc_check', render: 'glance_doc_render', noun: 'document', parts: 'sections', part: 'section', office: '.docx' },
  spreadsheet: { read: 'glance_sheet_read', edit: 'glance_sheet_edit', check: 'glance_sheet_check', render: 'glance_sheet_render', noun: 'spreadsheet', parts: 'sheets', part: 'sheet', office: '.xlsx' }
}

/** A text slot or text box, with what it holds now and how much fits. */
export interface SlotInfo {
  name: string
  text: string
  maxChars?: number
}

export type Selection =
  | { kind: 'deck'; slides: { id: string; number: number; layout: string; design?: string; role?: string; slots: SlotInfo[] }[] }
  | { kind: 'document'; page?: number; blocks: { id: string; type: string; text: string; maxChars?: number }[] }
  | { kind: 'spreadsheet'; sheet: string; range: string; values: unknown[][]; formulas?: (string | null)[][]; validation?: string[] }

/** What the person has open, as the AI needs to know it. */
export interface FileContext {
  kind: FileKind
  /** The Glance tab id the tools take. */
  tab: string
  name?: string
  path?: string
  /** The template the file is made from. */
  template?: { id: string; name: string; look?: string }
  /** A theme or look in use, when there is no template. */
  look?: string
  /** How many slides, pages or sheets. */
  count?: number
  /** What the person has selected; for a deck with nothing picked, the slide on screen. */
  selection?: Selection
  /** Placeholders like [date] still in the file. */
  placeholders?: string[]
}

export interface PlanItem {
  title: string
  detail?: string
  /** For a template: the design (deck) or page design the item uses. */
  design?: string
}

export interface PlanQuestion {
  question: string
  answer?: string
}

/** The AI's plan for a new file, edited by the person on the Outline screen. */
export interface Plan {
  kind: FileKind
  title?: string
  /** For whom and the one thing they should take away. */
  audience?: string
  items: PlanItem[]
  /** A template id, or a theme or look id. */
  look?: string
  questions?: PlanQuestion[]
}

export type Density = 'few' | 'some' | 'lots'

export interface GuideOptions {
  /** The skills that are on; the guide picks the ones for this file and request. */
  skills?: Skill[]
  /** Skills this chat already has in full; they are only named again. */
  sent?: ReadonlySet<string>
}

export interface CreateOptions extends GuideOptions {
  /** Ask for a plan first (glance_plan) instead of building. */
  planFirst?: boolean
  /** The plan the person approved. */
  plan?: Plan
  density?: Density
}

export interface Guided {
  text: string
  /** The skills given in full in this message, to add to the chat's sent set. */
  skills: string[]
}

const MAX_VALUE = 80
const MAX_CELLS = 60

const clip = (s: string, n = MAX_VALUE) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** A placeholder like [date] or [venue name]: square brackets around a few words. */
export const PLACEHOLDER = /\[[^[\]\n]{1,40}\]/g

/** The placeholders in a text, in order, without repeats. */
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER) ?? [])]
}

/** Splits text into plain runs and placeholders, for highlighting them. */
export function placeholderRuns(text: string): { text: string; placeholder: boolean }[] {
  const out: { text: string; placeholder: boolean }[] = []
  let at = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), placeholder: false })
    out.push({ text: m[0], placeholder: true })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), placeholder: false })
  return out
}

/** The counter shown while typing in a slot: how many characters, and whether that's too many. */
export function charCount(text: string, maxChars: number | undefined, perLine = false): { used: number; max: number; over: boolean; near: boolean } | null {
  if (!maxChars) return null
  const used = perLine ? Math.max(0, ...text.split('\n').map((l) => l.trim().length)) : text.trim().length
  return { used, max: maxChars, over: used > maxChars, near: used > maxChars * 0.85 }
}

/** A spreadsheet validation rule in a few words, for the grid and for the AI. */
export function validationHint(rule: { type: string; values?: string[]; min?: number | string; max?: number | string; operator?: string }): string {
  const range = rule.min !== undefined && rule.max !== undefined ? ` from ${rule.min} to ${rule.max}` : rule.min !== undefined ? ` of at least ${rule.min}` : rule.max !== undefined ? ` of at most ${rule.max}` : ''
  switch (rule.type) {
    case 'list':
      return `one of: ${(rule.values ?? []).join(', ')}`
    case 'checkbox':
    case 'boolean':
      return 'a tick box (TRUE or FALSE)'
    case 'whole':
      return `a whole number${range}`
    case 'decimal':
    case 'number':
      return `a number${range}`
    case 'date':
      return `a date${range}`
    case 'textLength':
      return `text${rule.max !== undefined ? ` of at most ${rule.max} characters` : ''}`
    default:
      return rule.type
  }
}

function slotLine(s: SlotInfo): string {
  const limit = s.maxChars ? `, maxChars ${s.maxChars}${s.text.length > s.maxChars ? ' (over now)' : ''}` : ''
  return `${s.name}${limit}: ${s.text ? JSON.stringify(clip(s.text)) : 'empty'}`
}

function selectionLines(sel: Selection): string[] {
  switch (sel.kind) {
    case 'deck':
      return sel.slides.flatMap((s) => [
        `- Slide ${s.number} (id ${s.id}, ${s.design ? `design ${s.design}${s.role ? `, ${s.role}` : ''}` : `layout ${s.layout}`})`,
        ...s.slots.map((slot) => `  - ${slotLine(slot)}`)
      ])
    case 'document':
      return [
        ...(sel.page ? [`- Page ${sel.page}`] : []),
        ...sel.blocks.map((b) => `- Block ${b.id} (${b.type}${b.maxChars ? `, maxChars ${b.maxChars}` : ''}): ${b.text ? JSON.stringify(clip(b.text)) : 'empty'}`)
      ]
    case 'spreadsheet': {
      const lines = [`- Sheet ${JSON.stringify(sel.sheet)}, range ${sel.range}`]
      let cells = 0
      sel.values.forEach((row, r) => {
        if (cells >= MAX_CELLS) return
        const shown = row.map((v, c) => {
          const f = sel.formulas?.[r]?.[c]
          return f ? `${String(v ?? '')} (${f})` : v === null || v === undefined || v === '' ? '·' : clip(String(v), 30)
        })
        cells += row.length
        lines.push(`  - ${shown.join(' | ')}`)
      })
      if (cells >= MAX_CELLS && sel.values.length) lines.push('  - … (more rows: read the range with glance_sheet_read)')
      for (const v of sel.validation ?? []) lines.push(`  - Rule: ${v}`)
      return lines
    }
  }
}

function fileLines(ctx: FileContext): string[] {
  const k = KIND_TOOLS[ctx.kind]
  const name = ctx.name ? ` ${JSON.stringify(ctx.name)}` : ''
  const where = ctx.path ? ` (${ctx.path})` : ''
  const count = ctx.count !== undefined ? `, ${ctx.count} ${ctx.count === 1 ? k.part : k.parts}` : ''
  const lines = [`Open ${k.noun}:${name}${where}, tab ${ctx.tab}${count}.`]
  if (ctx.template) lines.push(`Template: ${ctx.template.name} (id ${ctx.template.id}${ctx.template.look ? `, look ${ctx.template.look}` : ''}). glance_templates lists its designs with each slot's maxChars.`)
  else if (ctx.look) lines.push(`Look: ${ctx.look}.`)
  if (ctx.selection) {
    const nothing = ctx.selection.kind === 'deck' ? !ctx.selection.slides.length : ctx.selection.kind === 'document' ? !ctx.selection.blocks.length : false
    if (!nothing) lines.push(ctx.selection.kind === 'spreadsheet' ? 'Selected ("this" and "here" mean these cells):' : 'Selected ("this" and "here" mean these):', ...selectionLines(ctx.selection))
  }
  if (ctx.placeholders?.length) lines.push(`Placeholders still to fill: ${ctx.placeholders.slice(0, 12).join(', ')}.`)
  return lines
}

/** The skills section: new skills in full, ones the chat already has by name. */
function skillLines(skills: Skill[], sent: ReadonlySet<string>): { lines: string[]; given: string[] } {
  if (!skills.length) return { lines: [], given: [] }
  const fresh = skills.filter((s) => !sent.has(s.name))
  const known = skills.filter((s) => sent.has(s.name))
  const lines: string[] = []
  if (known.length) lines.push(`Follow the ${known.map((s) => s.name).join(', ')} skill${known.length > 1 ? 's' : ''} given earlier.`)
  for (const s of fresh) lines.push('', `<skill name="${s.name}">`, s.body, '</skill>')
  return { lines, given: fresh.map((s) => s.name) }
}

const toolRule = (kind: FileKind) => {
  const k = KIND_TOOLS[kind]
  return `Use Glance's tools: read with ${k.read}, change with ${k.edit}. Don't write files, scripts or a ${k.office} yourself. ${HAND_OFF_RULE}`
}

const loop = (kind: FileKind, what: string) => {
  const k = KIND_TOOLS[kind]
  return `Then call ${k.check} and fix every finding, look at ${what} with ${k.render} and fix anything that looks wrong, and finish by telling me in a sentence or two what you did.`
}

const PLACEHOLDER_RULE = "If you don't have a fact you need, write a clear placeholder in square brackets like [date] rather than inventing it (Glance highlights them for me), and never leave a template's sample names, dates or numbers in."

const DENSITY: Record<Density, string> = {
  few: 'Words: few. Keep text short, about half of each slot\'s maxChars, and leave detail out.',
  some: '',
  lots: 'Words: lots. Use fuller text up to each slot\'s maxChars, and put more detail in notes or body text.'
}

/** The plan as lines for the build message. */
export function planLines(plan: Plan): string[] {
  const k = KIND_TOOLS[plan.kind]
  const lines = [`The plan I approved (build exactly this, in this order, ${plan.items.length} ${plan.items.length === 1 ? k.part : k.parts}):`]
  if (plan.title) lines.push(`Title: ${plan.title}`)
  if (plan.audience) lines.push(`For: ${plan.audience}`)
  plan.items.forEach((it, i) => lines.push(`${i + 1}. ${it.title}${it.detail ? `: ${it.detail}` : ''}${it.design ? ` [design ${it.design}]` : ''}`))
  const answered = (plan.questions ?? []).filter((q) => q.question.trim())
  if (answered.length) {
    lines.push('My answers:')
    for (const q of answered) lines.push(`- ${q.question} ${q.answer?.trim() ? q.answer.trim() : '(no answer: leave a placeholder)'}`)
  }
  return lines
}

/** How the template or look is to be used, for a new file. */
function lookLines(ctx: FileContext, plan?: Plan): string[] {
  const k = KIND_TOOLS[ctx.kind]
  if (ctx.template) {
    if (ctx.kind === 'deck') {
      return [
        `It is made from the ${ctx.template.name} template (id ${ctx.template.id}). Its slides are designed slides whose slots hold the template's sample text. Read it with glance_deck_outline; replace every slot's text with real words for my request, keeping each within the slot's maxChars (glance_templates lists the slots). Add more slides with the same template's designs (glance_deck_edit add with design), repeat a design where it helps, and remove or reorder slides where the request needs it.`
      ]
    }
    return [`It is made from the ${ctx.template.name} template (id ${ctx.template.id}). Read it with ${k.read}, replace all of its sample content with real content for my request, keep each text box within its maxChars, and keep the template's look.`]
  }
  if (plan?.look) return [`Use the look ${plan.look}.`]
  if (ctx.kind === 'deck') return ['Start with a title slide, keep one idea per slide in short phrases, mix the layouts (threeCards, bigNumber, timeline, quote, imageRight and the others) and put detail in the speaker notes. For a polished deck, use a template\'s designed slides (glance_templates).']
  return []
}

/**
 * The message for making a new file, already open in Glance as `ctx.tab`: asking for a plan
 * first, building an approved plan, or building straight away.
 */
export function guideCreate(request: string, ctx: FileContext, opts: CreateOptions = {}): Guided {
  const k = KIND_TOOLS[ctx.kind]
  const asked = request.trim()
  const from = ctx.template ? ` from the ${ctx.template.name} template` : ''
  const head = ctx.kind === 'deck' ? `Make slides for me in Glance${from}: ${asked}` : `Make a ${k.noun} for me in Glance${from}: ${asked}`
  const skills = pickSkills(opts.skills ?? [], ctx.kind, 'create', asked)
  const sk = skillLines(skills, opts.sent ?? new Set())
  const empty = !ctx.template
  const lines = [head, '', `${empty ? `A new, empty ${k.noun}` : `The ${k.noun}`} is open in Glance (tab ${ctx.tab}). ${toolRule(ctx.kind)}`]
  if (opts.planFirst) {
    lines.push(
      `Don't build it yet. First plan it: who it is for, the one thing they should remember, and the ${k.parts} (${ctx.kind === 'deck' ? '6 to 12, a title slide first' : ctx.kind === 'document' ? 'pages or sections in order' : 'each sheet and its columns'}), each with a short title and a line on what goes there${ctx.template ? ' and the template design it uses' : ''}.`,
      `Show the plan with glance_plan (tab ${ctx.tab}), with a look${ctx.kind === 'deck' ? ' (a template id from glance_templates, or a theme)' : ''} and up to three short questions for facts only I know. Then stop and wait: my next message says to build it, with my changes.`
    )
  } else {
    if (opts.plan) lines.push('', ...planLines(opts.plan), '')
    else lines.push(`First plan it: who it is for, the one thing they should remember, and the ${k.parts}.`)
    lines.push(...lookLines(ctx, opts.plan))
    if (opts.density && DENSITY[opts.density]) lines.push(DENSITY[opts.density])
    lines.push(loop(ctx.kind, `the ${k.parts}`))
  }
  lines.push(PLACEHOLDER_RULE)
  if (sk.lines.length) lines.push('', ...sk.lines)
  return { text: lines.join('\n'), skills: sk.given }
}

/** The message for changing the file the person has open, with what they selected. */
export function guideEdit(request: string, ctx: FileContext, opts: GuideOptions = {}): Guided {
  const k = KIND_TOOLS[ctx.kind]
  const skills = pickSkills(opts.skills ?? [], ctx.kind, 'edit', request)
  const sk = skillLines(skills, opts.sent ?? new Set())
  const lines = [
    request.trim(),
    '',
    '<glance-context>',
    ...fileLines(ctx),
    `${toolRule(ctx.kind)} Read the ${k.noun} first for ids, and change only what I asked: keep the rest, the look and the template as they are, and keep text within each slot's maxChars. Make the change in one ${k.edit} call where you can, so I can undo it in one step.`,
    loop(ctx.kind, 'what you changed'),
    PLACEHOLDER_RULE,
    ...sk.lines,
    '</glance-context>'
  ]
  return { text: lines.join('\n'), skills: sk.given }
}

/** One step of what the guide does, for tests and the MCP prompts: which skills this request gets. */
export function skillsFor(skills: Skill[], kind: FileKind, mode: Mode, request: string): string[] {
  return pickSkills(skills, kind, mode, request).map((s) => s.name)
}

/** Reads glance_plan's arguments, or says what is wrong with them. */
export function parsePlan(args: Record<string, unknown>): Plan {
  const kind = args.kind
  if (kind !== 'deck' && kind !== 'document' && kind !== 'spreadsheet') throw new Error('kind must be deck, document or spreadsheet')
  if (!Array.isArray(args.items) || !args.items.length) throw new Error('items must list at least one entry')
  if (args.items.length > 40) throw new Error('items can have at most 40 entries')
  const text = (v: unknown, n: number) => (typeof v === 'string' ? clip(v, n) : undefined)
  const items: PlanItem[] = args.items.map((it, i) => {
    const o = (typeof it === 'string' ? { title: it } : it) as Record<string, unknown>
    const title = text(o?.title, 120)
    if (!title) throw new Error(`items[${i}] needs a title`)
    return { title, ...(text(o.detail, 200) ? { detail: text(o.detail, 200) } : {}), ...(text(o.design, 60) ? { design: text(o.design, 60) } : {}) }
  })
  const questions = Array.isArray(args.questions)
    ? args.questions.slice(0, 5).flatMap((q) => {
      const question = text(typeof q === 'string' ? q : (q as Record<string, unknown>)?.question, 160)
      return question ? [{ question }] : []
    })
    : []
  return {
    kind,
    items,
    ...(text(args.title, 120) ? { title: text(args.title, 120) } : {}),
    ...(text(args.audience, 200) ? { audience: text(args.audience, 200) } : {}),
    ...(text(args.look, 60) ? { look: text(args.look, 60) } : {}),
    ...(questions.length ? { questions } : {})
  }
}

/** MCP prompts (prompts/list): one per kind to create, and one to edit any open file. */
export interface PromptDef {
  name: string
  title: string
  description: string
  arguments: { name: string; description: string; required: boolean }[]
}

/** The text of an MCP prompt, given its arguments; null for an unknown prompt. */
export function promptText(name: string, args: Record<string, string>, skills: Skill[]): string | null {
  const request = (args.request ?? '').trim() || '[what to make]'
  const create = /^create-(deck|document|spreadsheet)$/.exec(name)
  if (create) {
    const kind = create[1] as FileKind
    const k = KIND_TOOLS[kind]
    const picked = pickSkills(skills, kind, 'create', request)
    return [
      `Make a ${k.noun} in Glance: ${request}`,
      '',
      `Use Glance's MCP tools, not files or code: glance_templates to pick a template${args.template ? ` (the person chose ${args.template})` : ''}, glance_create with kind ${kind} to make it, ${k.read} and ${k.edit} to fill and change it.`,
      `Plan it first: who it is for, the one thing they should remember, and the ${k.parts}. Keep text within each slot's maxChars.`,
      loop(kind, `the ${k.parts}`),
      PLACEHOLDER_RULE,
      picked.length ? `Read and follow these skills first: ${picked.map((s) => skillUri(s.name)).join(', ')}.` : ''
    ].filter(Boolean).join('\n')
  }
  if (name === 'edit-file') {
    const path = (args.path ?? '').trim()
    const kind = (['deck', 'document', 'spreadsheet'] as FileKind[]).find((x) => x === args.kind) ?? kindOfPath(path)
    const k = kind ? KIND_TOOLS[kind] : null
    const picked = kind ? pickSkills(skills, kind, 'edit', request) : skills.filter((s) => s.when.includes('edit') && s.kinds === 'any')
    return [
      `${request}`,
      '',
      path ? `The file: ${path}. Open it in Glance with glance_open if it isn't open (glance_list_open lists open tabs).` : 'The file is the one open in Glance (glance_list_open lists open tabs).',
      k ? `Read it with ${k.read} and change it with ${k.edit}.` : 'Use the Glance tools for its kind: glance_deck_* for decks, glance_doc_* for documents, glance_sheet_* for spreadsheets.',
      "Change only what is asked: keep the rest, the look and the template as they are, and keep text within each slot's maxChars. Make the change in one edit call where you can.",
      k ? loop(kind!, 'what you changed') : 'Then run the check tool, render what you changed and fix what looks wrong.',
      PLACEHOLDER_RULE,
      picked.length ? `Read and follow these skills first: ${picked.map((s) => skillUri(s.name)).join(', ')}.` : ''
    ].filter(Boolean).join('\n')
  }
  return null
}

/** The kind of a Glance file from its extension. */
export function kindOfPath(path: string): FileKind | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return ext === 'gdeck' || ext === 'pptx' ? 'deck' : ext === 'gdoc' || ext === 'docx' ? 'document' : ext === 'xlsx' || ext === 'csv' ? 'spreadsheet' : undefined
}
