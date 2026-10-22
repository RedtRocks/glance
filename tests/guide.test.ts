import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { charCount, findPlaceholders, guideCreate, guideEdit, parsePlan, placeholderRuns, promptText, validationHint, type FileContext } from '../src/core/ai/guide'
import { parseSkill, pickSkills, skillFile, parseSkillUri, type Skill } from '../src/core/ai/skills'
import { guidance, PROMPTS } from '../src/core/mcp/guidance'
import { McpServer } from '../src/core/mcp/protocol'
import { deckContext, placeholderSpots } from '../src/core/ai/deckContext'
import { templatePrompt, deckPrompt } from '../src/core/ai/make'
import type { Deck } from '../src/core/deck/model'

const root = join(__dirname, '../src/skills')
const skills: Skill[] = readdirSync(root).map((name) => {
  const dir = join(root, name)
  const files: Record<string, string> = {}
  try {
    for (const f of readdirSync(join(dir, 'examples'))) files[`examples/${f}`] = readFileSync(join(dir, 'examples', f), 'utf8')
  } catch {
    // no examples
  }
  return parseSkill(readFileSync(join(dir, 'SKILL.md'), 'utf8'), 'app', files)!
})

const deckCtx: FileContext = {
  kind: 'deck',
  tab: 'doc4',
  name: 'Bake sale.gdeck',
  template: { id: 'bakeSale', name: 'Bake Sale', look: 'Confetti' },
  count: 7,
  selection: { kind: 'deck', slides: [{ id: 's3', number: 3, layout: 'design', design: 'bakeSale.3', role: 'Three ways', slots: [{ name: 'title', text: 'Three Ways to Help', maxChars: 24 }] }] },
  placeholders: ['[date]']
}

describe('skills', () => {
  it('every bundled skill parses with a name, kinds and when', () => {
    expect(skills.map((s) => s.name).sort()).toEqual(['document-writing', 'editing', 'slide-design', 'spreadsheet-building'])
    expect(skills.find((s) => s.name === 'slide-design')!.kinds).toEqual(['deck'])
    expect(skills.find((s) => s.name === 'editing')!.when).toEqual(['edit'])
    expect(skills.find((s) => s.name === 'slide-design')!.files).toHaveProperty(['examples/bake-sale-plan.md'])
  })

  it('refuses files without a usable name or description', () => {
    expect(parseSkill('# no frontmatter', 'user')).toBeNull()
    expect(parseSkill('---\nname: Bad Name\ndescription: x\n---\n', 'user')).toBeNull()
    expect(parseSkill('---\nname: ok\n---\n', 'user')).toBeNull()
  })

  it('picks by kind, mode and keywords, the person\'s own first', () => {
    const cv = parseSkill('---\nname: cv\ndescription: CVs\nmetadata:\n  kinds: document\n  keywords: cv, resume\n---\nbody', 'user')!
    const all = [...skills, cv]
    expect(pickSkills(all, 'deck', 'create', 'a talk').map((s) => s.name)).toEqual(['slide-design'])
    expect(pickSkills(all, 'deck', 'edit', 'shorter').map((s) => s.name)).toEqual(['slide-design', 'editing'])
    expect(pickSkills(all, 'document', 'create', 'my CV please').map((s) => s.name)).toEqual(['cv', 'document-writing'])
    expect(pickSkills(all, 'document', 'create', 'a letter').map((s) => s.name)).toEqual(['document-writing'])
    expect(pickSkills(all, 'spreadsheet', 'create', 'budget').map((s) => s.name)).toEqual(['spreadsheet-building'])
  })

  it('writes a skill back as SKILL.md and reads skill addresses', () => {
    const s = skills.find((x) => x.name === 'editing')!
    const again = parseSkill(skillFile(s, 'glance-editing'), 'app')!
    expect(again.name).toBe('glance-editing')
    expect(again.body).toBe(s.body)
    expect(parseSkillUri('skill://glance/editing/SKILL.md')).toEqual({ name: 'editing', file: 'SKILL.md' })
    expect(parseSkillUri('skill://glance/editing/../x')).toBeNull()
  })
})

