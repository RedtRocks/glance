/**
 * Every user command in one registry: the menu bar, toolbar, keyboard shortcuts and
 * the shortcut editor all read from here.
 */
import { normalizeCombo } from '../core/shortcuts'
import * as platform from '../platform'
import * as actions from './actions'
import { activeDoc, activeId, docs, type Doc, type ViewMode } from './documents'
import { settings, updateSettings } from './settings'
import { customizeOpen, findOpen, settingsOpen, sidebarVisible, slideshow } from './ui'
import { printDoc } from './print'

export interface Command {
  id: string
  label: string
  /** Default bindings, Windows-first (see core/shortcuts.ts). */
  keys?: string[]
  run: () => void | Promise<void>
  enabled?: () => boolean
  /** Checked state for toggles shown in menus. */
  checked?: () => boolean
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8]

export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-3) ?? ZOOM_STEPS.at(-1)!
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-3) ?? ZOOM_STEPS[0]
}

const pdf = () => (activeDoc.value?.kind === 'pdf' ? activeDoc.value : null)
const hasDoc = () => activeDoc.value !== null
const isPdf = () => pdf() !== null
const multiPage = () => {
  const d = activeDoc.value
  return !!d && d.kind !== 'notice' && d.pageCount.value > 1
}

function zoom(dir: 1 | -1): void {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  const next = stepZoom(d.effectiveScale.value, dir)
  if (d.kind === 'pdf') d.zoom.value = next
  else d.zoom.value = next
}

function setZoom(mode: 'actual' | 'fit'): void {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  if (d.kind === 'pdf') d.zoom.value = mode === 'actual' ? 1 : 'fit-page'
  else d.zoom.value = mode === 'actual' ? 1 : 'fit'
}

function goPage(delta: number | 'first' | 'last'): void {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  const n = d.pageCount.value
  const target = delta === 'first' ? 0 : delta === 'last' ? n - 1 : d.current.value + delta
  if (d.kind === 'pdf') d.goTo(target)
  else d.current.value = Math.min(Math.max(target, 0), n - 1)
}

function setView(mode: ViewMode): void {
  const d = pdf()
  if (!d) return
  d.contactSheet.value = false
  d.viewMode.value = mode
}

function showSidebar(mode: 'thumbnails' | 'toc' | 'none'): void {
  const d = activeDoc.value
  if (!d) return
  if (d.kind === 'pdf') d.contactSheet.value = false
  d.sidebar.value = mode
  sidebarVisible.value = mode !== 'none'
}

function cycleTab(dir: 1 | -1): void {
  const list = docs.value
  if (list.length < 2) return
  const i = list.findIndex((d: Doc) => d.id === activeId.value)
  activeId.value = list[(i + dir + list.length) % list.length].id
}

