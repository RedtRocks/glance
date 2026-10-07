; Glance installer hooks (Tauri NSIS).
; - Adds Glance to Explorer's "Send to" menu, so any selection of files can be opened as
;   tabs in one go.
; - Adds classic right-click verbs: Open in Glance, Combine into PDF and Remove Location
;   Info. On Windows 11 they appear under "Show more options"; the top-level menu needs a
;   package identity, which only the Store package has (ADR 0009). The location types are
;   checked against scripts/packaging.ts by tests/packaging.test.ts. Explorer runs a verb once per selected file; Glance gathers
;   the launches into one request (src-tauri/src/explorer.rs).
; - Registers Glance for Settings > Apps > Default apps and "Open with"
;   (default-apps.nsh, generated from tauri.conf.json), keeping Explorer's thumbnails.
; - Installs glance-mcp.exe, which lets AI apps use Glance.
; Everything goes under HKCU, matching the per-user install.

!define GLANCE_HANDLERS "Software\Glance\Handlers"
!define GLANCE_THUMBNAIL "{e357fccd-a995-4576-b01f-234630154e96}"
!define GLANCE_PREVIEW "{8895b1c6-b41f-4c1c-a562-0d564250836f}"

; Explorer looks for a file's thumbnail and Preview pane handlers under the default app's
; ProgID first, then under the extension and SystemFileAssociations. Some apps (Adobe
; Acrobat, Edge for PDFs, ...) register theirs only under their own ProgID, so with Glance
; as the default those files showed Glance's icon instead of their content. When .${EXT}
; has no handler outside a ProgID, this copies the one from the previous default (the
; user's choice, the class Tauri's association replaced, or the system's) to the
; extension, where it works whichever app opens the file. Recorded for uninstall.
!macro GLANCE_KEEP_HANDLER EXT TAURICLASS GUID
  Push $0
  Push $1
  ReadRegStr $0 HKCR ".${EXT}\ShellEx\${GUID}" ""
  ${If} $0 == ""
    ReadRegStr $0 HKCR "SystemFileAssociations\.${EXT}\ShellEx\${GUID}" ""
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $1 HKCR ".${EXT}" "PerceivedType"
    ${If} $1 != ""
      ReadRegStr $0 HKCR "SystemFileAssociations\$1\ShellEx\${GUID}" ""
    ${EndIf}
  ${EndIf}
  ; Found above: Explorer already falls back to it.
  ${If} $0 == ""
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\UserChoice" "ProgId"
    ${If} $1 != ""
      ReadRegStr $0 HKCR "$1\ShellEx\${GUID}" ""
    ${EndIf}
    ${If} $0 == ""
      ReadRegStr $1 HKCU "Software\Classes\.${EXT}" "${TAURICLASS}_backup"
      ${If} $1 != ""
        ReadRegStr $0 HKCR "$1\ShellEx\${GUID}" ""
      ${EndIf}
    ${EndIf}
    ${If} $0 == ""
      ReadRegStr $1 HKLM "Software\Classes\.${EXT}" ""
      ${If} $1 != ""
        ReadRegStr $0 HKCR "$1\ShellEx\${GUID}" ""
      ${EndIf}
    ${EndIf}
    ${If} $0 != ""
      WriteRegStr HKCU "Software\Classes\.${EXT}\ShellEx\${GUID}" "" $0
      WriteRegStr HKCU "${GLANCE_HANDLERS}" ".${EXT} ${GUID}" $0
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

; Tauri's association creates HKCU\Software\Classes\.${EXT}, which hides the system's
; values for that key in HKEY_CLASSES_ROOT, among them PerceivedType. Without it Explorer
; can't find the image thumbnailer under SystemFileAssociations\image, and photos showed
; Glance's icon. Copies PerceivedType and Content Type back from the machine key, or uses
; ${PERCEIVED} when Windows has none (camera RAW without the RAW extension).
!macro GLANCE_KEEP_TYPE EXT PERCEIVED
  Push $0
  Push $1
  ReadRegStr $0 HKCU "Software\Classes\.${EXT}" "PerceivedType"
  ${If} $0 == ""
    ReadRegStr $0 HKLM "Software\Classes\.${EXT}" "PerceivedType"
    ${IfThen} $0 == "" ${|} StrCpy $0 "${PERCEIVED}" ${|}
    ${If} $0 != ""
      WriteRegStr HKCU "Software\Classes\.${EXT}" "PerceivedType" $0
      WriteRegStr HKCU "${GLANCE_HANDLERS}" ".${EXT} PerceivedType" $0
    ${EndIf}
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Classes\.${EXT}" "Content Type"
  ReadRegStr $1 HKLM "Software\Classes\.${EXT}" "Content Type"
  ${If} $0 == ""
  ${AndIf} $1 != ""
    WriteRegStr HKCU "Software\Classes\.${EXT}" "Content Type" $1
    WriteRegStr HKCU "${GLANCE_HANDLERS}" ".${EXT} Content Type" $1
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro GLANCE_KEEP_HANDLERS EXT TAURICLASS PERCEIVED
  !insertmacro GLANCE_KEEP_TYPE "${EXT}" "${PERCEIVED}"
  !insertmacro GLANCE_KEEP_HANDLER "${EXT}" "${TAURICLASS}" "${GLANCE_THUMBNAIL}"
  !insertmacro GLANCE_KEEP_HANDLER "${EXT}" "${TAURICLASS}" "${GLANCE_PREVIEW}"
!macroend

; Removes a handler GLANCE_KEEP_HANDLER copied, unless it has been changed since.
!macro GLANCE_DROP_HANDLER EXT GUID
  Push $0
  Push $1
  ReadRegStr $0 HKCU "${GLANCE_HANDLERS}" ".${EXT} ${GUID}"
  ReadRegStr $1 HKCU "Software\Classes\.${EXT}\ShellEx\${GUID}" ""
  ${If} $0 != ""
  ${AndIf} $0 == $1
    DeleteRegKey HKCU "Software\Classes\.${EXT}\ShellEx\${GUID}"
    DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\ShellEx"
  ${EndIf}
  Pop $1
  Pop $0
!macroend

; Removes a value GLANCE_KEEP_TYPE copied, unless it has been changed since.
!macro GLANCE_DROP_TYPE EXT NAME
  Push $0
  Push $1
  ReadRegStr $0 HKCU "${GLANCE_HANDLERS}" ".${EXT} ${NAME}"
  ReadRegStr $1 HKCU "Software\Classes\.${EXT}" "${NAME}"
  ${If} $0 != ""
  ${AndIf} $0 == $1
    DeleteRegValue HKCU "Software\Classes\.${EXT}" "${NAME}"
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro GLANCE_DROP_HANDLERS EXT
  !insertmacro GLANCE_DROP_TYPE "${EXT}" "PerceivedType"
  !insertmacro GLANCE_DROP_TYPE "${EXT}" "Content Type"
  !insertmacro GLANCE_DROP_HANDLER "${EXT}" "${GLANCE_THUMBNAIL}"
  !insertmacro GLANCE_DROP_HANDLER "${EXT}" "${GLANCE_PREVIEW}"
!macroend

!include "${__FILEDIR__}\default-apps.nsh"

; Glance's thumbnail handler (src-tauri/thumbnailer, built by scripts/thumbnailer.mjs):
; Explorer shows the contents of PDFs, camera RAW, XPS, EPS, comics and the image types
; Windows can't preview, instead of Glance's icon. default-apps.nsh lists the types; each
; has its own CLSID. It's used on Glance's PDF ProgIDs, and on an extension only when
; nothing else registered a thumbnailer for it (recorded so uninstall removes only that).
!define GLANCE_THUMB_DLL "glance_thumbnailer.dll"
; Macros expand where they are inserted, so capture this file's folder now.
!define GLANCE_HOOKS_DIR "${__FILEDIR__}"

!macro GLANCE_THUMBNAILER_FOR EXT CLSID
  Push $0
  ; The installer is 32-bit, and CLSID is one of the keys WOW64 redirects; Explorer
  ; reads the native view.
  SetRegView 64
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}" "" "Glance Thumbnails (.${EXT})"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "" "$INSTDIR\${GLANCE_THUMB_DLL}"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  SetRegView default
  ReadRegStr $0 HKCR ".${EXT}\ShellEx\${GLANCE_THUMBNAIL}" ""
  ${If} $0 == ""
    ReadRegStr $0 HKCR "SystemFileAssociations\.${EXT}\ShellEx\${GLANCE_THUMBNAIL}" ""
  ${EndIf}
  ${If} $0 == ""
    WriteRegStr HKCU "Software\Classes\.${EXT}\ShellEx\${GLANCE_THUMBNAIL}" "" "${CLSID}"
    WriteRegStr HKCU "${GLANCE_HANDLERS}" ".${EXT} ${GLANCE_THUMBNAIL}" "${CLSID}"
  ${EndIf}
  Pop $0