describe('guided requests', () => {
  it('shapes a deck edit with the selection, limits, tools, loop and skills', () => {
    const g = guideEdit('make this punchier', deckCtx, { skills })
    expect(g.text.startsWith('make this punchier')).toBe(true)
    for (const s of ['tab doc4', 'Slide 3 (id s3, design bakeSale.3, Three ways)', 'title, maxChars 24: "Three Ways to Help"', 'Bake Sale (id bakeSale', 'glance_deck_edit', 'glance_deck_check', 'glance_deck_render', '[date]', 'never leave a template', '<skill name="slide-design">', '<skill name="editing">']) expect(g.text).toContain(s)
    expect(g.skills).toEqual(['slide-design', 'editing'])
    // Skills the chat already has are only named.
    const again = guideEdit('and slide 4', deckCtx, { skills, sent: new Set(g.skills) })
    expect(again.text).not.toContain('<skill')
    expect(again.text).toContain('Follow the slide-design, editing skills given earlier.')
    expect(again.skills).toEqual([])
  })

  it('shapes document and spreadsheet edits with their own tools and selection', () => {
    const doc = guideEdit('friendlier', { kind: 'document', tab: 'd1', selection: { kind: 'document', page: 2, blocks: [{ id: 'b7', type: 'paragraph', text: 'Dear Sir' }] } }, { skills })
    for (const s of ['Page 2', 'Block b7 (paragraph): "Dear Sir"', 'glance_doc_edit', 'glance_doc_check', 'glance_doc_render', '<skill name="document-writing">']) expect(doc.text).toContain(s)
    const sheet = guideEdit('chart this column', { kind: 'spreadsheet', tab: 'x1', selection: { kind: 'spreadsheet', sheet: 'Budget', range: 'D5:D7', values: [[10], [20], [30]], formulas: [[null], [null], ['=D5+D6']], validation: ['D5:D7: ' + validationHint({ type: 'decimal', min: 0 })] } }, { skills })
    for (const s of ['Sheet "Budget", range D5:D7', '30 (=D5+D6)', 'a number of at least 0', 'glance_sheet_read', 'glance_sheet_edit', '<skill name="spreadsheet-building">']) expect(sheet.text).toContain(s)
  })

  it('asks for a plan first, then builds the approved plan', () => {
    const ask = guideCreate('slides about our bake sale', { kind: 'deck', tab: 'doc9' }, { planFirst: true, skills })
    expect(ask.text).toContain('Make slides for me in Glance: slides about our bake sale')
    expect(ask.text).toContain("Don't build it yet")
    expect(ask.text).toContain('glance_plan (tab doc9)')
    expect(ask.text).not.toContain('Then call glance_deck_check')
    const plan = parsePlan({ kind: 'deck', items: [{ title: 'Cover', detail: 'date' }, 'Thanks'], look: 'bakeSale', questions: ['When is it?', 'Where?'] })
    plan.questions![0].answer = 'Sat 13 March'
    const build = guideCreate('slides about our bake sale', { kind: 'deck', tab: 'doc9' }, { plan, density: 'few', skills, sent: new Set(ask.skills) })
    for (const s of ['2 slides', '1. Cover: date', '2. Thanks', 'When is it? Sat 13 March', 'Where? (no answer: leave a placeholder)', 'Use the look bakeSale', 'Words: few', 'glance_deck_check']) expect(build.text).toContain(s)
    expect(build.skills).toEqual([])
  })

  it('makes documents and spreadsheets with their own words', () => {
    const d = guideCreate('a cover letter', { kind: 'document', tab: 't', template: { id: 'jobPack', name: 'Job Pack' } }, { skills })
    expect(d.text).toContain('Make a document for me in Glance from the Job Pack template: a cover letter')
    expect(d.text).toContain('glance_doc_outline')
    const s = guideCreate('a trip budget', { kind: 'spreadsheet', tab: 't' }, { planFirst: true })
    expect(s.text).toContain('each sheet and its columns')
  })

  it('keeps the make prompts', () => {
    expect(deckPrompt('a talk on bees', 'doc7')).toContain('Make slides for me in Glance: a talk on bees')
    const p = templatePrompt('our school fair', 'Event Plan', 'doc3', 'eventPlan')
    for (const s of ['from the Event Plan template: our school fair', 'id eventPlan', 'add with design', 'glance_deck_outline', 'maxChars']) expect(p).toContain(s)
  })

  it('refuses a plan it can\'t show', () => {
    expect(() => parsePlan({ kind: 'poster', items: ['a'] })).toThrow(/kind/)
    expect(() => parsePlan({ kind: 'deck', items: [] })).toThrow(/items/)
    expect(() => parsePlan({ kind: 'deck', items: [{ detail: 'x' }] })).toThrow(/items\[0\]/)
  })
})

