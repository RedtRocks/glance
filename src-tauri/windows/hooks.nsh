; Glance installer hooks (Tauri NSIS).
; - Adds Glance to Explorer's "Send to" menu, so any selection of files can be opened as
;   tabs in one go.
; - Adds classic right-click verbs: Open in Glance, Combine into PDF and Remove Location
;   Info. On Windows 11 they appear under "Show more options"; the top-level menu needs a
;   signed package (ADR 0009). Explorer runs a verb once per selected file; Glance gathers
;   the launches into one request (src-tauri/src/explorer.rs).
; - Registers Glance for Settings > Apps > Default apps and "Open with"
;   (default-apps.nsh, generated from tauri.conf.json).
; Everything goes under HKCU, matching the per-user install.

!include "${__FILEDIR__}\default-apps.nsh"

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
  ${EndIf}

  !insertmacro GLANCE_UNVERB ".pdf" "Glance.Open"
  !insertmacro GLANCE_UNVERB "image" "Glance.Open"
  !insertmacro GLANCE_UNVERB ".pdf" "Glance.Combine"
  !insertmacro GLANCE_UNVERB "image" "Glance.Combine"
  !insertmacro GLANCE_LOCATION_TYPES GLANCE_LOCATION_UNVERB
!macroend