!macroend

!macro GLANCE_THUMBNAILER_NOT_FOR EXT CLSID
  SetRegView 64
  DeleteRegKey HKCU "Software\Classes\CLSID\${CLSID}"
  SetRegView default
!macroend

!macro GLANCE_THUMB_ON_CLASS CLASS CLSID
  WriteRegStr HKCU "Software\Classes\${CLASS}\ShellEx\${GLANCE_THUMBNAIL}" "" "${CLSID}"
!macroend

!macro GLANCE_THUMBNAILER_INSTALL
  ; A DLL Explorer has loaded can be renamed but not overwritten.
  Delete "$INSTDIR\${GLANCE_THUMB_DLL}.old"
  Rename "$INSTDIR\${GLANCE_THUMB_DLL}" "$INSTDIR\${GLANCE_THUMB_DLL}.old"
  SetOutPath "$INSTDIR"
  File "${GLANCE_HOOKS_DIR}\..\target\thumbnailer\${GLANCE_THUMB_DLL}"
  Delete /REBOOTOK "$INSTDIR\${GLANCE_THUMB_DLL}.old"
  !insertmacro GLANCE_THUMBNAILS_REGISTER
  !insertmacro GLANCE_THUMB_ON_CLASS "Glance.PDFDocument" "{4d578e19-3f31-49d8-8d05-706466000000}"
  !insertmacro GLANCE_THUMB_ON_CLASS "PDF Document" "{4d578e19-3f31-49d8-8d05-706466000000}"
  !insertmacro GLANCE_THUMB_ON_CLASS "Glance.IllustratorDocument" "{4d578e19-3f31-49d8-8d05-616900000000}"
  !insertmacro GLANCE_THUMB_ON_CLASS "Illustrator Document" "{4d578e19-3f31-49d8-8d05-616900000000}"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro GLANCE_THUMBNAILER_UNINSTALL
  !insertmacro GLANCE_THUMBNAILS_UNREGISTER
  Delete /REBOOTOK "$INSTDIR\${GLANCE_THUMB_DLL}"
  Delete /REBOOTOK "$INSTDIR\${GLANCE_THUMB_DLL}.old"
