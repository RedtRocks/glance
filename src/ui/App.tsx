import { useEffect } from 'preact/hooks'
import { activeDoc, activeId, docs, findByPath } from '../state/documents'
import { isDark, settings } from '../state/settings'
import { cleanupOpen, collageOpen, reduceOpen, scanOpen, stampOpen, customizeOpen, inspectorOpen, narrowWindow, signaturesOpen, redactTextOpen, findOpen, settingsOpen, sidebarVisible, slideshow } from '../state/ui'
import { confirmCloseWindow, openFiles } from '../state/actions'
import { startAutosave } from '../state/autosave'
import { restoreSession } from '../state/session'
import { handleShellRequest } from '../state/shellActions'
import { checkForUpdates } from '../state/updates'
import { UpdateBar } from './UpdateBar'
import { DefaultAppBar } from './DefaultAppBar'
import { offerDefaultApp } from '../state/defaultApp'
import * as platform from '../platform'
import { startWebApp } from '../platform/webApp'
import { WebNav } from './web/WebNav'
import { WebWelcome } from './web/WebWelcome'
import { PageCounter, PhoneBar, PhoneDock, PhoneSearch, PhoneSheets } from './web/PhoneShell'
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
import { SignatureBar } from './SignatureBar'
import { SignaturesPane } from './SignaturesPane'
import { signatureDialog } from '../state/markupState'
import { adjustColorOpen, adjustSizeOpen, exportOpen, imageSelection } from '../state/imageState'
import { ImageDoc, PdfDoc } from '../state/documents'
import { RedactTextDialog } from './dialogs/RedactTextDialog'
import { CleanupDialog } from './dialogs/CleanupDialog'
import { ReduceDialog } from './dialogs/ReduceDialog'
import { StampDialog } from './dialogs/StampDialog'
import { ScanDialog } from './dialogs/ScanDialog'
import { PdfExportDialog } from './dialogs/PdfExportDialog'
import { AdjustColorPanel } from './image/AdjustColorPanel'
import { AdjustSizeDialog } from './image/AdjustSizeDialog'
import { ExportDialog } from './image/ExportDialog'

function Viewer() {
  const doc = activeDoc.value
  if (!doc) return platform.isWeb ? <WebWelcome /> : <Welcome />
  const phone = platform.isWeb && narrowWindow.value
  return (
    <div class="workspace">
      {sidebarVisible.value && !phone && <Sidebar key={doc.id} doc={doc} />}
      {/* Over the document on a phone: tapping the document puts it away again. */}
      {sidebarVisible.value && narrowWindow.value && !phone && <div class="scrim" onClick={() => (sidebarVisible.value = false)} />}
      <main class="viewer" aria-label={doc.name.value}>
        {(doc.kind === 'pdf' || doc.kind === 'image') && <RedactionBar doc={doc} />}
        <ExternalAppBar key={doc.id} doc={doc} />
        <ConflictBar doc={doc} />
        {doc.kind === 'pdf' && <SignatureBar key={doc.id} doc={doc} />}
        <div class="viewer-stage">
          {doc.kind === 'pdf' && <PdfView key={doc.id} doc={doc} />}
          {doc.kind === 'image' && <ImageView key={doc.id} doc={doc} />}
          {doc.kind === 'notice' && <NoticeView doc={doc} />}
          {doc.kind === 'model' && <ModelView key={doc.id} doc={doc} />}
        </div>
        {phone && <PageCounter doc={doc} />}
        {phone && <PhoneDock doc={doc} />}
      </main>
      {doc instanceof ImageDoc && doc.editable && adjustColorOpen.value && <AdjustColorPanel key={doc.id} doc={doc} />}
      {inspectorOpen.value && doc.kind !== 'notice' && <InspectorPane key={doc.id} doc={doc} />}
      {signaturesOpen.value && doc.kind === 'pdf' && <SignaturesPane key={doc.id} doc={doc} />}
    </div>
  )
}

