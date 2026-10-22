/** glance_plan: the AI's plan for a new file, shown on the Outline screen (state/plan.ts). */
import { ToolError, type ToolHandler } from '../core/mcp/protocol'
import { parsePlan } from '../core/ai/guide'
import * as platform from '../platform'
import { activeDoc, docs } from './documents'
import { showPlan } from './plan'

const plan: ToolHandler = async (args) => {
  const doc = typeof args.tab === 'string' && args.tab ? docs.peek().find((d) => d.id === args.tab || d.path.peek() === args.tab) : activeDoc.peek()
  if (!doc) throw new ToolError(`no open tab ${String(args.tab ?? '')}; glance_list_open lists them`)
  let p
  try {
    p = parsePlan(args)
  } catch (e) {
    throw new ToolError((e as Error).message)
  }
  showPlan(p, doc.id)
  await platform.showForAi()
  return 'The plan is on Glance\'s Outline screen. Stop here and wait: the user\'s next message says to build it (with their changes) or what to change.'
}

export const planHandlers: Record<string, ToolHandler> = { glance_plan: plan }