!macroend

; glance-mcp.exe (src-tauri/mcp-bridge, built by scripts/mcp-bridge.mjs): the program AI
; apps start to use Glance (Settings > AI apps adds it to their MCP settings). An AI app
; may be running it, and a running program can be renamed but not overwritten.
!define GLANCE_MCP_EXE "glance-mcp.exe"

!macro GLANCE_MCP_INSTALL
  Delete "$INSTDIR\${GLANCE_MCP_EXE}.old"
  Rename "$INSTDIR\${GLANCE_MCP_EXE}" "$INSTDIR\${GLANCE_MCP_EXE}.old"
  SetOutPath "$INSTDIR"
  File "${GLANCE_HOOKS_DIR}\..\target\mcp-bridge\${GLANCE_MCP_EXE}"
  Delete /REBOOTOK "$INSTDIR\${GLANCE_MCP_EXE}.old"
!macroend

!macro GLANCE_MCP_UNINSTALL
  Delete /REBOOTOK "$INSTDIR\${GLANCE_MCP_EXE}"
  Delete /REBOOTOK "$INSTDIR\${GLANCE_MCP_EXE}.old"
!macroend

!define GLANCE_SFA "Software\Classes\SystemFileAssociations"

; Adds verb ${ID} labelled ${LABEL} to ${TYPE} (".pdf", or "image" for every image type
; Windows knows), running Glance with ${FLAGS} before the file.
!macro GLANCE_VERB TYPE ID LABEL FLAGS
  WriteRegStr HKCU "${GLANCE_SFA}\${TYPE}\shell\${ID}" "" "${LABEL}"
  WriteRegStr HKCU "${GLANCE_SFA}\${TYPE}\shell\${ID}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${GLANCE_SFA}\${TYPE}\shell\${ID}" "MultiSelectModel" "Player"
  WriteRegStr HKCU "${GLANCE_SFA}\${TYPE}\shell\${ID}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" ${FLAGS}"%1"'
