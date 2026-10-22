/**
 * The spreadsheet's formatting toolbar, above the formula bar, as in Excel and Google
 * Sheets. Buttons keep the keyboard in the grid, so typing carries on after a click.
 */
import type { SheetDoc } from '../../state/sheetDoc'
import * as sheet from '../../state/sheet'
import { contextMenu, type ContextMenuItem } from '../../state/ui'
import { msg, t } from '../../i18n'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import type { StyleInput } from '../../core/sheet/ops'

const FONTS = ['Urbanist', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Courier New']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]
const COLOURS: [string, string][] = [
  [msg('Black'), '#000000'], [msg('Grey'), '#6b6b6b'], [msg('Red'), '#d13438'], [msg('Orange'), '#f47933'], [msg('Yellow'), '#f8d32c'],
  [msg('Green'), '#1e8e4e'], [msg('Blue'), '#0f6cbd'], [msg('Violet'), '#6312f6'], [msg('Pink'), '#f258a8'], [msg('White'), '#ffffff']
]
const FORMATS: [string, string | null][] = [
  [msg('General'), null], [msg('Number'), '#,##0.00'], [msg('Currency'), '£#,##0.00'], [msg('Percent'), '0%'], [msg('Date'), 'd mmm yyyy'], [msg('Time'), 'hh:mm']
]

const keep = (e: MouseEvent) => e.preventDefault()

/** Back to the grid after a menu pick, so typing and arrow keys carry on there. */
const backToGrid = () => document.querySelector<HTMLElement>('.sheet-scroll')?.focus({ preventScroll: true })

function menuAt(e: MouseEvent, items: (ContextMenuItem | '-')[]): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const back = (x: ContextMenuItem | '-'): ContextMenuItem | '-' => (x === '-' || !x.run ? x : { ...x, run: () => {
    const out = x.run!()
    requestAnimationFrame(backToGrid)
    return out
  } })
  contextMenu.value = { x: r.left, y: r.bottom + 4, items: items.map(back) }
}

