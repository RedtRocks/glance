import { useEffect, useMemo, useState } from 'preact/hooks'
import { SENSITIVE_PATTERNS, canvasMeasure, findMatches, termRegex, type TextItem } from '../../core/findText'
import { newId } from '../../core/markup'
import type { PdfDoc } from '../../state/documents'
import { redactTextOpen, toast } from '../../state/ui'
import { Modal } from './Dialog'
import { t } from '../../i18n'

interface Found {
  key: string
  page: number
  text: string
  rects: [number, number, number, number][]
}

/** Every page's text items, fetched once per dialog. */
function usePageText(doc: PdfDoc): TextItem[][] | null {
  const [pages, setPages] = useState<TextItem[][] | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const proxy = doc.proxy.peek()
      if (!proxy) return
      const out: TextItem[][] = []
      for (let i = 1; i <= proxy.numPages; i++) {
        const content = await (await proxy.getPage(i)).getTextContent()
        const items = content.items.filter((it) => 'str' in it) as unknown as (TextItem & { fontName: string })[]
        out.push(items.map((it) => ({ ...it, fontFamily: content.styles[it.fontName]?.fontFamily })))
        if (cancelled) return
      }
      setPages(out)
    })()
    return () => {
      cancelled = true
    }
  }, [doc])
  return pages
}

/** Search-and-redact: marks every occurrence of a term or kind of personal data. */
export function RedactTextDialog({ doc }: { doc: PdfDoc }) {
  const pages = usePageText(doc)
  const [term, setTerm] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(true)
  const [kinds, setKinds] = useState<string[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const close = (): void => void (redactTextOpen.value = false)

  const measure = useMemo(() => canvasMeasure(new OffscreenCanvas(1, 1).getContext('2d')!), [])
  const found = useMemo<Found[]>(() => {
    if (!pages) return []
    const res = [termRegex(term, matchCase, wholeWord), ...SENSITIVE_PATTERNS.filter((p) => kinds.includes(p.id)).map((p) => p.re)].filter(
      (r): r is RegExp => !!r
    )
    if (!res.length) return []
    return pages.flatMap((items, page) =>
      findMatches(items, res, measure).map((m, k) => ({ key: `${page}:${k}:${m.text}`, page, text: m.text, rects: m.rects }))
    )
  }, [pages, term, matchCase, wholeWord, kinds, measure])
  const chosen = found.filter((f) => !skipped.has(f.key))

  const mark = (): void => {
    const reds = chosen.flatMap((f) => f.rects.map((rect) => ({ id: newId('redact'), page: f.page, rect })))
    doc.edit('Mark Text for Redaction', { redactions: [...doc.redactions.peek(), ...reds] })
    toast(t('{count, plural, one {# match marked.} other {# matches marked.}} Review, then Apply Redactions.', { count: chosen.length }))
    const first = Math.min(...chosen.map((f) => f.page))
    if (Number.isFinite(first)) doc.goTo(first)
    close()
  }

  const toggle = (id: string, on: boolean): void => setKinds(on ? [...kinds, id] : kinds.filter((k) => k !== id))
  return (
    <Modal
      title={t('Remove sensitive text')}
      onClose={close}
      wide
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button class="btn primary" disabled={!chosen.length} onClick={mark}>
            {chosen.length ? t('Mark {count} for redaction', { count: chosen.length }) : t('Mark for redaction')}
          </button>
        </>
      }
    >
      <div class="redact-text">
        <label class="field">
          <span>{t('Find text')}</span>
          <input type="search" value={term} placeholder={t('Name, account number, phrase…')} onInput={(e) => setTerm((e.target as HTMLInputElement).value)} />
        </label>
        <div class="check-line">
          <label class="check-row">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase((e.target as HTMLInputElement).checked)} /> {t('Match case')}
          </label>
          <label class="check-row">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord((e.target as HTMLInputElement).checked)} /> {t('Whole words')}
          </label>
        </div>
        <span class="flyout-label">{t('Also find')}</span>
        <div class="check-grid">
          {SENSITIVE_PATTERNS.map((p) => (
            <label key={p.id} class="check-row">
              <input type="checkbox" checked={kinds.includes(p.id)} onChange={(e) => toggle(p.id, (e.target as HTMLInputElement).checked)} /> {t(p.label)}
            </label>
          ))}
        </div>
        <div class="match-list" role="list" aria-label={t('Matches')}>
          {!pages ? (
            <p class="muted">{t('Reading the document’s text…')}</p>
          ) : !found.length ? (
            <p class="muted">{term || kinds.length ? t('No matches. For scanned pages, run Edit → Recognize Text (OCR) first.') : t('Type text or choose what to find.')}</p>
          ) : (
            found.slice(0, 500).map((f) => (
              <label key={f.key} class="check-row match" role="listitem">
                <input
                  type="checkbox"
                  checked={!skipped.has(f.key)}
                  onChange={(e) => {
                    const next = new Set(skipped)
                    if ((e.target as HTMLInputElement).checked) next.delete(f.key)
                    else next.add(f.key)
                    setSkipped(next)
                  }}
                />
                <span class="match-text">{f.text}</span>
                <span class="muted">{t('Page {page}', { page: f.page + 1 })}</span>
              </label>
            ))
          )}
        </div>
        <p class="muted small">{t('Redaction removes the text and rasterizes the affected pages when you apply it. It can’t be undone after saving.')}</p>
      </div>
    </Modal>
  )
}
