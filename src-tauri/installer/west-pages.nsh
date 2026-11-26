; ═══════════════════════════════════════════════════════════════════════════
;  West Client kurulum sihirbazı — sayfalar
;  build-template.py bunu installer.nsi'de "Installation page"den hemen önce ekler
;  ($AppStartMenuFolder tanımlandıktan sonra).
; ═══════════════════════════════════════════════════════════════════════════

!define __WEST_PFX ""

; ── 1. Kur: başlık, kurulum yeri, masaüstü kısayolu, Kur düğmesi ──
Function WestMainPage
  Call SkipIfPassive
  ${IfThen} $WestDesktop == "" ${|} StrCpy $WestDesktop 1 ${|}
  nsDialogs::Create 1018
  Pop $WestTmp
  Call westPageBase
  !insertmacro WEST_TEXT 320 70 360 36 "$(westTitle)" $WestF_H1 "${WEST_TEXT}" "${WEST_BG}"
  !insertmacro WEST_TEXT 320 110 340 44 "$(westSub)" $WestF_Body "${WEST_MUTED}" "${WEST_BG}"

  !insertmacro WEST_TEXT 320 178 360 18 "$(westDirLabel)" $WestF_Small "${WEST_MUTED}" "${WEST_BG}"
  !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES} 0 320 200 264 38 ""
  SetCtlColors $WestLast "${WEST_TEXT}" "${WEST_FIELD}"
  Push $WestLast
  Call westRoundSmall
  !insertmacro WEST_CTL EDIT ${DEFAULT_STYLES}|${WS_TABSTOP}|${ES_AUTOHSCROLL} 0 333 210 240 20 "$INSTDIR"
  StrCpy $WestDirEdit $WestLast
  SendMessage $WestDirEdit ${WM_SETFONT} $WestF_Body 1
  SetCtlColors $WestDirEdit "${WEST_TEXT}" "${WEST_FIELD}"
  !insertmacro WEST_BUTTON 592 200 88 38 "$(westChange)" "${WEST_TEXT}" "${WEST_FIELD2}" westPickDir

  !insertmacro WEST_CHECK 320 260 348 330 "$(westDesktop)" $WestDesktop westToggleDesktop

  !insertmacro WEST_BUTTON 320 352 360 46 "$(westInstall)" "${WEST_ONACCENT}" "${WEST_ACCENT}" westNextClick
  !insertmacro WEST_TEXT 320 408 360 18 "West Client ${VERSION}" $WestF_Small "${WEST_MUTED}" "${WEST_BG}"
  nsDialogs::Show
FunctionEnd

Function WestMainLeave
  ${NSD_GetText} $WestDirEdit $WestTmp
  ${If} $WestTmp == ""
    Abort
  ${EndIf}
  StrCpy $INSTDIR $WestTmp
FunctionEnd

Function westToggleDesktop
  Pop $WestTmp
  IntOp $WestDesktop $WestDesktop ^ 1
  Push $WestDesktop
  Call westPaintCheck
FunctionEnd

Function westPickDir
  Pop $WestTmp
  ${NSD_GetText} $WestDirEdit $WestTmp
  nsDialogs::SelectFolderDialog "$(westPickDir)" $WestTmp
  Pop $WestTmp
  ${If} $WestTmp == "error"
  ${OrIf} $WestTmp == ""
    Return
  ${EndIf}
  ; Seçilen klasörün içine "West Client" klasörü açılır (zaten o klasörse eklenmez)
  StrLen $WestTmp2 "${PRODUCTNAME}"
  IntOp $WestTmp2 0 - $WestTmp2
  StrCpy $WestTmp2 $WestTmp "" $WestTmp2
  ${If} $WestTmp2 != "${PRODUCTNAME}"
    StrCpy $WestTmp2 $WestTmp 1 -1
    ${If} $WestTmp2 == "\"
      StrCpy $WestTmp "$WestTmp${PRODUCTNAME}"
    ${Else}
      StrCpy $WestTmp "$WestTmp\${PRODUCTNAME}"
    ${EndIf}
  ${EndIf}
  ${NSD_SetText} $WestDirEdit $WestTmp
FunctionEnd

