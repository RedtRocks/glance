/**
 * Every user command in one registry: the menu bar, toolbar, keyboard shortcuts and
 * the shortcut editor all read from here.
 */
import { cycleTool, displayCombo, normalizeCombo, stepWidth } from '../core/shortcuts'
import * as platform from '../platform'
import * as actions from './actions'
import * as shell from './shellActions'
import * as ocr from './ocrActions'
import { batchOpen } from './batch'
import { checkForUpdates } from './updates'
import { versionsOpen } from './versions'
import { activeDoc, activeId, docs, type Doc, type ViewMode } from './documents'
import { settings, updateSettings } from './settings'
import { cleanupOpen, collageOpen, reduceOpen, scanOpen, customizeOpen, findOpen, inspectorOpen, promptText, redactTextOpen, toast, settingsOpen, sidebarVisible, slideshow } from './ui'
import { parsePageInput } from '../core/pageControls'
import { printDoc } from './print'
import { applyRedactions } from './actions'
import { markupBar, restyle, selectedId, setTool, SHAPE_TOOLS, signatureDialog, style, tool, WIDTHS, type Tool } from './markupState'
import { bookmarksFor, setBookmarks } from './bookmarks'
import { adjustColorOpen, adjustSizeOpen, exportOpen, imageSelection } from './imageState'
import * as img from './imageActions'

export interface Command {
  id: string
  label: string
  /** Default bindings, Windows-first (see core/shortcuts.ts). */
  keys?: string[]
  run: () => void | Promise<void>
  enabled?: () => boolean
  /** Checked state for toggles shown in menus. */
  checked?: () => boolean
  /** Commands sharing a group are mutually exclusive choices (shown with a radio dot). */
  radio?: string
  /** Whether the command belongs to the open file at all; menus hide it otherwise. */
  visible?: () => boolean
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8]

export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-3) ?? ZOOM_STEPS.at(-1)!
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-3) ?? ZOOM_STEPS[0]
}

const pdf = () => (activeDoc.value?.kind === 'pdf' ? activeDoc.value : null)
const model = () => (activeDoc.value?.kind === 'model' ? activeDoc.value : null)
/** The sidebar pane actually on screen, or null when hidden. */
const sidebarShown = () => {
  const pane = activeDoc.value?.sidebar.value
  return sidebarVisible.value && pane && pane !== 'none' ? pane : null
}
const layout = () => {
  const d = pdf()
  return !d ? null : d.contactSheet.value ? 'contact' : d.viewMode.value
}

const image = () => img.editableImage(activeDoc.value)
const isImage = () => image() !== null
const anyImage = () => activeDoc.value?.kind === 'image'
const markupHost = () => pdf() ?? image()
const hasDoc = () => activeDoc.value !== null
const isPdf = () => pdf() !== null
const multiPage = () => {
  const d = activeDoc.value
  return !!d && d.kind !== 'notice' && d.pageCount.value > 1
}

function zoom(dir: 1 | -1): void {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  if (d.kind === 'model') return void (d.viewRequest.value = { kind: 'zoom', dir })
  const next = stepZoom(d.effectiveScale.value, dir)
  if (d.kind === 'pdf') d.zoom.value = next
  else d.zoom.value = next
}