!macroend

!macro GLANCE_UNVERB TYPE ID
  DeleteRegKey HKCU "${GLANCE_SFA}\${TYPE}\shell\${ID}"
!macroend

; Formats whose location info Glance can remove (src-tauri/src/metadata.rs).
!macro GLANCE_LOCATION_TYPES M
  !insertmacro ${M} ".jpg"
  !insertmacro ${M} ".jpeg"
  !insertmacro ${M} ".jfif"
  !insertmacro ${M} ".png"
  !insertmacro ${M} ".tif"
  !insertmacro ${M} ".tiff"
  !insertmacro ${M} ".webp"
  !insertmacro ${M} ".heic"
  !insertmacro ${M} ".heif"
  !insertmacro ${M} ".jxl"
!macroend

!macro GLANCE_LOCATION_VERB TYPE
  !insertmacro GLANCE_VERB "${TYPE}" "Glance.RemoveLocation" "Remove Location Info" "--remove-location "
!macroend

!macro GLANCE_LOCATION_UNVERB TYPE
  !insertmacro GLANCE_UNVERB "${TYPE}" "Glance.RemoveLocation"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$APPDATA\Microsoft\Windows\SendTo\Glance.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro GLANCE_DEFAULT_APPS_REGISTER
  !insertmacro GLANCE_THUMBNAILER_INSTALL
  !insertmacro GLANCE_MCP_INSTALL

  !insertmacro GLANCE_VERB ".pdf" "Glance.Open" "Open in Glance" ""
  !insertmacro GLANCE_VERB "image" "Glance.Open" "Open in Glance" ""
  !insertmacro GLANCE_VERB ".pdf" "Glance.Combine" "Combine into PDF" "--combine-pdf "
  !insertmacro GLANCE_VERB "image" "Glance.Combine" "Combine into PDF" "--combine-pdf "
  !insertmacro GLANCE_LOCATION_TYPES GLANCE_LOCATION_VERB
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$APPDATA\Microsoft\Windows\SendTo\Glance.lnk"
  ; An update reinstalls straight after, so keep the registration and the user's
  ; default app choices pointing at Glance's ProgIDs.
  ${If} $UpdateMode <> 1
    !insertmacro GLANCE_DEFAULT_APPS_UNREGISTER
    !insertmacro GLANCE_THUMBNAILER_UNINSTALL
    !insertmacro GLANCE_MCP_UNINSTALL
  ${EndIf}

  !insertmacro GLANCE_UNVERB ".pdf" "Glance.Open"
  !insertmacro GLANCE_UNVERB "image" "Glance.Open"
  !insertmacro GLANCE_UNVERB ".pdf" "Glance.Combine"
  !insertmacro GLANCE_UNVERB "image" "Glance.Combine"
  !insertmacro GLANCE_LOCATION_TYPES GLANCE_LOCATION_UNVERB
!macroend
