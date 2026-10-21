/**
 * "What do you want to make?": turning the person's request into a name for the new file
 * and the first message to the AI, which fills the new deck with Glance's deck tools.
 * The message is read by the AI, so it is English; the AI answers in the person's language.
 * The messages themselves are written by guide.ts, which also shapes later edits.
 */
import { guideCreate } from './guide'
import type { Skill } from './skills'

/** A file name from the request: its first few words, without characters Windows refuses. */
export function nameFromRequest(request: string, fallback: string): string {
  const words = request.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  const name = words.length > 48 ? words.slice(0, 48).trimEnd() : words
  return name ? name[0].toUpperCase() + name.slice(1) : fallback
}

/** The first message for a new deck, already open in Glance as `tab`, built straight away. */
export function deckPrompt(request: string, tab: string, skills: Skill[] = []): string {
  return guideCreate(request, { kind: 'deck', tab }, { skills }).text
}

/** The first message for a deck started from a template, open in Glance as `tab`. */
export function templatePrompt(request: string, template: string, tab: string, id = template, skills: Skill[] = []): string {
  return guideCreate(request, { kind: 'deck', tab, template: { id, name: template } }, { skills }).text
}

/** The first message for a new document, open in Glance as `tab` in a look's plain pages. */
export function docPrompt(request: string, tab: string): string {
  return [
    `Write a document for me in Glance: ${request.trim()}`,
    '',
    `A new document is open in Glance (tab ${tab}). Read it with glance_doc_outline and fill it with glance_doc_edit; don't write files, code or a .docx yourself.`,
    'First plan it: who it is for, what they should take away, and its headings. Write real paragraphs, lists and tables as blocks; the look decides fonts and colours, so name its styles rather than describing formatting. Pick a better look with setLook if another fits the request (glance_templates lists them).',
    'Then call glance_doc_check and fix every finding, look at the pages with glance_doc_render and fix anything that looks wrong, and finish by telling me in a sentence or two what you made.',
    "If you don't have facts you need, use clear placeholders like [date] rather than inventing them."
  ].join('\n')
}

/** The first message for a document started from a template, open in Glance as `tab`. */
export function docTemplatePrompt(request: string, template: string, tab: string): string {
  return [
    `Make a document for me in Glance from the ${template} template: ${request.trim()}`,
    '',
    `The template is open in Glance (tab ${tab}). Read it with glance_doc_outline and change it with glance_doc_edit; don't write files, code or a .docx yourself.`,
    "Its pages hold the template's sample text. On fixed pages, set every text box (setText) and table row with real words for my request, keeping each box within its maxChars. On flowing pages, replace the sample blocks with my content, using the look's styles. Add pages with the template's designs (addSection) where the request needs more.",
    'Then call glance_doc_check and fix every finding, look at the pages with glance_doc_render and fix anything that looks wrong, and finish by telling me in a sentence or two what you made.',
    "If you don't have facts you need, leave a clear placeholder like [date] rather than inventing them, and don't leave the template's sample names, dates or numbers in."
  ].join('\n')
}

/** The first message for a new, empty spreadsheet, open in Glance as `tab`. */
export function sheetPrompt(request: string, tab: string): string {
  return [
    `Make a spreadsheet for me in Glance: ${request.trim()}`,
    '',
    `A new, empty workbook is open in Glance (tab ${tab}). Build it with glance_sheet_edit; don't write files, code or an .xlsx yourself.`,
    'First plan it: the sheets, the columns of each table and which figures are worked out. Put headers in the first row of each table, freeze them, type numbers as numbers with a number format, and use formulas (SUM, SUMIF, AVERAGE and so on) for every total, so it stays right when I change the data. Add drop-downs and tick boxes where I would pick from a list, and a chart where a picture helps.',
    'Then call glance_sheet_check and fix every finding, look at it with glance_sheet_render and fix anything that looks wrong, and finish by telling me in a sentence or two what you made.',
    "If you don't have facts you need, use clear placeholders like [amount] rather than inventing them."
  ].join('\n')
}

/** The first message for a spreadsheet started from a template, open in Glance as `tab`. */
export function sheetTemplatePrompt(request: string, template: string, tab: string): string {
  return [
    `Make a spreadsheet for me in Glance from the ${template} template: ${request.trim()}`,
    '',
    `The template is open in Glance (tab ${tab}). Read it with glance_sheet_read and change it with glance_sheet_edit; don't write files, code or an .xlsx yourself.`,
    "Its cells hold sample data. Replace the sample names, items, dates and amounts with ones for my request, keep its formulas, formats, drop-downs and charts working (change data cells, not the formula cells), and add or remove rows inside its tables where the request needs it so the totals still cover them.",
    'Then call glance_sheet_check and fix every finding, look at it with glance_sheet_render and fix anything that looks wrong, and finish by telling me in a sentence or two what you made.',
    "If you don't have facts you need, leave a clear placeholder like [amount] rather than inventing them, and don't leave the template's sample names in."
  ].join('\n')
}