function setZoom(mode: 'actual' | 'fit'): void {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  if (d.kind === 'model') return void (d.viewRequest.value = { kind: 'reset' })
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

function showSidebar(mode: 'thumbnails' | 'toc' | 'notes' | 'bookmarks' | 'none'): void {
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
  { id: 'file.newFromClipboard', label: 'New from Clipboard', keys: ['Ctrl+N'], run: () => img.newFromClipboard(), enabled: () => platform.isTauri },
  { id: 'file.scan', label: 'Import from Scanner…', run: () => void (scanOpen.value = true), enabled: () => platform.scanAvailable },
  { id: 'file.newWindow', label: 'New Window', keys: ['Ctrl+Shift+N'], run: () => platform.openNewWindow([]) },
  { id: 'file.save', label: 'Save', keys: ['Ctrl+S'], run: () => actions.save(), enabled: () => isPdf() || isImage() },
  { id: 'file.saveAs', label: 'Save As…', keys: ['Ctrl+Shift+S'], run: () => actions.saveAs(), enabled: () => isPdf() || isImage() },
  {
    id: 'file.export',
    label: 'Export…',
    keys: ['Ctrl+E'],
    // Models export a snapshot of the current view.
    run: () => void (model() ? (model()!.viewRequest.value = { kind: 'snapshot' }) : (exportOpen.value = true)),
    enabled: () => isPdf() || isImage() || !!model()
  },
  { id: 'file.exportPages', label: 'Export Selected Pages…', run: () => actions.exportSelectedPages(), enabled: isPdf },
  { id: 'file.versions', label: 'Browse Versions…', run: () => void (versionsOpen.value = true), enabled: () => !!activeDoc.value?.path.value },
  { id: 'file.reduce', label: 'Reduce File Size…', run: () => void (reduceOpen.value = true), enabled: isPdf },
  { id: 'file.cleanup', label: 'Clean Up PDF…', run: () => void (cleanupOpen.value = true), enabled: isPdf },
  { id: 'file.collage', label: 'Create Collage…', run: () => void (collageOpen.value = true) },
  { id: 'file.batch', label: 'Batch Edit Images…', run: () => void (batchOpen.value = true) },
  { id: 'file.share', label: 'Share…', run: () => shell.shareDoc(), enabled: () => platform.isTauri },
  { id: 'file.openWith', label: 'Open With Another App…', run: () => shell.openWithOtherApp(), enabled: () => shell.canOpenWith() },
  { id: 'image.setWallpaper', label: 'Set as Desktop Background', run: () => shell.setAsWallpaper('desktop'), enabled: anyImage },
  { id: 'image.setLockScreen', label: 'Set as Lock Screen', run: () => shell.setAsWallpaper('lock'), enabled: anyImage },
  { id: 'file.print', label: 'Print…', keys: ['Ctrl+P'], run: () => printDoc(activeDoc.value), enabled: hasDoc },
  { id: 'file.close', label: 'Close Tab', keys: ['Ctrl+W', 'Ctrl+F4'], run: () => actions.closeDoc(), enabled: hasDoc },
  { id: 'file.settings', label: 'Settings', keys: ['Ctrl+,'], run: () => void (settingsOpen.value = true) },
  // Edit
  { id: 'edit.undo', label: 'Undo', keys: ['Ctrl+Z'], run: () => actions.undo(), enabled: () => !!(pdf() ?? image())?.history.canUndo },
  { id: 'edit.redo', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], run: () => actions.redo(), enabled: () => !!(pdf() ?? image())?.history.canRedo },
  { id: 'edit.selectAll', label: 'Select All Pages', keys: ['Ctrl+A'], run: () => actions.selectAllPages(), enabled: isPdf },
  { id: 'edit.find', label: 'Find…', keys: ['Ctrl+F'], run: () => void (findOpen.value = true), enabled: isPdf },
  { id: 'edit.insertBlank', label: 'Insert Blank Page', run: () => actions.insertBlankPage(), enabled: isPdf },
  { id: 'edit.insertFile', label: 'Insert Page from File…', run: () => actions.insertFromFileDialog(), enabled: isPdf },
  { id: 'edit.duplicatePages', label: 'Duplicate Pages', run: () => actions.duplicatePages(), enabled: isPdf },
  { id: 'file.split', label: 'Split PDF…', run: () => actions.splitDocument(), enabled: () => isPdf() && (pdf()?.pageCount.peek() ?? 0) > 1 },
  {
    id: 'edit.delete',
    label: 'Delete',
    keys: ['Delete', 'Backspace'],
    // Selected markup first; otherwise the selected pages.
    run: () => {
      const host = markupHost()
      const id = selectedId.peek()
      if (host && id && host.markup.peek().some((m) => m.id === id)) {
        host.edit('Delete Markup', { markup: host.markup.peek().filter((m) => m.id !== id) })
        selectedId.value = null
        return
      }
      const im = image()
      if (im && imageSelection.peek()) return void img.deleteSelection(im)
      const d = pdf()
      if (d && d.selection.peek().length) return actions.deletePages()
    },
    enabled: () => isPdf() || isImage()
  },
  { id: 'edit.invertSelection', label: 'Invert Selection', keys: ['Ctrl+Shift+I'], run: () => void img.invertSelection(image()!), enabled: () => isImage() && !!imageSelection.value },
  { id: 'edit.deletePages', label: 'Delete Selected Pages', run: () => actions.deletePages(), enabled: isPdf },
  { id: 'edit.addBookmark', label: 'Add Bookmark', keys: ['Ctrl+D'], run: () => addBookmark(), enabled: isPdf },
  // View
  { id: 'view.hideSidebar', label: 'No Sidebar', keys: ['Ctrl+Shift+1'], run: () => showSidebar('none'), enabled: hasDoc, radio: 'sidebar', checked: () => !sidebarShown() },
  { id: 'view.thumbnails', label: 'Thumbnails', keys: ['Ctrl+Shift+2'], run: () => showSidebar('thumbnails'), enabled: multiPage, radio: 'sidebar', checked: () => sidebarShown() === 'thumbnails' },
  { id: 'view.toc', label: 'Table of Contents', keys: ['Ctrl+Shift+3'], run: () => showSidebar('toc'), enabled: isPdf, radio: 'sidebar', checked: () => sidebarShown() === 'toc' },
  { id: 'view.notes', label: 'Highlights and Notes', keys: ['Ctrl+Shift+4'], run: () => showSidebar('notes'), enabled: isPdf, radio: 'sidebar', checked: () => sidebarShown() === 'notes' },
  { id: 'view.bookmarks', label: 'Bookmarks', keys: ['Ctrl+Shift+5'], run: () => showSidebar('bookmarks'), enabled: isPdf, radio: 'sidebar', checked: () => sidebarShown() === 'bookmarks' },
  // Page layout: the three scroll modes and the contact sheet are one choice.
  { id: 'view.continuous', label: 'Continuous Scroll', keys: ['Ctrl+1'], run: () => setView('continuous'), enabled: isPdf, radio: 'layout', checked: () => layout() === 'continuous' },
  { id: 'view.single', label: 'Single Page', keys: ['Ctrl+2'], run: () => setView('single'), enabled: isPdf, radio: 'layout', checked: () => layout() === 'single' },
  { id: 'view.two', label: 'Two Pages', keys: ['Ctrl+3'], run: () => setView('two'), enabled: isPdf, radio: 'layout', checked: () => layout() === 'two' },
  {
    id: 'view.contactSheet',
    label: 'Contact Sheet',
    keys: ['Ctrl+Shift+6'],
    // The toolbar button toggles; from the menu it is one of the layouts.
    run: () => {
      const d = pdf()
      if (d) d.contactSheet.value = !d.contactSheet.value
    },
    enabled: isPdf,
    radio: 'layout',
    checked: () => layout() === 'contact'
  },
  { id: 'view.zoomIn', label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+=', '=', 'Shift+='], run: () => zoom(1), enabled: hasDoc },
  { id: 'view.zoomOut', label: 'Zoom Out', keys: ['Ctrl+-', '-'], run: () => zoom(-1), enabled: hasDoc },
  { id: 'view.actualSize', label: 'Actual Size', keys: ['Ctrl+0', 'Shift+0'], run: () => setZoom('actual'), enabled: hasDoc },
  { id: 'view.zoomToFit', label: 'Zoom to Fit', keys: ['Ctrl+9', 'Shift+1'], run: () => setZoom('fit'), enabled: hasDoc },
  {
    id: 'view.darkPdf',
    label: 'Dark Appearance for PDFs',
    run: () => updateSettings({ darkPdf: !settings.value.darkPdf }),
    checked: () => settings.value.darkPdf
  },
  { id: 'view.fullscreen', label: 'Full Screen', keys: ['F11'], run: () => platform.toggleFullscreen() },
  { id: 'view.slideshow', label: 'Slideshow', keys: ['Ctrl+Shift+F'], run: () => void (slideshow.value = true), enabled: hasDoc },
  { id: 'model.resetView', label: 'Reset View', run: () => void (model() && (model()!.viewRequest.value = { kind: 'reset' })) },
  { id: 'model.wireframe', label: 'Wireframe', keys: ['W'], run: () => void (model() && (model()!.wireframe.value = !model()!.wireframe.value)), checked: () => !!model()?.wireframe.value },
  { id: 'model.autoRotate', label: 'Turntable', keys: ['T'], run: () => void (model() && (model()!.autoRotate.value = !model()!.autoRotate.value)), checked: () => !!model()?.autoRotate.value },
  { id: 'view.inspector', label: 'Inspector', keys: ['Ctrl+I'], run: () => void (inspectorOpen.value = !inspectorOpen.value), checked: () => inspectorOpen.value },
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
  {
    id: 'tools.markup',
    label: 'Show Markup Toolbar',
    keys: ['Ctrl+Shift+A'],
    run: () => {
      if (markupBar.value) {
        setTool('select')
        markupBar.value = false
      } else {
        markupBar.value = true
      }
    },
    enabled: () => isPdf() || isImage(),
    checked: () => markupBar.value
  },
  // Single-key tools, as in Photoshop, Illustrator and Figma. Pressing a key again
  // steps through its group (M: rectangle then ellipse selection; U: the shapes).
  { id: 'tools.select', label: 'Select and Move', keys: ['V'], run: () => pickTool(['select']), enabled: () => isPdf() || anyImage(), checked: () => tool.value === 'select' },
  { id: 'tools.hand', label: 'Hand', keys: ['H'], run: () => pickTool(['hand']), enabled: () => isPdf() || anyImage(), checked: () => tool.value === 'hand' },
  { id: 'tools.zoom', label: 'Zoom Tool', keys: ['Z'], run: () => pickTool(['zoom']), enabled: () => isPdf() || anyImage(), checked: () => tool.value === 'zoom' },
  { id: 'tools.marquee', label: 'Rectangular / Elliptical Selection', keys: ['M'], run: () => pickTool(['selectRect', 'selectEllipse']), enabled: isImage, checked: () => tool.value === 'selectRect' || tool.value === 'selectEllipse' },
  { id: 'tools.lasso', label: 'Lasso / Smart Lasso', keys: ['L'], run: () => pickTool(['lasso', 'smartLasso']), enabled: isImage, checked: () => tool.value === 'lasso' || tool.value === 'smartLasso' },
  { id: 'tools.brush', label: 'Draw / Sketch', keys: ['B'], run: () => pickTool(['draw', 'sketch']), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'draw' || tool.value === 'sketch' },
  { id: 'tools.shapes', label: 'Shapes', keys: ['U'], run: () => pickTool(SHAPE_TOOLS), enabled: () => isPdf() || isImage(), checked: () => SHAPE_TOOLS.includes(tool.value) },
  { id: 'tools.rectangle', label: 'Rectangle', keys: ['R'], run: () => pickTool(['rect']), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'rect' },
  { id: 'tools.oval', label: 'Oval', keys: ['O'], run: () => pickTool(['oval']), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'oval' },
  { id: 'tools.thinner', label: 'Thinner Line', keys: ['['], run: () => stepLine(-1), enabled: () => isPdf() || isImage() },
  { id: 'tools.thicker', label: 'Thicker Line', keys: [']'], run: () => stepLine(1), enabled: () => isPdf() || isImage() },
  { id: 'tools.highlight', label: 'Highlight', keys: ['Ctrl+Shift+H'], run: () => toggleTool('highlight'), enabled: isPdf, checked: () => tool.value === 'highlight' },
  { id: 'tools.text', label: 'Add Text Box', keys: ['T', 'Ctrl+Shift+T'], run: () => toggleTool('text'), enabled: () => isPdf() || isImage() },
  { id: 'tools.note', label: 'Add Note', keys: ['S', 'Ctrl+Shift+O'], run: () => toggleTool('note'), enabled: isPdf },
  { id: 'tools.signature', label: 'Signature…', keys: ['Ctrl+Shift+J'], run: () => void (signatureDialog.value = true), enabled: () => isPdf() || isImage() },
  { id: 'tools.ocr', label: 'Recognize Text (OCR)…', run: () => ocr.recognizePdfText(), enabled: isPdf },
  { id: 'tools.copyImageText', label: 'Copy Text from Image', run: () => ocr.copyImageText() },
  { id: 'tools.redactText', label: 'Remove Sensitive Text…', run: () => void (redactTextOpen.value = true), enabled: isPdf },
  { id: 'tools.redact', label: 'Redact', keys: ['Ctrl+Shift+R'], run: () => toggleTool('redact'), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'redact' },
  { id: 'tools.applyRedactions', label: 'Apply Redactions…', run: () => void applyRedactions(), enabled: () => !!pdf()?.redactions.value.length },
  { id: 'tools.crop', label: 'Crop to Selection', keys: ['C', 'Ctrl+K'], run: () => void img.cropToSelection(image()!), enabled: isImage },
  { id: 'tools.instantAlpha', label: 'Instant Alpha', keys: ['W'], run: () => toggleTool('instantAlpha'), enabled: isImage, checked: () => tool.value === 'instantAlpha' },
  { id: 'tools.removeBackground', label: 'Remove Background', keys: ['Ctrl+Shift+K'], run: () => void img.removeBackground(image()!), enabled: isImage },
  { id: 'tools.copySubject', label: 'Copy Subject', run: () => void img.copySubject(image()!), enabled: isImage },
  { id: 'tools.adjustColor', label: 'Adjust Color…', keys: ['Ctrl+Shift+C'], run: () => void (adjustColorOpen.value = true), enabled: isImage },
  { id: 'tools.adjustSize', label: 'Adjust Size…', keys: ['Ctrl+Shift+U'], run: () => void (adjustSizeOpen.value = true), enabled: isImage },
  { id: 'tools.flipHorizontal', label: 'Flip Horizontal', run: () => void img.flipImage(image()!, 'horizontal'), enabled: isImage },
  { id: 'tools.flipVertical', label: 'Flip Vertical', run: () => void img.flipImage(image()!, 'vertical'), enabled: isImage },
  { id: 'tools.rotateLeft', label: 'Rotate Left', keys: ['Ctrl+L'], run: () => actions.rotatePages(-90), enabled: hasDoc },
  { id: 'tools.rotateRight', label: 'Rotate Right', keys: ['Ctrl+R'], run: () => actions.rotatePages(90), enabled: hasDoc },
  // Help
  {
    id: 'help.updates',
    label: 'Check for Updates…',
    run: async () => {
      const r = await checkForUpdates({ force: true })
      if (r === 'current') toast('Glance is up to date')
      else if (r === 'error') toast('Couldn’t reach GitHub to check for updates', 'error')
      else if (r === 'off') toast('Update checks are available in the Windows app')
    }
  },
  { id: 'help.about', label: 'About Glance', run: actions.showAbout },
  { id: 'help.github', label: 'Glance on GitHub', run: () => platform.openUrl('https://github.com/RedtRocks/glance') }
]

// Which commands make sense for which kind of file. A PNG gets no page, outline or
// PDF-markup commands; a PDF gets no pixel-editing tools. (Disabled means "not right
// now"; hidden means "not for this file".)
const ifPdf = () => activeDoc.value?.kind === 'pdf'
const ifViewable = () => !!activeDoc.value && activeDoc.value.kind !== 'notice'
const ifMarkup = () => ifPdf() || isImage()
const ifPaged = () => ifPdf() || multiPage()
const VISIBILITY: [(() => boolean), string[]][] = [
  [hasDoc, ['file.close', 'file.openWith', 'view.customizeToolbar']],
  [() => ifPdf() || anyImage(), ['file.share']],
  [ifViewable, ['view.inspector']],
  [() => ifPdf() || anyImage(), ['file.versions']],
  [ifViewable, ['view.zoomIn', 'view.zoomOut', 'view.zoomToFit', 'view.fullscreen']],
  [() => ifPdf() || anyImage(), ['file.print', 'view.actualSize', 'view.slideshow', 'tools.rotateLeft', 'tools.rotateRight']],
  [() => activeDoc.value?.kind === 'model', ['model.wireframe', 'model.autoRotate', 'model.resetView']],
  [() => ifPdf() || isImage(), ['file.save', 'file.saveAs', 'edit.undo', 'edit.redo', 'edit.delete']],
  [() => ifPdf() || isImage() || !!model(), ['file.export']],
  [ifPdf, [
    'file.exportPages', 'file.split', 'edit.selectAll', 'edit.find', 'edit.insertBlank', 'edit.insertFile', 'edit.duplicatePages',
    'edit.deletePages', 'edit.addBookmark', 'file.cleanup', 'file.reduce', 'view.toc', 'view.notes', 'view.bookmarks', 'view.continuous', 'view.single', 'view.two',
    'view.contactSheet', 'view.darkPdf', 'tools.highlight', 'tools.note', 'tools.redactText', 'tools.applyRedactions', 'tools.ocr'
  ]],
  [ifPaged, ['view.hideSidebar', 'view.thumbnails', 'go.previous', 'go.next', 'go.first', 'go.last', 'go.page']],
  [ifMarkup, ['tools.markup', 'tools.text', 'tools.signature', 'tools.redact', 'tools.brush', 'tools.shapes', 'tools.rectangle', 'tools.oval', 'tools.thinner', 'tools.thicker']],
  [() => ifPdf() || anyImage(), ['tools.select', 'tools.hand', 'tools.zoom']],
  [anyImage, ['image.setWallpaper', 'image.setLockScreen', 'tools.copyImageText']],
  [isImage, [
    'edit.invertSelection', 'tools.crop', 'tools.instantAlpha', 'tools.marquee', 'tools.lasso', 'tools.removeBackground', 'tools.copySubject', 'tools.adjustColor',
    'tools.adjustSize', 'tools.flipHorizontal', 'tools.flipVertical'
  ]],
  [() => docs.value.length > 1, ['go.nextTab', 'go.previousTab']]
]
for (const [rule, ids] of VISIBILITY) {
  for (const id of ids) {
    const cmd = COMMANDS.find((c) => c.id === id)
    if (!cmd) throw new Error(`visibility rule for unknown command ${id}`)
    cmd.visible = rule
  }
}

export const commandById = new Map(COMMANDS.map((c) => [c.id, c]))

/** Whether a command is shown in menus for the open file. */
export function isVisible(id: string): boolean {
  const cmd = commandById.get(id)
  return !!cmd && (cmd.visible?.() ?? true)
}

export function isEnabled(id: string): boolean {
  const cmd = commandById.get(id)
  return !!cmd && (cmd.enabled?.() ?? true)
}

export async function runCommand(id: string): Promise<void> {
  const cmd = commandById.get(id)
  if (!cmd || (cmd.enabled && !cmd.enabled())) return
  await cmd.run()
}

/**
 * The command a key press runs. Some single keys mean different things for
 * different files (T is Text on a page but Turntable on a 3D model), so prefer the
 * command that applies to the open file.
 */
export function commandForCombo(combo: string): string | undefined {
  const map = bindings()
  const ids = Object.keys(map).filter((k) => map[k].includes(combo))
  return ids.find((k) => isVisible(k) && isEnabled(k)) ?? ids[0]
}

/**
 * Where a command's shortcut is live. Model commands and page tools never apply to
 * the same file, so they may share keys; everything else must be unique.
 */
export function keyScope(id: string): string {
  if (id.startsWith('model.')) return 'model'
  return id.startsWith('tools.') ? 'page' : ''
}

/** A tooltip with the command's first shortcut, e.g. "Text box (T)". */
export function tip(label: string, id?: string): string {
  const k = id ? keysFor(id)[0] : undefined
  return k ? `${label} (${displayCombo(k)})` : label
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

function toggleTool(t: Parameters<typeof setTool>[0]): void {
  setTool(tool.peek() === t ? 'select' : t)
}

function pickTool(group: readonly Tool[]): void {
  setTool(cycleTool(group, tool.peek()))
}

function stepLine(dir: 1 | -1): void {
  const host = markupHost()
  const sel = host?.markup.peek().find((m) => m.id === selectedId.peek())
  restyle(host, { width: stepWidth(WIDTHS, sel?.style.width ?? style.peek().width, dir) })
}

async function addBookmark(): Promise<void> {
  const d = pdf()
  if (!d) return
  const path = d.path.peek()
  if (!path) return
  const page = d.current.peek()
  const label = await promptText('Add Bookmark', 'Name', { initial: `Page ${page + 1}`, ok: 'Add' })
  if (label === null) return
  setBookmarks(path, [...bookmarksFor(path).filter((b) => b.page !== page), { page, label: label || `Page ${page + 1}`, created: Date.now() }])
}

async function goToPagePrompt(): Promise<void> {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  const text = await promptText('Go to Page', `Page number (1–${d.pageCount.value})`, { ok: 'Go' })
  if (text == null) return
  const idx = parsePageInput(text, d.pageCount.value)
  if (idx === null) return
  if (d.kind === 'pdf') d.goTo(idx)
  else d.current.value = idx
}
