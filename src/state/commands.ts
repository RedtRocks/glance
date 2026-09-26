/**
 * Every user command in one registry: the menu bar, toolbar, keyboard shortcuts and
 * the shortcut editor all read from here.
 */
import { cycleTool, displayCombo, normalizeCombo, stepWidth } from '../core/shortcuts'
import { msg, t } from '../i18n'
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
import { adjustColorOpen, adjustSizeOpen, exportOpen, imageSelection, straighten } from './imageState'
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

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8]

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
  { id: 'file.open', label: msg('Open…'), keys: ['Ctrl+O'], run: actions.openWithDialog },
  { id: 'file.newFromClipboard', label: msg('New from Clipboard'), keys: ['Ctrl+N'], run: () => img.newFromClipboard(), enabled: () => platform.isTauri },
  { id: 'file.scan', label: msg('Import from Scanner…'), run: () => void (scanOpen.value = true), enabled: () => platform.scanAvailable },
  { id: 'file.newWindow', label: msg('New Window'), keys: ['Ctrl+Shift+N'], run: () => platform.openNewWindow([]) },
  { id: 'file.save', label: msg('Save'), keys: ['Ctrl+S'], run: () => actions.save(), enabled: () => isPdf() || isImage() },
  { id: 'file.saveAs', label: msg('Save As…'), keys: ['Ctrl+Shift+S'], run: () => actions.saveAs(), enabled: () => isPdf() || isImage() },
  {
    id: 'file.export',
    label: msg('Export…'),
    keys: ['Ctrl+E'],
    // Models export a snapshot of the current view.
    run: () => void (model() ? (model()!.viewRequest.value = { kind: 'snapshot' }) : (exportOpen.value = true)),
    enabled: () => isPdf() || isImage() || !!model()
  },
  { id: 'file.exportPages', label: msg('Export Selected Pages…'), run: () => actions.exportSelectedPages(), enabled: isPdf },
  { id: 'file.versions', label: msg('Browse Versions…'), run: () => void (versionsOpen.value = true), enabled: () => !!activeDoc.value?.path.value },
  { id: 'file.reduce', label: msg('Reduce File Size…'), run: () => void (reduceOpen.value = true), enabled: isPdf },
  { id: 'file.cleanup', label: msg('Clean Up PDF…'), run: () => void (cleanupOpen.value = true), enabled: isPdf },
  { id: 'file.collage', label: msg('Create Collage…'), run: () => void (collageOpen.value = true) },
  { id: 'file.batch', label: msg('Batch Edit Images…'), run: () => void (batchOpen.value = true) },
  { id: 'file.share', label: msg('Share…'), run: () => shell.shareDoc(), enabled: () => platform.isTauri },
  { id: 'file.openWith', label: msg('Open With Another App…'), run: () => shell.openWithOtherApp(), enabled: () => shell.canOpenWith() },
  { id: 'image.setWallpaper', label: msg('Set as Desktop Background'), run: () => shell.setAsWallpaper('desktop'), enabled: anyImage },
  { id: 'image.setLockScreen', label: msg('Set as Lock Screen'), run: () => shell.setAsWallpaper('lock'), enabled: anyImage },
  { id: 'file.print', label: msg('Print…'), keys: ['Ctrl+P'], run: () => printDoc(activeDoc.value), enabled: hasDoc },
  { id: 'file.close', label: msg('Close Tab'), keys: ['Ctrl+W', 'Ctrl+F4'], run: () => actions.closeDoc(), enabled: hasDoc },
  { id: 'file.settings', label: msg('Settings'), keys: ['Ctrl+,'], run: () => void (settingsOpen.value = true) },
  // Edit
  { id: 'edit.undo', label: msg('Undo'), keys: ['Ctrl+Z'], run: () => actions.undo(), enabled: () => !!(pdf() ?? image())?.history.canUndo },
  { id: 'edit.redo', label: msg('Redo'), keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], run: () => actions.redo(), enabled: () => !!(pdf() ?? image())?.history.canRedo },
  { id: 'edit.selectAll', label: msg('Select All Pages'), keys: ['Ctrl+A'], run: () => actions.selectAllPages(), enabled: isPdf },
  { id: 'edit.find', label: msg('Find…'), keys: ['Ctrl+F'], run: () => void (findOpen.value = true), enabled: isPdf },
  { id: 'edit.insertBlank', label: msg('Insert Blank Page'), run: () => actions.insertBlankPage(), enabled: isPdf },
  { id: 'edit.insertFile', label: msg('Insert Page from File…'), run: () => actions.insertFromFileDialog(), enabled: isPdf },
  { id: 'edit.duplicatePages', label: msg('Duplicate Pages'), run: () => actions.duplicatePages(), enabled: isPdf },
  { id: 'file.split', label: msg('Split PDF…'), run: () => actions.splitDocument(), enabled: () => isPdf() && (pdf()?.pageCount.peek() ?? 0) > 1 },
  {
    id: 'edit.delete',
    label: msg('Delete'),
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
  { id: 'edit.invertSelection', label: msg('Invert Selection'), keys: ['Ctrl+Shift+I'], run: () => void img.invertSelection(image()!), enabled: () => isImage() && !!imageSelection.value },
  { id: 'edit.deletePages', label: msg('Delete Selected Pages'), run: () => actions.deletePages(), enabled: isPdf },
  { id: 'edit.addBookmark', label: msg('Add Bookmark'), keys: ['Ctrl+D'], run: () => addBookmark(), enabled: isPdf },
  // View
  { id: 'view.hideSidebar', label: msg('No Sidebar'), keys: ['Ctrl+Shift+1'], run: () => showSidebar('none'), enabled: hasDoc, radio: 'sidebar', checked: () => !sidebarShown() },
  { id: 'view.thumbnails', label: msg('Thumbnails'), keys: ['Ctrl+Shift+2'], run: () => showSidebar('thumbnails'), enabled: multiPage, radio: 'sidebar', checked: () => sidebarShown() === 'thumbnails' },
  { id: 'view.toc', label: msg('Table of Contents'), keys: ['Ctrl+Shift+3'], run: () => showSidebar('toc'), enabled: isPdf, radio: 'sidebar', checked: () => sidebarShown() === 'toc' },
  { id: 'view.notes', label: msg('Highlights and Notes'), keys: ['Ctrl+Shift+4'], run: () => showSidebar('notes'), enabled: isPdf, radio: 'sidebar', checked: () => sidebarShown() === 'notes' },
  { id: 'view.bookmarks', label: msg('Bookmarks'), keys: ['Ctrl+Shift+5'], run: () => showSidebar('bookmarks'), enabled: isPdf, radio: 'sidebar', checked: () => sidebarShown() === 'bookmarks' },
  // Page layout: the three scroll modes and the contact sheet are one choice.
  { id: 'view.continuous', label: msg('Continuous Scroll'), keys: ['Ctrl+1'], run: () => setView('continuous'), enabled: isPdf, radio: 'layout', checked: () => layout() === 'continuous' },
  { id: 'view.single', label: msg('Single Page'), keys: ['Ctrl+2'], run: () => setView('single'), enabled: isPdf, radio: 'layout', checked: () => layout() === 'single' },
  { id: 'view.two', label: msg('Two Pages'), keys: ['Ctrl+3'], run: () => setView('two'), enabled: isPdf, radio: 'layout', checked: () => layout() === 'two' },
  {
    id: 'view.contactSheet',
    label: msg('Contact Sheet'),
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
  { id: 'view.zoomIn', label: msg('Zoom In'), keys: ['Ctrl+=', 'Ctrl+Shift+=', '=', 'Shift+='], run: () => zoom(1), enabled: hasDoc },
  { id: 'view.zoomOut', label: msg('Zoom Out'), keys: ['Ctrl+-', '-'], run: () => zoom(-1), enabled: hasDoc },
  { id: 'view.actualSize', label: msg('Actual Size'), keys: ['Ctrl+0', 'Shift+0'], run: () => setZoom('actual'), enabled: hasDoc },
  { id: 'view.zoomToFit', label: msg('Zoom to Fit'), keys: ['Ctrl+9', 'Shift+1'], run: () => setZoom('fit'), enabled: hasDoc },
  {
    id: 'view.darkPdf',
    label: msg('Dark Appearance for PDFs'),
    run: () => updateSettings({ darkPdf: !settings.value.darkPdf }),
    checked: () => settings.value.darkPdf
  },
  { id: 'view.fullscreen', label: msg('Full Screen'), keys: ['F11'], run: () => platform.toggleFullscreen() },
  { id: 'view.slideshow', label: msg('Slideshow'), keys: ['Ctrl+Shift+F'], run: () => void (slideshow.value = true), enabled: hasDoc },
  { id: 'model.resetView', label: msg('Reset View'), run: () => void (model() && (model()!.viewRequest.value = { kind: 'reset' })) },
  { id: 'model.wireframe', label: msg('Wireframe'), keys: ['W'], run: () => void (model() && (model()!.wireframe.value = !model()!.wireframe.value)), checked: () => !!model()?.wireframe.value },
  { id: 'model.autoRotate', label: msg('Turntable'), keys: ['T'], run: () => void (model() && (model()!.autoRotate.value = !model()!.autoRotate.value)), checked: () => !!model()?.autoRotate.value },
  { id: 'model.shadow', label: msg('Ground Shadow'), run: () => void (model() && (model()!.shadow.value = !model()!.shadow.value)), checked: () => !!model()?.shadow.value },
  { id: 'model.grid', label: msg('Floor Grid'), run: () => void (model() && (model()!.grid.value = !model()!.grid.value)), checked: () => !!model()?.grid.value },
  ...(
    [
      ['front', msg('Front View')],
      ['back', msg('Back View')],
      ['left', msg('Left View')],
      ['right', msg('Right View')],
      ['top', msg('Top View')],
      ['bottom', msg('Bottom View')]
    ] as const
  ).map(([view, label]) => ({
    id: `model.view.${view}`,
    label,
    run: () => void (model() && (model()!.viewRequest.value = { kind: 'view', view }))
  })),
  { id: 'view.inspector', label: msg('Inspector'), keys: ['Ctrl+I'], run: () => void (inspectorOpen.value = !inspectorOpen.value), checked: () => inspectorOpen.value },
  { id: 'view.customizeToolbar', label: msg('Customize Toolbar…'), run: () => void (customizeOpen.value = true) },
  // Go
  { id: 'go.previous', label: msg('Previous Page'), keys: ['Ctrl+Up', 'PageUp'], run: () => goPage(-1), enabled: multiPage },
  { id: 'go.next', label: msg('Next Page'), keys: ['Ctrl+Down', 'PageDown'], run: () => goPage(1), enabled: multiPage },
  { id: 'go.first', label: msg('First Page'), keys: ['Home'], run: () => goPage('first'), enabled: multiPage },
  { id: 'go.last', label: msg('Last Page'), keys: ['End'], run: () => goPage('last'), enabled: multiPage },
  { id: 'go.page', label: msg('Go to Page…'), keys: ['Ctrl+Shift+G'], run: () => goToPagePrompt(), enabled: multiPage },
  { id: 'go.nextTab', label: msg('Next Tab'), keys: ['Ctrl+Tab'], run: () => cycleTab(1) },
  { id: 'go.previousTab', label: msg('Previous Tab'), keys: ['Ctrl+Shift+Tab'], run: () => cycleTab(-1) },
  // Tools
  {
    id: 'tools.markup',
    label: msg('Show Markup Toolbar'),
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
  { id: 'tools.select', label: msg('Select and Move'), keys: ['V'], run: () => pickTool(['select']), enabled: () => isPdf() || anyImage(), checked: () => tool.value === 'select' },
  { id: 'tools.hand', label: msg('Hand'), keys: ['H'], run: () => pickTool(['hand']), enabled: () => isPdf() || anyImage(), checked: () => tool.value === 'hand' },
  { id: 'tools.zoom', label: msg('Zoom Tool'), keys: ['Z'], run: () => pickTool(['zoom']), enabled: () => isPdf() || anyImage(), checked: () => tool.value === 'zoom' },
  { id: 'tools.marquee', label: msg('Rectangular / Elliptical Selection'), keys: ['M'], run: () => pickTool(['selectRect', 'selectEllipse']), enabled: isImage, checked: () => tool.value === 'selectRect' || tool.value === 'selectEllipse' },
  { id: 'tools.lasso', label: msg('Lasso / Smart Lasso'), keys: ['L'], run: () => pickTool(['lasso', 'smartLasso']), enabled: isImage, checked: () => tool.value === 'lasso' || tool.value === 'smartLasso' },
  { id: 'tools.brush', label: msg('Draw / Sketch'), keys: ['B'], run: () => pickTool(['draw', 'sketch']), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'draw' || tool.value === 'sketch' },
  { id: 'tools.shapes', label: msg('Shapes'), keys: ['U'], run: () => pickTool(SHAPE_TOOLS), enabled: () => isPdf() || isImage(), checked: () => SHAPE_TOOLS.includes(tool.value) },
  { id: 'tools.rectangle', label: msg('Rectangle'), keys: ['R'], run: () => pickTool(['rect']), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'rect' },
  { id: 'tools.oval', label: msg('Oval'), keys: ['O'], run: () => pickTool(['oval']), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'oval' },
  { id: 'tools.thinner', label: msg('Thinner Line'), keys: ['['], run: () => stepLine(-1), enabled: () => isPdf() || isImage() },
  { id: 'tools.thicker', label: msg('Thicker Line'), keys: [']'], run: () => stepLine(1), enabled: () => isPdf() || isImage() },
  { id: 'tools.highlight', label: msg('Highlight'), keys: ['Ctrl+Shift+H'], run: () => toggleTool('highlight'), enabled: isPdf, checked: () => tool.value === 'highlight' },
  { id: 'tools.text', label: msg('Add Text Box'), keys: ['T', 'Ctrl+Shift+T'], run: () => toggleTool('text'), enabled: () => isPdf() || isImage() },
  { id: 'tools.note', label: msg('Add Note'), keys: ['S', 'Ctrl+Shift+O'], run: () => toggleTool('note'), enabled: isPdf },
  { id: 'tools.signature', label: msg('Signature…'), keys: ['Ctrl+Shift+J'], run: () => void (signatureDialog.value = true), enabled: () => isPdf() || isImage() },
  { id: 'tools.ocr', label: msg('Recognize Text (OCR)…'), run: () => ocr.recognizePdfText(), enabled: isPdf },
  { id: 'tools.copyImageText', label: msg('Copy Text from Image'), run: () => ocr.copyImageText() },
  { id: 'tools.redactText', label: msg('Remove Sensitive Text…'), run: () => void (redactTextOpen.value = true), enabled: isPdf },
  { id: 'tools.redact', label: msg('Redact'), keys: ['Ctrl+Shift+R'], run: () => toggleTool('redact'), enabled: () => isPdf() || isImage(), checked: () => tool.value === 'redact' },
  { id: 'tools.applyRedactions', label: msg('Apply Redactions…'), run: () => void applyRedactions(), enabled: () => !!pdf()?.redactions.value.length },
  { id: 'tools.crop', label: msg('Crop to Selection'), keys: ['C', 'Ctrl+K'], run: () => void img.cropToSelection(image()!), enabled: isImage },
  { id: 'tools.instantAlpha', label: msg('Instant Alpha'), keys: ['W'], run: () => toggleTool('instantAlpha'), enabled: isImage, checked: () => tool.value === 'instantAlpha' },
  { id: 'tools.removeBackground', label: msg('Remove Background'), keys: ['Ctrl+Shift+K'], run: () => void img.removeBackground(image()!), enabled: isImage },
  { id: 'tools.copySubject', label: msg('Copy Subject'), run: () => void img.copySubject(image()!), enabled: isImage },
  { id: 'tools.adjustColor', label: msg('Adjust Color…'), keys: ['Ctrl+Shift+C'], run: () => void (adjustColorOpen.value = true), enabled: isImage },
  { id: 'tools.adjustSize', label: msg('Adjust Size…'), keys: ['Ctrl+Shift+U'], run: () => void (adjustSizeOpen.value = true), enabled: isImage },
  {
    id: 'tools.straighten',
    label: msg('Straighten…'),
    keys: ['Ctrl+Shift+L'],
    run: () => {
      if (tool.peek() !== 'select') setTool('select')
      imageSelection.value = null
      adjustColorOpen.value = false
      straighten.value = { angle: 0, crop: true }
    },
    enabled: isImage,
    checked: () => !!straighten.value
  },
  { id: 'tools.flipHorizontal', label: msg('Flip Horizontal'), run: () => void img.flipImage(image()!, 'horizontal'), enabled: isImage },
  { id: 'tools.flipVertical', label: msg('Flip Vertical'), run: () => void img.flipImage(image()!, 'vertical'), enabled: isImage },
  { id: 'tools.rotateLeft', label: msg('Rotate Left'), keys: ['Ctrl+L'], run: () => actions.rotatePages(-90), enabled: hasDoc },
  { id: 'tools.rotateRight', label: msg('Rotate Right'), keys: ['Ctrl+R'], run: () => actions.rotatePages(90), enabled: hasDoc },
  // Help
  {
    id: 'help.updates',
    label: msg('Check for Updates…'),
    run: async () => {
      const r = await checkForUpdates({ force: true })
      if (r === 'current') toast(t('Glance is up to date'))
      else if (r === 'error') toast(t('Couldn’t reach GitHub to check for updates'), 'error')
      else if (r === 'off') toast(t('Update checks are available in the Windows app'))
    }
  },
  { id: 'help.about', label: msg('About Glance'), run: actions.showAbout },
  { id: 'help.github', label: msg('Glance on GitHub'), run: () => platform.openUrl('https://github.com/RedtRocks/glance') }
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
  [() => activeDoc.value?.kind === 'model', ['model.wireframe', 'model.autoRotate', 'model.resetView', 'model.shadow', 'model.grid', 'model.view.front', 'model.view.back', 'model.view.left', 'model.view.right', 'model.view.top', 'model.view.bottom']],
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
    'tools.adjustSize', 'tools.straighten', 'tools.flipHorizontal', 'tools.flipVertical'
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

/** A tooltip with the command’s first shortcut, e.g. "Text box (T)". Pass `label` already translated. */
export function tip(label: string, id?: string): string {
  const k = id ? keysFor(id)[0] : undefined
  return k ? t('{label} ({shortcut})', { label, shortcut: displayCombo(k) }) : label
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

function toggleTool(next: Parameters<typeof setTool>[0]): void {
  setTool(tool.peek() === next ? 'select' : next)
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
  const fallback = t('Page {page}', { page: page + 1 })
  const label = await promptText(t('Add Bookmark'), t('Name'), { initial: fallback, ok: t('Add') })
  if (label === null) return
  setBookmarks(path, [...bookmarksFor(path).filter((b) => b.page !== page), { page, label: label || fallback, created: Date.now() }])
}

async function goToPagePrompt(): Promise<void> {
  const d = activeDoc.value
  if (!d || d.kind === 'notice') return
  const text = await promptText(t('Go to Page'), t('Page number (1–{count})', { count: d.pageCount.value }), { ok: t('Go') })
  if (text == null) return
  const idx = parsePageInput(text, d.pageCount.value)
  if (idx === null) return
  if (d.kind === 'pdf') d.goTo(idx)
  else d.current.value = idx
}
