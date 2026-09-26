; Glance installer hooks (Tauri NSIS). Adds Glance to Explorer's "Send to" menu,
; so any selection of files can be opened as tabs in one go.

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$APPDATA\Microsoft\Windows\SendTo\Glance.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$APPDATA\Microsoft\Windows\SendTo\Glance.lnk"
!macroend
