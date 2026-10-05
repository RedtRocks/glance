/** Word, PowerPoint and Excel files Glance previews itself (see office/render.ts). Kept in sync with src-tauri/src/decode/formats.rs. */
export const WORD = ['docx', 'docm', 'dotx', 'dotm']
export const SLIDES = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm']
export const SHEETS = ['xlsx', 'xlsm', 'xltx', 'xltm', 'csv', 'tsv']
export const OFFICE = [...WORD, ...SLIDES, ...SHEETS]

export type OfficeFlavor = 'word' | 'slides' | 'sheets'

export function officeFlavor(ext: string): OfficeFlavor | null {
  const e = ext.toLowerCase()
  if (WORD.includes(e)) return 'word'
  if (SLIDES.includes(e)) return 'slides'
  if (SHEETS.includes(e)) return 'sheets'
  return null
}
