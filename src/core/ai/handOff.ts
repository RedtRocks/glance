/**
 * Handing off: when Glance can't make something itself, it gives the job to the AI
 * company's own agent (the one the Ask AI sidebar runs), which writes the result into a
 * folder Glance picks, and Glance opens it in a new tab.
 *
 * The messages here are read by the AI, so they are English.
 */

/** The line the in-app AI ends its answer with when the rest of a request is beyond Glance's tools. */
export const HAND_OFF_MARK = '[[glance:hand-off]]'

/** Added to every guided request, so the AI says when it reaches the limit of Glance's tools. */
export const HAND_OFF_RULE = `If part of my request is something Glance's tools can't make (another kind of file or format, or anything the tools don't offer), do the part you can, then end your answer with one line: ${HAND_OFF_MARK} followed by what is still to be made, written as a request. Glance then asks for it to be made outside its tools.`

/** What is left to make, when the AI's answer ends with the hand-off line. */
export function findHandOff(text: string): string | null {
  const i = text.lastIndexOf(HAND_OFF_MARK)
  if (i < 0) return null
  const rest = text.slice(i + HAND_OFF_MARK.length).split('\n')[0].trim()
  return rest || null
}

/** The answer as the person sees it, without the hand-off line. */
export function withoutHandOff(text: string): string {
  const i = text.lastIndexOf(HAND_OFF_MARK)
  if (i < 0) return text
  const end = text.indexOf('\n', i)
  return (text.slice(0, i) + (end < 0 ? '' : text.slice(end + 1))).trimEnd()
}

/**
 * Kinds of file Glance can't make. Glance makes decks, documents, spreadsheets and PDFs; a
 * request whose object is one of these is handed off. Only the thing asked for counts, so
 * "a deck about our video plans" stays with Glance.
 */
const BEYOND: { label: string; words: string }[] = [
  { label: 'video', words: 'video|movie|mp4|mov|webm|animation' }, // i18n-ignore: an id, not shown
  { label: 'audio', words: 'audio|podcast|voice-?over|mp3|wav' }, // i18n-ignore: an id, not shown
  { label: 'animated GIF', words: 'gif|animated gif' }, // i18n-ignore: an id, not shown
  { label: 'web page', words: 'website|web ?page|html(?: page| file)?' }, // i18n-ignore: an id, not shown
  { label: 'vector drawing', words: 'svg|vector(?: drawing| file)?' }, // i18n-ignore: an id, not shown
  { label: '3D model', words: '3d model|stl|glb' }, // i18n-ignore: an id, not shown
  { label: 'e-book', words: 'epub|e-?book' } // i18n-ignore: an id, not shown
]

const ASK = String.raw`\b(?:make|create|generate|render|produce|build|export(?: it| this)?(?: as| to)?|turn (?:it|this|that|them) into|convert (?:it|this|that|them) (?:to|into)|save (?:it|this) as)\s+(?:me\s+)?(?:(?:a|an|the|into)\s+)?(?:(?:short|quick|little|small|simple|new)\s+)?(?:\.)?`

/** The kind of file a request asks for that Glance can't make, or null when Glance can. */
export function beyondGlance(request: string): string | null {
  for (const b of BEYOND) if (new RegExp(`${ASK}(?:${b.words})\\b`, 'i').test(request)) return b.label
  return null
}

export interface HandOffFile {
  path: string
  /** Glance made it in this session (true), or the person opened it (false). */
  made: boolean
}

/** The message the company's agent gets for a handed-off job. */
export function handOffPrompt(request: string, files: HandOffFile[], outDir: string): string {
  const lines = [request.trim(), '', '<glance-hand-off>', "Glance, the file viewer I'm using, can't do this itself and is handing it to you."]
  if (files.length) {
    lines.push('Work from these files. Read them, but don\'t change, move or delete them:')
    for (const f of files) lines.push(`- ${f.path}`)
  }
  lines.push(
    `Save what you make as a finished file (or files) in this folder, which Glance made for this job: ${outDir}`,
    "Give the file a clear name that says what it is, in the format I asked for (or the input's format if I didn't say). Don't write anywhere else, and don't leave scripts or scratch files in that folder: put working files in a subfolder named .work.",
    'Glance opens the new file for me when you finish. End by telling me in a sentence or two what you made.',
    '</glance-hand-off>'
  )
  return lines.join('\n')
}

/** A folder name for one hand-off, sortable and safe on every system. */
export function handOffFolderName(now: Date, salt: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}`
  return `${stamp} ${salt.replace(/[^a-z0-9]/gi, '').slice(0, 6)}`.trim()
}

export interface FoundFile {
  path: string
  name: string
  size: number
  modified: number
}

/** Names of partial downloads, editor locks and scratch files, which are never the result. */
const SCRATCH = /^(\.|~\$)|\.(tmp|temp|part|crdownload|download|lock|log|py|js|sh|ps1|bat)$/i

/** The files the agent made, best first: finished, non-empty, newest first. */
export function resultFiles(found: FoundFile[]): FoundFile[] {
  return found.filter((f) => f.size > 0 && !SCRATCH.test(f.name) && !/[\\/]\.work[\\/]/.test(f.path)).sort((a, b) => b.modified - a.modified)
}

/** The name the result tab shows a file by, with the company in brackets when it isn't already there. */
export function madeByName(name: string, company: string): string {
  if (name.toLowerCase().includes(company.toLowerCase())) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${company})${name.slice(dot)}` : `${name} (${company})`
}

/** Sites whose new-chat address takes a pre-filled prompt, by host. */
const PREFILL: Record<string, (q: string) => string> = {
  'claude.ai': (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
  'chatgpt.com': (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
  'chat.mistral.ai': (q) => `https://chat.mistral.ai/chat?q=${encodeURIComponent(q)}`,
  'www.perplexity.ai': (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`
}

/** Pre-fill addresses get long; sites refuse very long ones. */
const MAX_PROMPT = 1500

/** The website's new-chat address with `prompt` in its box, or null when the site has no such address. */
export function prefilledUrl(website: string | undefined, prompt: string): string | null {
  const host = siteHost(website)
  const make = host ? PREFILL[host] : undefined
  const q = prompt.trim().slice(0, MAX_PROMPT)
  return make && q ? make(q) : null
}

/** "claude.ai" from "https://claude.ai/new"; empty for anything that isn't a web address. */
export function siteHost(url: string | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname : ''
  } catch {
    return ''
  }
}
