import { useEffect } from 'preact/hooks'
import { activeDoc, activeId, docs, findByPath } from '../state/documents'
import { isDark, settings } from '../state/settings'
import { cleanupOpen, collageOpen, customizeOpen, inspectorOpen, redactTextOpen, settingsOpen, sidebarVisible, slideshow } from '../state/ui'
import { confirmCloseWindow, openFiles } from '../state/actions'
import { startAutosave } from '../state/autosave'
import { checkForUpdates } from '../state/updates'
import { UpdateBar } from './UpdateBar'
import * as platform from '../platform'
import { MenuBar } from './MenuBar'
import { TabStrip } from './TabStrip'
import { Toolbar } from './Toolbar'
import { Sidebar } from './sidebar/Sidebar'
import { PdfView } from './views/PdfView'
import { ImageView } from './views/ImageView'
import { NoticeView } from './views/NoticeView'
import { ModelView } from './views/ModelView'
import { Welcome } from './views/Welcome'
import { Slideshow } from './views/Slideshow'
import { DialogHost } from './dialogs/Dialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { CustomizeToolbar } from './dialogs/CustomizeToolbar'
import { Toasts } from './Toasts'
import { ContextMenu } from './ContextMenu'
import { BatchDialog } from './dialogs/BatchDialog'
import { CollageDialog } from './dialogs/CollageDialog'
import { VersionsDialog } from './dialogs/VersionsDialog'
import { versionsOpen } from '../state/versions'
import { batchOpen } from '../state/batch'
import { useShortcuts } from './useShortcuts'
import { useFileDrop } from './useFileDrop'
import { fileDragOver } from './dragState'
import { MarkupToolbar } from './markup/MarkupToolbar'
import { SignatureDialog } from './markup/SignatureDialog'
import { RedactionBar } from './RedactionBar'
import { ExternalAppBar } from './ExternalAppBar'
import { InspectorPane } from './InspectorPane'
import { ConflictBar } from './ConflictBar'
import { signatureDialog } from '../state/markupState'
import { adjustColorOpen, adjustSizeOpen, exportOpen, imageSelection } from '../state/imageState'
import { ImageDoc, PdfDoc } from '../state/documents'
import { RedactTextDialog } from './dialogs/RedactTextDialog'
import { CleanupDialog } from './dialogs/CleanupDialog'
import { PdfExportDialog } from './dialogs/PdfExportDialog'
import { AdjustColorPanel } from './image/AdjustColorPanel'
import { AdjustSizeDialog } from './image/AdjustSizeDialog'
import { ExportDialog } from './image/ExportDialog'

function Viewer() {
  const doc = activeDoc.value
  if (!doc) return <Welcome />
  return (
    <div class="workspace">
      {sidebarVisible.value && <Sidebar key={doc.id} doc={doc} />}
      <main class="viewer" aria-label={doc.name.value}>
        {doc.kind === 'pdf' && <RedactionBar doc={doc} />}
        <ExternalAppBar key={doc.id} doc={doc} />
        <ConflictBar doc={doc} />
        <div class="viewer-stage">
          {doc.kind === 'pdf' && <PdfView key={doc.id} doc={doc} />}
          {doc.kind === 'image' && <ImageView key={doc.id} doc={doc} />}
          {doc.kind === 'notice' && <NoticeView doc={doc} />}
          {doc.kind === 'model' && <ModelView key={doc.id} doc={doc} />}
        </div>
      </main>
      {doc instanceof ImageDoc && doc.editable && adjustColorOpen.value && <AdjustColorPanel key={doc.id} doc={doc} />}
      {inspectorOpen.value && doc.kind !== 'notice' && <InspectorPane key={doc.id} doc={doc} />}
    </div>
  )
}

export function App() {
  useShortcuts()
  useFileDrop()

  // Theme + window material.
  const dark = isDark()
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark, settings.value.theme])

  // Files from the command line (Open with, Send to), later launches, and new windows.
  useEffect(() => {
    void platform.windowMaterial().then((m) => (document.documentElement.dataset.material = m))
    const fromHash = /open=([^&]+)/.exec(location.hash)
    const hashFiles: string[] = fromHash ? JSON.parse(decodeURIComponent(fromHash[1])) : []
    void platform.initialFiles().then((files) => openFiles([...hashFiles, ...files]))
    let dispose: (() => void) | undefined
    void platform.onOpenFiles((paths) => void openFiles(paths)).then((d) => (dispose = d))
    void platform.showWindow()
    const stopAutosave = startAutosave()
    // A few seconds after start, so it never competes with opening files.
    const updateTimer = window.setTimeout(() => void checkForUpdates(), 5000)
    // Another window asked us to show a file this window already has open.
    let unactivate: (() => void) | undefined
    void platform
      .onActivateFile((path) => {
        const d = findByPath(path)
        if (d) activeId.value = d.id
      })
      .then((u) => (unactivate = u))
    let unguard: (() => void) | undefined
    void platform
      .onCloseRequested(confirmCloseWindow, () => docs.peek().some((d) => d.dirty.peek()))
      .then((u) => (unguard = u))
    return () => {
      dispose?.()
      unguard?.()
      stopAutosave()
      unactivate?.()
      clearTimeout(updateTimer)
    }
  }, [])

  // Window title follows the active document (Windows shows it in the taskbar).
  const doc = activeDoc.value
  useEffect(() => {
    imageSelection.value = null
    adjustColorOpen.value = false
  }, [doc?.id])
  useEffect(() => {
    const name = doc?.name.value
    void platform.setWindowTitle(name ? `${doc?.dirty.value ? '• ' : ''}${name} - Glance` : 'Glance')
  }, [doc, doc?.name.value, doc?.dirty.value])

  return (
    <div class={`app ${fileDragOver.value ? 'file-drag' : ''}`}>
      <header class="chrome">
        {docs.value.length > 0 && <TabStrip />}
        <div class="commandbar">
          <MenuBar />
          <Toolbar />
        </div>
        <MarkupToolbar />
        <UpdateBar />
      </header>
      <Viewer />
      {slideshow.value && <Slideshow />}
      {settingsOpen.value && <SettingsDialog />}
      {customizeOpen.value && <CustomizeToolbar />}
      {signatureDialog.value && <SignatureDialog />}
      {activeDoc.value instanceof ImageDoc && adjustSizeOpen.value && <AdjustSizeDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && redactTextOpen.value && <RedactTextDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && cleanupOpen.value && <CleanupDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof ImageDoc && exportOpen.value && <ExportDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && exportOpen.value && <PdfExportDialog doc={activeDoc.value} />}
      <DialogHost />
      <Toasts />
      <ContextMenu />
      {batchOpen.value && <BatchDialog />}
      {collageOpen.value && <CollageDialog />}
      {versionsOpen.value && activeDoc.value && <VersionsDialog key={activeDoc.value.id} doc={activeDoc.value} />}
    </div>
  )
}
