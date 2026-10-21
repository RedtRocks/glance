/** Spreadsheet templates: each loads only when it's shown or used (src/sheet/templates). */
import { SHEET_TEMPLATES, SHEET_TEMPLATE_ART, SHEET_TEMPLATE_LOADERS } from '../sheet/templates'
import { templateWorkbook } from '../core/sheet/template'
import type { Workbook } from '../core/sheet/model'
import { t } from '../i18n'
import { loadFunctions } from './sheet'

export { SHEET_TEMPLATES }

const cache = new Map<string, Promise<{ wb: Workbook; media: Map<string, Uint8Array> } | null>>()

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A template's workbook, with its sample text in the person's language, and its pictures. */
export function sheetTemplate(id: string): Promise<{ wb: Workbook; media: Map<string, Uint8Array> } | null> {
  let p = cache.get(id)
  if (!p) {
    p = (async () => {
      const load = SHEET_TEMPLATE_LOADERS[id]
      if (!load) return null
      await loadFunctions()
      const [tpl, art] = await Promise.all([load(), SHEET_TEMPLATE_ART[id]?.() ?? {}])
      const media = new Map(Object.entries(art).map(([k, v]) => [k, fromBase64(v)]))
      return { wb: templateWorkbook(tpl, (s) => t(s)), media }
    })().catch(() => null)
    cache.set(id, p)
  }
  return p
}