export const COMMANDS: Command[] = [
  // File
  { id: 'file.open', label: 'Open…', keys: ['Ctrl+O'], run: actions.openWithDialog },
  { id: 'file.newWindow', label: 'New Window', keys: ['Ctrl+Shift+N'], run: () => platform.openNewWindow([]) },
  { id: 'file.save', label: 'Save', keys: ['Ctrl+S'], run: () => actions.save(), enabled: isPdf },
  { id: 'file.saveAs', label: 'Save As…', keys: ['Ctrl+Shift+S'], run: () => actions.saveAs(), enabled: isPdf },
  { id: 'file.exportPages', label: 'Export Selected Pages…', keys: ['Ctrl+E'], run: () => actions.exportSelectedPages(), enabled: isPdf },
  { id: 'file.print', label: 'Print…', keys: ['Ctrl+P'], run: () => printDoc(activeDoc.value), enabled: hasDoc },
  { id: 'file.close', label: 'Close Tab', keys: ['Ctrl+W', 'Ctrl+F4'], run: () => actions.closeDoc(), enabled: hasDoc },
  { id: 'file.settings', label: 'Settings', keys: ['Ctrl+,'], run: () => void (settingsOpen.value = true) },
  // Edit
  { id: 'edit.undo', label: 'Undo', keys: ['Ctrl+Z'], run: () => actions.undo(), enabled: () => !!pdf()?.history.canUndo },
  { id: 'edit.redo', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], run: () => actions.redo(), enabled: () => !!pdf()?.history.canRedo },
  { id: 'edit.selectAll', label: 'Select All Pages', keys: ['Ctrl+A'], run: () => actions.selectAllPages(), enabled: isPdf },
  { id: 'edit.find', label: 'Find…', keys: ['Ctrl+F'], run: () => void (findOpen.value = true), enabled: isPdf },
  { id: 'edit.insertBlank', label: 'Insert Blank Page', run: () => actions.insertBlankPage(), enabled: isPdf },
  { id: 'edit.insertFile', label: 'Insert Page from File…', run: () => actions.insertFromFileDialog(), enabled: isPdf },
  { id: 'edit.deletePages', label: 'Delete Selected Pages', keys: ['Delete'], run: () => actions.deletePages(), enabled: isPdf },
  // View
  { id: 'view.hideSidebar', label: 'Hide Sidebar', keys: ['Ctrl+Shift+1'], run: () => showSidebar('none'), enabled: hasDoc },
  { id: 'view.thumbnails', label: 'Thumbnails', keys: ['Ctrl+Shift+2'], run: () => showSidebar('thumbnails'), enabled: multiPage, checked: () => sidebarVisible.value && activeDoc.value?.sidebar.value === 'thumbnails' },
  { id: 'view.toc', label: 'Table of Contents', keys: ['Ctrl+Shift+3'], run: () => showSidebar('toc'), enabled: isPdf, checked: () => sidebarVisible.value && activeDoc.value?.sidebar.value === 'toc' },
  {
    id: 'view.contactSheet',
    label: 'Contact Sheet',
    keys: ['Ctrl+Shift+6'],
    run: () => {
      const d = pdf()
      if (d) d.contactSheet.value = !d.contactSheet.value
    },
    enabled: isPdf,
    checked: () => !!pdf()?.contactSheet.value
  },
  { id: 'view.continuous', label: 'Continuous Scroll', keys: ['Ctrl+1'], run: () => setView('continuous'), enabled: isPdf, checked: () => pdf()?.viewMode.value === 'continuous' },
  { id: 'view.single', label: 'Single Page', keys: ['Ctrl+2'], run: () => setView('single'), enabled: isPdf, checked: () => pdf()?.viewMode.value === 'single' },
  { id: 'view.two', label: 'Two Pages', keys: ['Ctrl+3'], run: () => setView('two'), enabled: isPdf, checked: () => pdf()?.viewMode.value === 'two' },
  { id: 'view.zoomIn', label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+='], run: () => zoom(1), enabled: hasDoc },
  { id: 'view.zoomOut', label: 'Zoom Out', keys: ['Ctrl+-'], run: () => zoom(-1), enabled: hasDoc },
  { id: 'view.actualSize', label: 'Actual Size', keys: ['Ctrl+0'], run: () => setZoom('actual'), enabled: hasDoc },
  { id: 'view.zoomToFit', label: 'Zoom to Fit', keys: ['Ctrl+9'], run: () => setZoom('fit'), enabled: hasDoc },
  {
    id: 'view.darkPdf',
    label: 'Dark Appearance for PDFs',
    run: () => updateSettings({ darkPdf: !settings.value.darkPdf }),
    checked: () => settings.value.darkPdf
  },
  { id: 'view.fullscreen', label: 'Full Screen', keys: ['F11'], run: () => platform.toggleFullscreen() },
  { id: 'view.slideshow', label: 'Slideshow', keys: ['Ctrl+Shift+F'], run: () => void (slideshow.value = true), enabled: hasDoc },
  { id: 'view.customizeToolbar', label: 'Customize Toolbar…', run: () => void (customizeOpen.value = true) },
  // Go
  { id: 'go.previous', label: 'Previous Page', keys: ['Ctrl+Up', 'PageUp'], run: () => goPage(-1), enabled: multiPage },
  { id: 'go.next', label: 'Next Page', keys: ['Ctrl+Down', 'PageDown'], run: () => goPage(1), enabled: multiPage },
  { id: 'go.first', label: 'First Page', keys: ['Home'], run: () => goPage('first'), enabled: multiPage },
  { id: 'go.last', label: 'Last Page', keys: ['End'], run: () => goPage('last'), enabled: multiPage },
  { id: 'go.page', label: 'Go to Page…', keys: ['Ctrl+Shift+G'], run: () => goToPagePrompt(), enabled: multiPage },
  { id: 'go.nextTab', label: 'Next Tab', keys: ['Ctrl+Tab'], run: () => cycleTab(1) },
  { id: 'go.previousTab', label: 'Previous Tab', keys: ['Ctrl+Shift+Tab'], run: () => cycleTab(-1) },
  // Tools
  { id: 'tools.rotateLeft', label: 'Rotate Left', keys: ['Ctrl+L'], run: () => actions.rotatePages(-90), enabled: hasDoc },
  { id: 'tools.rotateRight', label: 'Rotate Right', keys: ['Ctrl+R'], run: () => actions.rotatePages(90), enabled: hasDoc },
  // Help
  { id: 'help.about', label: 'About Glance', run: actions.showAbout },
  { id: 'help.github', label: 'Glance on GitHub', run: () => platform.openUrl('https://github.com/RedtRocks/viewer') }
]

export const commandById = new Map(COMMANDS.map((c) => [c.id, c]))

export async function runCommand(id: string): Promise<void> {
  const cmd = commandById.get(id)
  if (!cmd || (cmd.enabled && !cmd.enabled())) return
  await cmd.run()
}

/** Effective bindings (defaults with user overrides), canonicalized. */
export function bindings(): Record<string, string[]> {
  const overrides = settings.value.shortcuts
  const out: Record<string, string[]> = {}
  for (const c of COMMANDS) out[c.id] = (overrides[c.id] ?? c.keys ?? []).map(normalizeCombo)
  return out
}

export function keysFor(id: string): string[] {
  return bindings()[id] ?? []
}

async function goToPagePrompt(): Promise<void> {
  const { promptText } = await import('./ui')
  const { parsePageInput } = await import('../core/pageControls')
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  const text = await promptText('Go to Page', `Page number (1–${d.pageCount.value})`, { ok: 'Go' })
  if (text == null) return
  const idx = parsePageInput(text, d.pageCount.value)
  if (idx === null) return
  if (d.kind === 'pdf') d.goTo(idx)
  else d.current.value = idx
}
