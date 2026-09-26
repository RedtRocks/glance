import { useEffect } from 'preact/hooks'
import { activeDoc, docs } from '../state/documents'
import { isDark, settings } from '../state/settings'
import { customizeOpen, settingsOpen, sidebarVisible, slideshow } from '../state/ui'
import { openFiles } from '../state/actions'
import * as platform from '../platform'
import { MenuBar } from './MenuBar'
import { TabStrip } from './TabStrip'
import { Toolbar } from './Toolbar'
import { Sidebar } from './sidebar/Sidebar'
import { PdfView } from './views/PdfView'
import { ImageView } from './views/ImageView'
import { NoticeView } from './views/NoticeView'
import { Welcome } from './views/Welcome'
import { Slideshow } from './views/Slideshow'
import { DialogHost } from './dialogs/Dialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { CustomizeToolbar } from './dialogs/CustomizeToolbar'
import { Toasts } from './Toasts'
import { useShortcuts } from './useShortcuts'
import { useFileDrop } from './useFileDrop'
import { fileDragOver } from './dragState'

function Viewer() {
  const doc = activeDoc.value
  if (!doc) return <Welcome />
  return (
    <div class="workspace">
      {sidebarVisible.value && <Sidebar doc={doc} />}
      <main class="viewer" aria-label={doc.name.value}>
        {doc.kind === 'pdf' && <PdfView key={doc.id} doc={doc} />}
        {doc.kind === 'image' && <ImageView key={doc.id} doc={doc} />}
        {doc.kind === 'notice' && <NoticeView doc={doc} />}
      </main>
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
    return () => dispose?.()
  }, [])

  // Window title follows the active document (Windows shows it in the taskbar).
  const doc = activeDoc.value
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
      </header>
      <Viewer />
      {slideshow.value && <Slideshow />}
      {settingsOpen.value && <SettingsDialog />}
      {customizeOpen.value && <CustomizeToolbar />}
      <DialogHost />
      <Toasts />
    </div>
  )
}
