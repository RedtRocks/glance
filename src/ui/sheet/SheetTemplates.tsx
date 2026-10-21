/** File → New: the spreadsheet templates, by purpose, with a preview of every sheet. */
import { useEffect, useRef, useState } from 'preact/hooks'
import { SHEET_TEMPLATES, sheetTemplate } from '../../state/sheetTemplates'
import { PURPOSES, type Purpose } from '../../core/deck/design'
import type { SheetTemplateInfo } from '../../core/sheet/template'
import { purposeLabel } from '../deck/labels'
import { t } from '../../i18n'
import { Icon } from '../Icon'

/** Pictures of a template's sheets as object URLs, drawn once loaded. */
function useSheetPictures(id: string, scale: number, all: boolean): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    let live = true
    const made: string[] = []
    void (async () => {
      const tpl = await sheetTemplate(id)
      if (!tpl) return
      const { sheetPng } = await import('../../sheet/picture')
      const sheets = tpl.wb.sheets.filter((s) => !s.hidden)
      for (const s of all ? sheets : sheets.slice(0, 1)) {
        const png = await sheetPng(tpl.wb, s, tpl.media, scale)
        if (!live) return
        made.push(URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })))
        setUrls([...made])
      }
    })()
    return () => {
      live = false
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [id])
  return urls
}

export function SheetTemplates({ canAsk, onUse, onAbout }: { canAsk: boolean; onUse: (tpl: SheetTemplateInfo) => void; onAbout: (tpl: SheetTemplateInfo, about: string) => void }) {
  const [tab, setTab] = useState<Purpose | 'All'>('All')
  const [preview, setPreview] = useState<SheetTemplateInfo | null>(null)
  return (
    <>
      <h2 class="make-templates-title">{t('Spreadsheets')}</h2>
      <div class="make-tabs" role="tablist" aria-label={t('Spreadsheet templates for')}>
        {(['All', ...PURPOSES] as const).map((p) => (
          <button key={p} role="tab" aria-selected={tab === p} class={`make-tab${tab === p ? ' on' : ''}`} onClick={() => setTab(p)}>
            {purposeLabel(p)}
          </button>
        ))}
      </div>
      <div class="make-templates" role="tabpanel">
        {SHEET_TEMPLATES.filter((x) => tab === 'All' || x.purpose === tab).map((x) => (
          <SheetTile key={x.id} tpl={x} onPick={() => setPreview(x)} />
        ))}
      </div>
      {preview && <SheetPreview tpl={preview} canAsk={canAsk} onClose={() => setPreview(null)} onUse={() => onUse(preview)} onAbout={(about) => onAbout(preview, about)} />}
    </>
  )
}

function SheetTile({ tpl, onPick }: { tpl: SheetTemplateInfo; onPick: () => void }) {
  const [first] = useSheetPictures(tpl.id, 0.5, false)
  return (
    <button class="make-template" onClick={onPick}>
      {first ? <img class="sheet-thumb" src={first} alt="" /> : <span class="make-template-empty" />}
      <span class="make-kind-name">{t(tpl.name)}</span>
      <span class="make-kind-sub">{t(tpl.blurb)}</span>
    </button>
  )
}

function SheetPreview({ tpl, canAsk, onClose, onUse, onAbout }: { tpl: SheetTemplateInfo; canAsk: boolean; onClose: () => void; onUse: () => void; onAbout: (about: string) => void }) {
  const pictures = useSheetPictures(tpl.id, 1, true)
  const [about, setAbout] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])
  return (
    <div class="make-preview" role="dialog" aria-modal="true" aria-label={t(tpl.name)}>
      <div class="make-preview-head">
        <button class="icon-button" aria-label={t('Back to templates')} title={t('Back to templates')} onClick={onClose}>
          <Icon name="left" size={16} />
        </button>
        <div>
          <h2>{t(tpl.name)}</h2>
          <p>{t('{look} · {count, plural, one {# sheet} other {# sheets}} · {blurb}', { look: t(tpl.look), count: tpl.sheets.length, blurb: t(tpl.blurb) })}</p>
        </div>
      </div>
      <div class="make-preview-slides sheet-preview-pages">
        {pictures.map((u) => (
          <img key={u} class="sheet-preview-page" src={u} alt="" />
        ))}
      </div>
      <div class="make-preview-actions">
        <button class="btn" onClick={onUse}>
          {t('Use as it is')}
        </button>
        {canAsk && (
          <form
            class="make-ask make-about"
            onSubmit={(e) => {
              e.preventDefault()
              if (about.trim()) onAbout(about)
            }}
          >
            <input ref={field} value={about} onInput={(e) => setAbout(e.currentTarget.value)} aria-label={t('Make it about…')} placeholder={t('Make it about…, like “our summer fair”')} />
            <button type="submit" class="make-go" disabled={!about.trim()}>
              <Icon name="sparkle" size={16} /> {t('Make it')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
