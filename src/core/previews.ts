/**
 * Files Glance shows as a read-only preview drawn in HTML (see preview/render.ts):
 * Office files, text and code, Markdown, video and audio, e-books, fonts and email.
 * Kept in sync with PREVIEWS in src-tauri/src/decode/formats.rs.
 */
export const WORD = ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot']
export const SLIDES = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm', 'ppt', 'pps', 'pot']
export const SHEETS = ['xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlt', 'csv', 'tsv']
export const MARKDOWN = ['md', 'markdown', 'mdown', 'mkd']
export const TEXT = [
  'txt', 'text', 'log', 'nfo', 'ini', 'cfg', 'conf', 'env', 'properties', 'toml', 'yaml', 'yml', 'json', 'jsonc', 'json5', 'xml', 'plist',
  'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'py', 'rb', 'php', 'pl', 'go', 'rs', 'java',
  'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs', 'fs', 'vb', 'lua', 'r', 'dart', 'scala', 'sh', 'bash', 'zsh', 'fish',
  'ps1', 'psm1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'tex', 'bib', 'srt', 'vtt', 'diff', 'patch', 'gitignore', 'dockerfile', 'makefile', 'cmake', 'gradle'
]
export const VIDEO = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']
export const AUDIO = ['mp3', 'm4a', 'aac', 'wav', 'oga', 'ogg', 'opus', 'flac', 'weba']
export const EBOOKS = ['epub']
export const FONTS = ['ttf', 'otf', 'woff', 'woff2']
export const EMAIL = ['eml', 'msg']

export const PREVIEWS = [...WORD, ...SLIDES, ...SHEETS, ...MARKDOWN, ...TEXT, ...VIDEO, ...AUDIO, ...EBOOKS, ...FONTS, ...EMAIL]

export type PreviewFlavor = 'word' | 'slides' | 'sheets' | 'markdown' | 'text' | 'video' | 'audio' | 'ebook' | 'font' | 'email'

const BY_FLAVOR: [PreviewFlavor, string[]][] = [
  ['word', WORD], ['slides', SLIDES], ['sheets', SHEETS], ['markdown', MARKDOWN], ['text', TEXT],
  ['video', VIDEO], ['audio', AUDIO], ['ebook', EBOOKS], ['font', FONTS], ['email', EMAIL]
]

/** Extension of a file name, lowercased; "Dockerfile" and "Makefile" count as their own. */
export function previewExt(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const m = /\.([^.]+)$/.exec(base)
  return (m ? m[1] : base).toLowerCase()
}

export function previewFlavor(ext: string): PreviewFlavor | null {
  const e = ext.toLowerCase()
  return BY_FLAVOR.find(([, list]) => list.includes(e))?.[0] ?? null
}