export function SheetToolbar({ doc }: { doc: SheetDoc }) {
  // Read the selection and history so the pressed states follow them.
  void doc.sel.value
  void doc.historyVersion.value
  void doc.wb.value
  const st = sheet.selectionStyle(doc)
  const fmt = (label: string, style: StyleInput) => () => sheet.formatSelection(doc, label, style)

  const Btn = ({ icon, label, run, on, text }: { icon?: IconName; label: string; run: (e: MouseEvent) => void; on?: boolean; text?: string }) => (
    <button
      class={`deck-bar-button sheet-tool${on ? ' on' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={on === undefined ? undefined : on}
      onMouseDown={keep}
      onClick={(e) => run(e as unknown as MouseEvent)}
    >
      {icon && <Icon name={icon} size={18} />}
      {text}
    </button>
  )
  const colours = (pick: (c: string | null) => void, none?: string) => (e: MouseEvent) =>
    menuAt(e, [...COLOURS.map(([name, c]) => ({ label: t(name), run: () => pick(c) })), ...(none ? ['-' as const, { label: none, run: () => pick(null) }] : [])])
  const font = st?.font?.name ?? 'Urbanist'
  const size = st?.font?.size ?? 11
  const align = st?.align?.h

  return (
    <div class="deck-bar sheet-toolbar" role="toolbar" aria-label={t('Spreadsheet toolbar')}>
      <Btn icon="undo" label={t('Undo')} run={() => void doc.undo()} />
      <Btn icon="redo" label={t('Redo')} run={() => void doc.redo()} />
      <span class="sheet-tool-sep" />
      <button class="deck-bar-button" onMouseDown={keep} onClick={(e) => menuAt(e, FORMATS.map(([name, f]) => ({ label: t(name), run: () => sheet.formatNumbers(doc, msg('Number Format'), f) })))}>
        <Icon name="numberFormat" size={18} />
        {t('Number')}
        <Icon name="down" size={12} />
      </button>
      <Btn icon="currency" label={t('Currency')} run={() => sheet.formatNumbers(doc, msg('Number Format'), '£#,##0.00')} />
      <Btn text="%" label={t('Percent')} run={() => sheet.formatNumbers(doc, msg('Number Format'), '0%')} />
      <Btn icon="decimalsLess" label={t('Fewer decimals')} run={() => sheet.stepSelectionDecimals(doc, -1)} />
      <Btn icon="decimalsMore" label={t('More decimals')} run={() => sheet.stepSelectionDecimals(doc, 1)} />
      <span class="sheet-tool-sep" />
      <button class="deck-bar-button sheet-font" title={t('Font')} onMouseDown={keep} onClick={(e) => menuAt(e, FONTS.map((f) => ({ label: f, run: fmt(msg('Font'), { font: f }) })))}>
        {font}
        <Icon name="down" size={12} />
      </button>
      <button class="deck-bar-button" title={t('Font size')} onMouseDown={keep} onClick={(e) => menuAt(e, SIZES.map((n) => ({ label: String(n), run: fmt(msg('Font Size'), { size: n }) })))}>
        {size}
        <Icon name="down" size={12} />
      </button>
      <Btn icon="bold" label={t('Bold')} on={!!st?.font?.bold} run={fmt(msg('Bold'), { bold: !st?.font?.bold })} />
      <Btn icon="italic" label={t('Italic')} on={!!st?.font?.italic} run={fmt(msg('Italic'), { italic: !st?.font?.italic })} />
      <Btn icon="underlineText" label={t('Underline')} on={!!st?.font?.underline} run={fmt(msg('Underline'), { underline: !st?.font?.underline })} />
      <Btn icon="textColor" label={t('Text colour')} run={colours((c) => sheet.formatSelection(doc, msg('Text Colour'), { color: c ?? '#000000' }))} />
      <Btn icon="fillBucket" label={t('Fill colour')} run={colours((c) => sheet.formatSelection(doc, msg('Fill Colour'), { fill: c }), t('No fill'))} />
      <Btn
        icon="borders"
        label={t('Borders')}
        run={(e) =>
          menuAt(e, [
            { label: t('All borders'), run: fmt(msg('Borders'), { border: 'all' }) },
            { label: t('Outside border'), run: fmt(msg('Borders'), { border: 'outline' }) },
            { label: t('Bottom border'), run: fmt(msg('Borders'), { border: 'bottom' }) },
            '-',
            { label: t('No borders'), run: fmt(msg('Borders'), { border: 'none' }) }
          ])
        }
      />
      <span class="sheet-tool-sep" />
      <Btn icon="alignLeft" label={t('Align left')} on={align === 'left'} run={fmt(msg('Align Left'), { align: 'left' })} />
      <Btn icon="alignCenter" label={t('Align centre')} on={align === 'center'} run={fmt(msg('Align Center'), { align: 'center' })} />
      <Btn icon="alignRight" label={t('Align right')} on={align === 'right'} run={fmt(msg('Align Right'), { align: 'right' })} />
      <Btn icon="wrapText" label={t('Wrap text')} on={!!st?.align?.wrap} run={fmt(msg('Wrap Text'), { wrap: !st?.align?.wrap })} />
      <Btn icon="merge" label={t('Merge cells')} run={() => sheet.toggleMerge(doc)} />
      <span class="sheet-tool-sep" />
      <Btn
        icon="sort"
        label={t('Sort')}
        run={(e) =>
          menuAt(e, [
            { label: t('Sort A to Z'), run: () => sheet.sortBy(doc, false) },
            { label: t('Sort Z to A'), run: () => sheet.sortBy(doc, true) }
          ])
        }
      />
      <Btn icon="filter" label={t('Filter')} on={!!doc.activeSheet.value.filter} run={() => sheet.toggleFilter(doc)} />
      <Btn icon="chart" label={t('Chart')} run={() => sheet.chartSelection(doc)} />
      <Btn icon="autosum" label={t('Sum')} run={() => sheet.autoSumSelection(doc)} />
    </div>
  )
}
