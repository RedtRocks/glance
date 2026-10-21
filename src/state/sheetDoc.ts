import { computed, signal } from '@preact/signals'
import { BaseDoc } from './documents'
import { History } from './history'
import { emptyWorkbook, type Workbook } from '../core/sheet/model'
import { applyOps, type ApplyResult, type SheetOp } from '../core/sheet/ops'
import { todaySerial } from '../core/sheet/recalc'

/** The picked cells: the cell typing goes into (`r`, `c`) and the far corner of the range. */
export interface SheetSelection {
  r: number
  c: number
  r2: number
  c2: number
}

export type SheetFormat = 'xlsx' | 'csv'

/**
 * A workbook (.xlsx, or .csv/.tsv as one sheet). Every change, the person's or an AI app's,
 * is a list of sheet operations applied as one undo step, like decks.
 */
export class SheetDoc extends BaseDoc {
  readonly kind = 'sheet' as const
  readonly wb = signal<Workbook>(emptyWorkbook())
  /** Pictures by media/ path, as in decks. */
  readonly media = new Map<string, Uint8Array>()
  readonly mediaVersion = signal(0)
  readonly format: SheetFormat
  /** The separator a CSV file used, kept when it's saved. */
  csvSeparator = ','
  readonly sel = signal<SheetSelection>({ r: 0, c: 0, r2: 0, c2: 0 })
  readonly zoom = signal(1)
  readonly history = new History<Workbook>(100)
  readonly historyVersion = signal(0)
  /** The grid is one page to the toolbar, Go menu and slideshow; sheets have their own tabs. */
  readonly pageCount = computed(() => 1)
  readonly current = signal(0)
  /** What the last read left out, for AI apps and the check. */
  warnings: string[] = []
  readonly activeSheet = computed(() => {
    const wb = this.wb.value
    return wb.sheets[wb.active ?? 0] ?? wb.sheets[0]
  })

  constructor(name: string, path: string | null, format: SheetFormat = 'xlsx') {
    super(name, path)
    this.format = format
    this.sidebar.value = 'none'
  }

  /** Applies `ops` as one undo step. Throws SheetError, changing nothing, if any is invalid. */
  apply(label: string, ops: SheetOp[]): ApplyResult {
    const before = this.wb.peek()
    const result = applyOps(before, ops, { media: this.media, today: todaySerial() })
    this.history.push(label, before)
    this.wb.value = result.wb
    this.dirty.value = true
    this.historyVersion.value++
    return result
  }

  /** Starts the file over from a template's workbook, as one undo step. */
  replace(label: string, wb: Workbook, media: Map<string, Uint8Array>): void {
    this.history.push(label, this.wb.peek())
    for (const [k, v] of media) this.media.set(k, v)
    this.mediaVersion.value++
    this.restore(wb)
  }

  undo(): void {
    const e = this.history.undo(this.wb.peek())
    if (e) this.restore(e.state)
  }

  redo(): void {
    const e = this.history.redo(this.wb.peek())
    if (e) this.restore(e.state)
  }

  private restore(wb: Workbook): void {
    this.wb.value = wb
    this.dirty.value = true
    this.historyVersion.value++
  }
}
