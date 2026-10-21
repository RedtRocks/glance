/**
 * "Here's the plan": before the AI builds a new deck, document or spreadsheet, it shows a
 * short plan (glance_plan) on the Outline screen, where the person reorders, renames,
 * deletes and adds items, answers the AI's questions, picks a look and words, then
 * chooses Build. "Just make it" skips the plan.
 */
import { signal } from '@preact/signals'
import { guideCreate, type Density, type FileKind, type Plan } from '../core/ai/guide'
import { msg, t } from '../i18n'
import * as ai from './ai'
import { activeSkills } from './skills'
import { fileContext } from './guideContext'
import { DeckDoc, GDoc, docs, type Doc } from './documents'
import { TEMPLATES, templateDeck } from './templates'
import { THEMES } from '../core/deck/themes'
import { change } from './deck'
import { aiOpen, makeOpen } from './ui'
import { SheetDoc } from './sheetDoc'
import { DOC_BOARDS } from '../doc/designs'
import { setLook } from './gdoc'
import { SHEET_TEMPLATES, sheetTemplate } from './sheetTemplates'

export interface Planning {
  request: string
  kind: FileKind
  /** The new file's tab. */
  tab: string
  /** Waiting for the AI's plan, or showing it. */
  status: 'waiting' | 'ready'
  plan?: Plan
}

export const planning = signal<Planning | null>(null)
/** The request "Change what I asked" takes back to File → New. */
export const lastRequest = signal('')

const tabDoc = (tab: string): Doc | undefined => docs.peek().find((d) => d.id === tab)

/** Asks the AI for a plan for the new file open as `doc`, and shows the Outline screen. */
export async function startPlan(request: string, kind: FileKind, doc: Doc): Promise<void> {
  const ctx = fileContext(doc) ?? { kind, tab: doc.id }
  const skills = await activeSkills()
  const guided = guideCreate(request, ctx, { planFirst: true, skills })
  planning.value = { request, kind, tab: doc.id, status: 'waiting' }
  aiOpen.value = true
  ai.startNewChat()
  await ai.sendWhenReady({ display: request, agent: guided.text, skills: guided.skills })
}

/** The message to send later instead, when the person must sign in first. */
export async function planMessage(request: string, kind: FileKind, doc: Doc): Promise<ai.Outgoing> {
  const ctx = fileContext(doc) ?? { kind, tab: doc.id }
  const guided = guideCreate(request, ctx, { planFirst: true, skills: await activeSkills() })
  planning.value = { request, kind, tab: doc.id, status: 'waiting' }
  return { display: request, agent: guided.text, skills: guided.skills }
}

/** glance_plan: shows the AI's plan for the person to change. */
export function showPlan(plan: Plan, tab: string, request?: string): void {
  const now = planning.peek()
  planning.value = { request: now?.tab === tab ? now.request : (request ?? ''), kind: plan.kind, tab, status: 'ready', plan }
}

/** Puts the look the person picked on a new deck: a template's slides, or a theme. */
async function applyDeckLook(doc: DeckDoc, look: string): Promise<void> {
  const deck = doc.deck.peek()
  const ids = deck.slides.map((s) => s.id)
  if (TEMPLATES.some((t) => t.id === look)) {
    if (deck.slides.length && deck.slides.every((s) => s.design?.startsWith(`${look}.`))) return
    const start = await templateDeck(look)
    if (!start) return
    change(doc, msg('Change Look'), [
      ...(ids.length ? [{ op: 'delete' as const, ids }] : []),
      ...start.slides.map((s) => ({ op: 'add' as const, design: s.design, slots: Object.fromEntries(Object.entries(s.slots).map(([k, v]) => [k, v.value])), notes: s.notes }))
    ])
  } else if (look in THEMES) {
    const designed = deck.slides.filter((s) => s.layout === 'design').map((s) => s.id)
    change(doc, msg('Change Look'), [...(designed.length ? [{ op: 'delete' as const, ids: designed }] : []), { op: 'setTheme', theme: look }])
  }
}

/** Puts a document template's look on a new document. */
async function applyDocLook(doc: GDoc, look: string): Promise<void> {
  if (doc.doc.peek().look === look || !DOC_BOARDS.some((b) => b.id === look)) return
  await setLook(doc, look)
}

/** Starts a new, still empty spreadsheet from the template the person picked. */
async function applySheetLook(doc: SheetDoc, look: string): Promise<void> {
  if (!SHEET_TEMPLATES.some((x) => x.id === look)) return
  if (doc.wb.peek().sheets.some((s) => Object.keys(s.cells).length)) return
  const start = await sheetTemplate(look)
  if (start) doc.replace(msg('Change Look'), start.wb, start.media)
}

/** Build: sends the plan as the person left it. */
export async function buildPlan(plan: Plan, density: Density): Promise<void> {
  const p = planning.peek()
  if (!p) return
  const doc = tabDoc(p.tab)
  if (doc instanceof DeckDoc && plan.look) await applyDeckLook(doc, plan.look)
  if (doc instanceof GDoc && plan.look) await applyDocLook(doc, plan.look)
  if (doc instanceof SheetDoc && plan.look) await applySheetLook(doc, plan.look)
  const ctx = (doc && fileContext(doc)) ?? { kind: p.kind, tab: p.tab }
  const guided = guideCreate(p.request, ctx, { plan, density, skills: await activeSkills(), sent: ai.sentSkills() })
  planning.value = null
  aiOpen.value = true
  await ai.sendWhenReady({ display: t('Build it'), agent: guided.text, skills: guided.skills })
}

/** "Just make it": builds without the plan step. */
export async function skipPlan(): Promise<void> {
  const p = planning.peek()
  if (!p) return
  const doc = tabDoc(p.tab)
  const ctx = (doc && fileContext(doc)) ?? { kind: p.kind, tab: p.tab }
  const guided = guideCreate(p.request, ctx, { skills: await activeSkills(), sent: ai.sentSkills() })
  planning.value = null
  await ai.sendWhenReady({ display: t('Just make it'), agent: guided.text, skills: guided.skills })
}

/** "Change what I asked": back to File → New with the request. */
export function changeRequest(): void {
  lastRequest.value = planning.peek()?.request ?? ''
  planning.value = null
  void ai.stop()
  makeOpen.value = true
}