describe('placeholders and limits', () => {
  it('finds and splits placeholders', () => {
    expect(findPlaceholders('On [date] at [venue], [date] again')).toEqual(['[date]', '[venue]'])
    expect(placeholderRuns('Hi [name]!')).toEqual([{ text: 'Hi ', placeholder: false }, { text: '[name]', placeholder: true }, { text: '!', placeholder: false }])
  })

  it('counts characters against a slot\'s limit', () => {
    expect(charCount('abc', undefined)).toBeNull()
    expect(charCount('abcdef', 5)).toMatchObject({ used: 6, over: true })
    expect(charCount('ab\nabcd', 5, true)).toMatchObject({ used: 4, over: false, near: false })
  })

  it('describes validation rules', () => {
    expect(validationHint({ type: 'list', values: ['Yes', 'No'] })).toBe('one of: Yes, No')
    expect(validationHint({ type: 'checkbox' })).toBe('a tick box (TRUE or FALSE)')
    expect(validationHint({ type: 'date', min: '2026-01-01', max: '2026-12-31' })).toBe('a date from 2026-01-01 to 2026-12-31')
  })

  it('describes an open deck and where its placeholders are', () => {
    const deck: Deck = { version: 1, theme: 'sunrise', slides: [
      { id: 's1', layout: 'title', slots: { title: { kind: 'text', value: 'Fair on [date]' } }, notes: '', hidden: false },
      { id: 's2', layout: 'bullets', slots: { title: { kind: 'text', value: 'Jobs' }, bullets: { kind: 'list', value: ['Cakes', '[name] runs the till'] } }, notes: 'Thank [sponsor]', hidden: false }
    ] }
    const ctx = deckContext(deck, { tab: 'doc1', selected: [], current: 1 }, () => undefined, () => undefined)
    expect(ctx.look).toBe('theme sunrise')
    expect(ctx.selection).toMatchObject({ kind: 'deck', slides: [{ id: 's2', number: 2, slots: [{ name: 'title', maxChars: 60 }, { name: 'bullets', text: 'Cakes\n[name] runs the till', maxChars: 70 }] }] })
    expect(ctx.placeholders).toEqual(['[date]', '[name]', '[sponsor]'])
    expect(placeholderSpots(deck)).toEqual([{ id: 's1', slot: 'title', placeholder: '[date]' }, { id: 's2', slot: 'bullets', placeholder: '[name]' }, { id: 's2', slot: 'notes', placeholder: '[sponsor]' }])
  })
})

describe('MCP prompts and resources', () => {
  const server = new McpServer({ name: 'glance', version: '1' }, [], {}, () => null, guidance(async () => skills))
  const call = (method: string, params: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<{ result?: Record<string, unknown>; error?: { message: string } }>

  it('advertises and lists the prompts and each skill', async () => {
    const init = await call('initialize')
    expect(init.result!.capabilities).toMatchObject({ prompts: {}, resources: {} })
    expect(((await call('prompts/list')).result!.prompts as { name: string }[]).map((p) => p.name)).toEqual(['create-deck', 'create-document', 'create-spreadsheet', 'edit-file'])
    const uris = ((await call('resources/list')).result!.resources as { uri: string }[]).map((r) => r.uri)
    expect(uris).toContain('skill://glance/slide-design/SKILL.md')
    expect(uris).toContain('skill://glance/slide-design/examples/bake-sale-plan.md')
    expect(uris).toContain('skill://glance/editing/SKILL.md')
  })

  it('reads a skill and fills a prompt', async () => {
    const read = await call('resources/read', { uri: 'skill://glance/editing/SKILL.md' })
    expect(JSON.stringify(read.result)).toContain('Change only what was asked')
    expect((await call('resources/read', { uri: 'skill://glance/nope/SKILL.md' })).error).toBeTruthy()
    const p = await call('prompts/get', { name: 'create-spreadsheet', arguments: { request: 'a grade book' } })
    const text = JSON.stringify(p.result)
    for (const s of ['a grade book', 'glance_create with kind spreadsheet', 'skill://glance/spreadsheet-building/SKILL.md', '[date]']) expect(text).toContain(s)
    expect((await call('prompts/get', { name: 'create-deck', arguments: {} })).error!.message).toContain('request')
    expect(promptText('edit-file', { request: 'shorter', path: 'C:\\a\\b.gdeck' }, skills)).toContain('glance_deck_outline')
  })

  it('every prompt has a text', () => {
    for (const p of PROMPTS) expect(promptText(p.name, { request: 'x' }, skills)).toBeTruthy()
  })
})