export function App() {
  useShortcuts()
  useFileDrop()

  // Phones show the sidebar and the side panels over the document (see app.css).
  useEffect(() => {
    const narrow = matchMedia('(max-width: 700px)')
    const update = (): void => {
      if (narrow.matches === narrowWindow.peek()) return
      narrowWindow.value = narrow.matches
      sidebarVisible.value = !narrow.matches
    }
    narrow.addEventListener('change', update)
    return () => narrow.removeEventListener('change', update)
  }, [])

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
    // Last session's tabs first, so a file Glance was launched with ends up in front.
    let stopSession: (() => void) | undefined
    void restoreSession()
      .catch((e) => (console.error(e), () => {}))
      .then((stop) => {
        stopSession = stop
        return platform.initialFiles()
      })
      .then((files) => openFiles([...hashFiles, ...files]))
    let dispose: (() => void) | undefined
    void platform.onOpenFiles((paths) => void openFiles(paths)).then((d) => (dispose = d))
    let unshell: (() => void) | undefined
    void platform.onShellRequest((r) => void handleShellRequest(r)).then((d) => (unshell = d))
    void platform.showWindow()
    // Files the operating system hands to the installed web app (Open with, Share).
    startWebApp((paths) => void openFiles(paths))
    const stopAutosave = startAutosave()
    // A few seconds after start, so it never competes with opening files.
    const updateTimer = window.setTimeout(() => void checkForUpdates(), 5000)
    const defaultAppTimer = window.setTimeout(() => void offerDefaultApp(), 3000)
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
      unshell?.()
      unguard?.()
      stopAutosave()
      stopSession?.()
      unactivate?.()
      clearTimeout(updateTimer)
      clearTimeout(defaultAppTimer)
    }
  }, [])

  // Window title follows the active document (Windows shows it in the taskbar).
  const doc = activeDoc.value
  const phone = platform.isWeb && narrowWindow.value
  useEffect(() => {
    imageSelection.value = null
    adjustColorOpen.value = false
  }, [doc?.id])
  useEffect(() => {
    const name = doc?.name.value
    // i18n-ignore: Windows' "file - App" title format and the product name aren't translated
    void platform.setWindowTitle(name ? `${doc?.dirty.value ? '• ' : ''}${name} - Glance` : 'Glance')
  }, [doc, doc?.name.value, doc?.dirty.value])

  return (
    <div class={`app ${fileDragOver.value ? 'file-drag' : ''}`}>
      {phone ? (
        doc && (
          <header class="chrome">
            <PhoneBar doc={doc} />
            {findOpen.value && <PhoneSearch doc={doc} />}
          </header>
        )
      ) : (
        <header class="chrome">
          {platform.isWeb ? <WebNav /> : docs.value.length > 0 && <TabStrip />}
          {(!platform.isWeb || doc) && (
            <div class="commandbar">
              <MenuBar />
              <Toolbar />
            </div>
          )}
          <MarkupToolbar />
          <UpdateBar />
          <DefaultAppBar />
        </header>
      )}
      <Viewer />
      {/* On a phone the markup tools sit at the bottom, under the thumb. */}
      {phone && <MarkupToolbar />}
      {phone && <PhoneSheets />}
      {slideshow.value && <Slideshow />}
      {settingsOpen.value && <SettingsDialog />}
      {customizeOpen.value && <CustomizeToolbar />}
      {signatureDialog.value && <SignatureDialog />}
      {activeDoc.value instanceof ImageDoc && adjustSizeOpen.value && <AdjustSizeDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && redactTextOpen.value && <RedactTextDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && cleanupOpen.value && <CleanupDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && reduceOpen.value && <ReduceDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && stampOpen.value && <StampDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof ImageDoc && exportOpen.value && <ExportDialog doc={activeDoc.value} />}
      {activeDoc.value instanceof PdfDoc && exportOpen.value && <PdfExportDialog doc={activeDoc.value} />}
      <DialogHost />
      <Toasts />
      <ContextMenu />
      {batchOpen.value && <BatchDialog />}
      {collageOpen.value && <CollageDialog />}
      {scanOpen.value && <ScanDialog />}
      {versionsOpen.value && activeDoc.value && <VersionsDialog key={activeDoc.value.id} doc={activeDoc.value} />}
    </div>
  )
}