; Başlat menüsü klasörü sorulmaz; varsayılan kullanılır (sessiz kurulumda da)
Function WestStartMenuPre
  ${IfThen} $AppStartMenuFolder == "" ${|} StrCpy $AppStartMenuFolder "${STARTMENUFOLDER}" ${|}
  Abort
FunctionEnd

; ── Önceden kurulu sürüm: iki seçenek kartı ──
Function westPaintOptions
  ${If} $WestReinstFirst = 1
    SetCtlColors $WestOpt1 "${WEST_TEXT}" "2A2117"
    SetCtlColors $WestOpt2 "${WEST_MUTED}" "${WEST_FIELD}"
  ${Else}
    SetCtlColors $WestOpt1 "${WEST_MUTED}" "${WEST_FIELD}"
    SetCtlColors $WestOpt2 "${WEST_TEXT}" "2A2117"
  ${EndIf}
  System::Call 'user32::InvalidateRect(p $WestOpt1, p 0, i 1)'
  System::Call 'user32::InvalidateRect(p $WestOpt2, p 0, i 1)'
FunctionEnd
Function westOpt1Click
  Pop $WestTmp
  StrCpy $WestReinstFirst 1
  StrCpy $ReinstallPageCheck 1
  Call westPaintOptions
FunctionEnd
Function westOpt2Click
  Pop $WestTmp
  StrCpy $WestReinstFirst 0
  StrCpy $ReinstallPageCheck 2
  Call westPaintOptions
FunctionEnd

; ── 3. Hazır: aç / kapat ──
Function WestFinishPage
  Call SkipIfPassive
  ${If} $WestDesktop = 1
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}
  StrCpy $WestLastPage 1
  nsDialogs::Create 1018
  Pop $WestTmp
  Call westPageBase
  !insertmacro WEST_TEXT 320 120 360 36 "$(westDoneTitle)" $WestF_H1 "${WEST_TEXT}" "${WEST_BG}"
  !insertmacro WEST_TEXT 320 160 340 44 "$(westDoneSub)" $WestF_Body "${WEST_MUTED}" "${WEST_BG}"
  !insertmacro WEST_BUTTON 320 300 360 46 "$(westLaunch)" "${WEST_ONACCENT}" "${WEST_ACCENT}" westLaunchClick
  !insertmacro WEST_BUTTON 320 356 360 42 "$(westClose)" "${WEST_TEXT}" "${WEST_FIELD}" westNextClick
  nsDialogs::Show
FunctionEnd

Function westLaunchClick
  Pop $WestTmp
  Call RunMainBinary
  !insertmacro WEST_NEXT
FunctionEnd

Function .onInstFailed
  MessageBox MB_ICONSTOP "$(westFailed)"
  Quit
FunctionEnd

!undef __WEST_PFX
!define __WEST_PFX "un."

; ── Kaldırıcı: onay ──
Function un.WestConfirmPage
  Call un.SkipIfPassive
  ${IfThen} $DeleteAppDataCheckboxState == "" ${|} StrCpy $DeleteAppDataCheckboxState 0 ${|}
  nsDialogs::Create 1018
  Pop $WestTmp
  Call un.westPageBase
  !insertmacro WEST_TEXT 320 90 360 36 "$(westUnTitle)" $WestF_H1 "${WEST_TEXT}" "${WEST_BG}"
  !insertmacro WEST_TEXT 320 130 340 64 "$(westUnSub)" $WestF_Body "${WEST_MUTED}" "${WEST_BG}"
  !insertmacro WEST_CHECK 320 220 348 330 "$(deleteAppData)" $DeleteAppDataCheckboxState un.westToggleData
  !insertmacro WEST_BUTTON 320 300 360 46 "$(westUnRemove)" "${WEST_ONACCENT}" "${WEST_ACCENT}" un.westNextClick
  !insertmacro WEST_BUTTON 320 356 360 42 "$(westUnCancel)" "${WEST_TEXT}" "${WEST_FIELD}" un.westCloseClick
  nsDialogs::Show
FunctionEnd

Function un.WestConfirmLeave
FunctionEnd

Function un.westToggleData
  Pop $WestTmp
  IntOp $DeleteAppDataCheckboxState $DeleteAppDataCheckboxState ^ 1
  Push $DeleteAppDataCheckboxState
  Call un.westPaintCheck
FunctionEnd

!undef __WEST_PFX
