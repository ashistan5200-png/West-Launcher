Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Set the compression algorithm. We default to LZMA.
  SetCompressor /SOLID "{{compression}}"
!endif

; Keep above !include to stay ahead of any plugin command
; see https://github.com/tauri-apps/tauri/pull/15422#discussion_r3289239624
{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "Win\RestartManager.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName

Name "${PRODUCTNAME}"
BrandingText "West Client ${VERSION}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!addplugindir "${ADDITIONALPLUGINSPATH}"

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Enable header images for installer and uninstaller pages when either image is configured.
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!endif

; Uninstaller header image
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!endif

; Uninstaller icon
!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

!searchreplace WEST_ART_DIR "${SIDEBARIMAGE}" "sidebar.bmp" ""
; ───── West Client kurulum penceresi (west-theme.nsh) ─────
; ═══════════════════════════════════════════════════════════════════════════
;  West Client kurulum sihirbazı — kendi penceresi
;  Windows'un çerçevesi, başlık şeridi ve düğmeleri kullanılmaz: çerçevesiz,
;  köşeleri yuvarlak bir pencere; solda logolu görsel, sağda koyu panel ve
;  West'in kendi düğmeleri. Sayfalar: Kur → Kuruluyor → Hazır (kaldırıcı: Onay → Kaldırılıyor).
;  installer.nsi'de MUI2.nsh'den hemen sonra eklenir (build-template.py).
; ═══════════════════════════════════════════════════════════════════════════
!include LogicLib.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!define WEST_BG      "111218"   ; sağ panel
!define WEST_FIELD   "1B1C23"   ; alan ve ikincil düğme
!define WEST_FIELD2  "24252E"   ; seçili seçenek
!define WEST_TEXT    "EEF0F3"
!define WEST_MUTED   "9AA0AD"
!define WEST_ACCENT  "E8A25C"
!define WEST_ONACCENT "1A1008"

; Temel ölçüler (96 DPI piksel; ekran ölçeğine göre büyütülür)
!define WEST_W   720
!define WEST_H   440
!define WEST_ART 280
!define WEST_X   320    ; içerik sol kenarı
!define WEST_CW  360    ; içerik genişliği

; Ayrıntı listesi ve Windows'un sorduğu "İptal edilsin mi?" kutusu yok
ShowInstDetails nevershow
ShowUninstDetails nevershow
AutoCloseWindow true
!define MUI_CUSTOMFUNCTION_GUIINIT westGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.westGuiInit
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

Var WestDpi
Var WestArtBmp
Var WestF_H1
Var WestF_Body
Var WestF_Small
Var WestF_Btn
Var WestF_Sym
Var WestLast
Var WX
Var WY
Var WW
Var WH
Var WestDesktop
Var WestDirEdit
Var WestChkBox
Var WestReinstFirst
Var WestOpt1
Var WestOpt2
Var WestTmp
Var WestTmp2
Var WestLastPage
Var DeleteAppDataCheckboxState

; 96 DPI pikselini ekran pikseline çevir
!macro WEST_PX OUT IN
  IntOp ${OUT} ${IN} * $WestDpi
  IntOp ${OUT} ${OUT} / 96
!macroend

; nsDialogs sayfasına denetim ekle (koordinatlar 96 DPI piksel). Sonuç: $WestLast
!macro WEST_CTL CLASS STYLE EXSTYLE X Y W H TEXT
  !insertmacro WEST_PX $WX ${X}
  !insertmacro WEST_PX $WY ${Y}
  !insertmacro WEST_PX $WW ${W}
  !insertmacro WEST_PX $WH ${H}
  nsDialogs::CreateControl ${CLASS} ${STYLE} ${EXSTYLE} $WX $WY $WW $WH `${TEXT}`
  Pop $WestLast
!macroend

; Yazı: RENK zemin üstünde, verilen yazı tipiyle
!macro WEST_TEXT X Y W H TEXT FONT FG BG
  !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY} 0 ${X} ${Y} ${W} ${H} `${TEXT}`
  SendMessage $WestLast ${WM_SETFONT} ${FONT} 1
  SetCtlColors $WestLast ${FG} ${BG}
!macroend

; Düğme: ortalı yazılı, köşeleri yuvarlatılmış tıklanabilir yüzey
!macro WEST_BUTTON X Y W H TEXT FG BG ONCLICK
  !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY}|${SS_CENTER}|${SS_CENTERIMAGE} 0 ${X} ${Y} ${W} ${H} `${TEXT}`
  SendMessage $WestLast ${WM_SETFONT} $WestF_Btn 1
  SetCtlColors $WestLast ${FG} ${BG}
  Push $WestLast
  Call ${__WEST_PFX}westRound
  ${NSD_OnClick} $WestLast ${ONCLICK}
!macroend

; Bir sonraki sayfaya geç (Windows'un gizli "İleri" düğmesi gibi)
!macro WEST_NEXT
  SendMessage $HWNDPARENT 0x408 1 0
!macroend

!macro WEST_CHECK X Y TX TW TEXT STATE ONCLICK
  !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY}|${SS_CENTER}|${SS_CENTERIMAGE} 0 ${X} ${Y} 18 18 ""
  StrCpy $WestChkBox $WestLast
  SendMessage $WestChkBox ${WM_SETFONT} $WestF_Sym 1
  Push $WestChkBox
  Call ${__WEST_PFX}westRoundSmall
  ${NSD_OnClick} $WestChkBox ${ONCLICK}
  Push ${STATE}
  Call ${__WEST_PFX}westPaintCheck
  !insertmacro WEST_TEXT ${TX} ${Y} ${TW} 20 `${TEXT}` $WestF_Body "${WEST_TEXT}" "${WEST_BG}"
  ${NSD_OnClick} $WestLast ${ONCLICK}
!macroend

!macro WEST_COMMON PFX
!define __WEST_PFX "${PFX}"
!if "${PFX}" == "un."
  !define WEST_WORKING "$(westUnWorking)"
  !define WEST_WORKING_SUB "$(westUnWorkingSub)"
!else
  !define WEST_WORKING "$(westWorking)"
  !define WEST_WORKING_SUB "$(westWorkingSub)"
!endif

; Yığındaki pencerenin köşelerini yuvarlat ($WW × $WH boyutunda)
Function ${PFX}westRound
  Exch $0
  Push $1
  Push $2
  !insertmacro WEST_PX $2 10
  System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i $WW, i $WH, i r2, i r2) p.r1'
  System::Call 'user32::SetWindowRgn(p r0, p r1, i 1)'
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Ana pencere: çerçevesiz, ortada, yuvarlak köşeli; Windows'un tüm parçaları gizli
Function ${PFX}westGuiInit
  Push $0
  Push $1
  Push $2
  Push $3
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.r0'
  ${If} $0 < 96
    System::Call 'user32::GetDC(p 0) p.r1'
    System::Call 'gdi32::GetDeviceCaps(p r1, i 88) i.r0'
    System::Call 'user32::ReleaseDC(p 0, p r1)'
  ${EndIf}
  ${IfThen} $0 < 96 ${|} StrCpy $0 96 ${|}
  StrCpy $WestDpi $0

  ; Başlık çubuğu ve kalın kenar kalkar; görev çubuğunda simge durumuna küçültülebilir
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i.r0'
  IntOp $0 $0 & 0xFF33FFFF
  IntOp $0 $0 | 0x00020000
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i r0)'
  !insertmacro WEST_PX $WW ${WEST_W}
  !insertmacro WEST_PX $WH ${WEST_H}
  ; Çalışma alanının ortası
  System::Call '*(i,i,i,i) p.r1'
  System::Call 'user32::SystemParametersInfoW(i 0x30, i 0, p r1, i 0)'
  System::Call '*$1(i.r2, i.r3, i.r0, i.r4)'
  System::Free $1
  IntOp $0 $0 - $2
  IntOp $0 $0 - $WW
  IntOp $0 $0 / 2
  IntOp $2 $2 + $0
  IntOp $4 $4 - $3
  IntOp $4 $4 - $WH
  IntOp $4 $4 / 2
  IntOp $3 $3 + $4
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r2, i r3, i $WW, i $WH, i 0x24)'
  ; Windows 11: yuvarlak köşe ve gölge. Eski sürümlerde bölgeyle yuvarlat
  System::Call '*(i 2) p.r1'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, p r1, i 4) i.r0'
  System::Free $1
  ${If} $0 <> 0
    !insertmacro WEST_PX $1 12
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i $WW, i $WH, i r1, i r1) p.r0'
    System::Call 'user32::SetWindowRgn(p $HWNDPARENT, p r0, i 1)'
  ${EndIf}
  SetCtlColors $HWNDPARENT "${WEST_TEXT}" "${WEST_BG}"
  Call ${PFX}westHideNative

  ; Yazı tipleri
  CreateFont $WestF_H1 "Segoe UI Semibold" 17 600
  CreateFont $WestF_Body "Segoe UI" 10 400
  CreateFont $WestF_Small "Segoe UI" 9 400
  CreateFont $WestF_Btn "Segoe UI Semibold" 10 600
  CreateFont $WestF_Sym "Segoe UI Symbol" 10 700

  ; Sol panel görseli: ekran ölçeğine en yakın boyut
  InitPluginsDir
  ${If} $WestDpi >= 180
    File "/oname=$PLUGINSDIR\west-art.bmp" "${WEST_ART_DIR}\west-art-200.bmp"
  ${ElseIf} $WestDpi >= 132
    File "/oname=$PLUGINSDIR\west-art.bmp" "${WEST_ART_DIR}\west-art-150.bmp"
  ${ElseIf} $WestDpi >= 110
    File "/oname=$PLUGINSDIR\west-art.bmp" "${WEST_ART_DIR}\west-art-125.bmp"
  ${Else}
    File "/oname=$PLUGINSDIR\west-art.bmp" "${WEST_ART_DIR}\west-art-100.bmp"
  ${EndIf}
  !insertmacro WEST_PX $0 ${WEST_ART}
  !insertmacro WEST_PX $1 ${WEST_H}
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\west-art.bmp", i 0, i r0, i r1, i 0x10) p.r2'
  StrCpy $WestArtBmp $2
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Ana penceredeki Windows parçalarını gizle; sayfa alanı tüm pencereyi kaplasın
Function ${PFX}westHideNative
  Push $0
  Push $1
  ; Tam pencere boyutu ($WW/$WH başka işlevlerce de kullanılır, burada yeniden hesaplanır)
  !insertmacro WEST_PX $WW ${WEST_W}
  !insertmacro WEST_PX $WH ${WEST_H}
  StrCpy $0 0
  loop:
    FindWindow $0 "" "" $HWNDPARENT $0
    StrCmp $0 0 done
    System::Call 'user32::GetClassNameW(p r0, w .r1, i 64)'
    StrCmp $1 "#32770" loop
    System::Call 'user32::GetDlgCtrlID(p r0) i.r1'
    ${If} $1 = 1018
      System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i $WW, i $WH, i 0x14)'
    ${ElseIf} $1 <> 0
      ; Sayfa iletişim kutusu (#32770) dışındaki her şey
      ShowWindow $0 ${SW_HIDE}
      System::Call 'user32::SetWindowPos(p r0, p 0, i -3000, i -3000, i 0, i 0, i 0x15)'
    ${EndIf}
    Goto loop
  done:
  Pop $1
  Pop $0
FunctionEnd

; nsDialogs sayfasının ortak iskeleti: zemin, sol görsel, küçült/kapat
Function ${PFX}westPageBase
  Push $0
  Call ${PFX}westHideNative
  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_BG}"
  !insertmacro WEST_CTL STATIC ${WS_CHILD}|${WS_VISIBLE}|0xE 0 0 0 ${WEST_ART} ${WEST_H} ""
  SendMessage $WestLast 0x172 0 $WestArtBmp
  !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY}|${SS_CENTER}|${SS_CENTERIMAGE} 0 650 10 28 26 "—"
  SendMessage $WestLast ${WM_SETFONT} $WestF_Small 1
  SetCtlColors $WestLast "${WEST_MUTED}" "${WEST_BG}"
  ${NSD_OnClick} $WestLast ${PFX}westMinimize
  !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY}|${SS_CENTER}|${SS_CENTERIMAGE} 0 680 10 28 26 "✕"
  SendMessage $WestLast ${WM_SETFONT} $WestF_Sym 1
  SetCtlColors $WestLast "${WEST_MUTED}" "${WEST_BG}"
  ${NSD_OnClick} $WestLast ${PFX}westCloseClick
  Pop $0
FunctionEnd

Function ${PFX}westMinimize
  Pop $WestTmp
  ShowWindow $HWNDPARENT ${SW_MINIMIZE}
FunctionEnd

Function ${PFX}westCloseClick
  Pop $WestTmp
  ; Son sayfada kapatmak = bitir; diğerlerinde kurulumdan çık
  ${If} $WestLastPage = 1
    !insertmacro WEST_NEXT
  ${Else}
    SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
  ${EndIf}
FunctionEnd

Function ${PFX}westNextClick
  Pop $WestTmp
  !insertmacro WEST_NEXT
FunctionEnd

; Kendi onay kutumuz: kutu + yazı; $WestChkBox kutu, durum $1 (1/0)
Function ${PFX}westPaintCheck
  Exch $1
  ${If} $1 = 1
    SetCtlColors $WestChkBox "${WEST_ONACCENT}" "${WEST_ACCENT}"
    SendMessage $WestChkBox ${WM_SETTEXT} 0 "STR:✓"
  ${Else}
    SetCtlColors $WestChkBox "${WEST_TEXT}" "${WEST_FIELD2}"
    SendMessage $WestChkBox ${WM_SETTEXT} 0 "STR:"
  ${EndIf}
  System::Call 'user32::InvalidateRect(p $WestChkBox, p 0, i 1)'
  Pop $1
FunctionEnd


Function ${PFX}westRoundSmall
  Exch $0
  Push $1
  Push $2
  !insertmacro WEST_PX $2 5
  System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i $WW, i $WH, i r2, i r2) p.r1'
  System::Call 'user32::SetWindowRgn(p r0, p r1, i 1)'
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Kurulum/kaldırma ilerleme sayfası (Windows'un sayfası, yeniden düzenlenir)
Function ${PFX}westProgressShow
  Push $0
  Push $1
  Push $2
  Push $3
  Call ${PFX}westHideNative
  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_BG}"
  ; Windows'un sayfası kendi boyutunda gelir: tüm pencereyi kaplasın
  !insertmacro WEST_PX $WW ${WEST_W}
  !insertmacro WEST_PX $WH ${WEST_H}
  System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i $WW, i $WH, i 0x14)'
  ; Sayfadaki her şeyi gizle; ilerleme çubuğu ve durum yazısı yeniden yerleşir
  StrCpy $1 0
  hide:
    FindWindow $1 "" "" $0 $1
    StrCmp $1 0 hidden
    ShowWindow $1 ${SW_HIDE}
    Goto hide
  hidden:
  ; Sol görsel
  !insertmacro WEST_PX $WW ${WEST_ART}
  !insertmacro WEST_PX $WH ${WEST_H}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000000E, i 0, i 0, i $WW, i $WH, p r0, p 1301, p 0, p 0) p.r1'
  SendMessage $1 0x172 0 $WestArtBmp
  ; Başlık ve açıklama
  !insertmacro WEST_PX $WX ${WEST_X}
  !insertmacro WEST_PX $WY 150
  !insertmacro WEST_PX $WW ${WEST_CW}
  !insertmacro WEST_PX $WH 34
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "${WEST_WORKING}", i 0x50000000, i $WX, i $WY, i $WW, i $WH, p r0, p 1302, p 0, p 0) p.r1'
  SendMessage $1 ${WM_SETFONT} $WestF_H1 1
  SetCtlColors $1 "${WEST_TEXT}" "${WEST_BG}"
  !insertmacro WEST_PX $WY 188
  !insertmacro WEST_PX $WH 40
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "${WEST_WORKING_SUB}", i 0x50000000, i $WX, i $WY, i $WW, i $WH, p r0, p 1303, p 0, p 0) p.r1'
  SendMessage $1 ${WM_SETFONT} $WestF_Body 1
  SetCtlColors $1 "${WEST_MUTED}" "${WEST_BG}"
  ; İnce turuncu ilerleme çubuğu
  GetDlgItem $1 $0 1004
  System::Call 'uxtheme::SetWindowTheme(p r1, w "", w "")'
  SendMessage $1 0x0409 0 0x5CA2E8   ; PBM_SETBARCOLOR (BGR)
  SendMessage $1 0x2001 0 0x231C1B   ; PBM_SETBKCOLOR
  System::Call 'user32::GetWindowLongW(p r1, i -20) i.r2'
  IntOp $2 $2 & 0xFFFDFDFF           ; WS_EX_CLIENTEDGE ve STATICEDGE kalksın
  System::Call 'user32::SetWindowLongW(p r1, i -20, i r2)'
  System::Call 'user32::GetWindowLongW(p r1, i -16) i.r2'
  IntOp $2 $2 & 0xFF7FFFFF           ; WS_BORDER kalksın
  System::Call 'user32::SetWindowLongW(p r1, i -16, i r2)'
  !insertmacro WEST_PX $WY 250
  !insertmacro WEST_PX $WH 6
  System::Call 'user32::SetWindowPos(p r1, p 0, i $WX, i $WY, i $WW, i $WH, i 0x34)'
  ShowWindow $1 ${SW_SHOW}
  Push $1
  Call ${PFX}westRoundSmall
  ; Ayrıntı yazısı (hangi dosya)
  GetDlgItem $1 $0 1006
  SendMessage $1 ${WM_SETFONT} $WestF_Small 1
  SetCtlColors $1 "${WEST_MUTED}" "${WEST_BG}"
  !insertmacro WEST_PX $WY 266
  !insertmacro WEST_PX $WH 20
  System::Call 'user32::SetWindowPos(p r1, p 0, i $WX, i $WY, i $WW, i $WH, i 0x14)'
  ShowWindow $1 ${SW_SHOW}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!undef __WEST_PFX
!undef WEST_WORKING
!undef WEST_WORKING_SUB
!macroend

!insertmacro WEST_COMMON ""
!insertmacro WEST_COMMON "un."

; Installer pages, must be ordered as they appear
; 1. West: Kur sayfası (kurulum yeri + masaüstü kısayolu)
Page custom WestMainPage WestMainLeave

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; 4. Custom page to ask user if he wants to reinstall/uninstall
;    only if a previous installation was detected
Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall

; Find a previous WiX installation and set $R6 to its uninstall registry key, or to "" if none.
;
; A WiX installer stores the installation info in registry
; using a UUID and so we have to loop through all keys under
; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
; and check if `DisplayName` and `Publisher` keys match ${PRODUCTNAME} and ${MANUFACTURER}
;
; This has a potential issue that there maybe another installation that matches
; our ${PRODUCTNAME} and ${MANUFACTURER} but wasn't installed by our WiX installer,
; however, this should be fine since the user will have to confirm the uninstallation
; and they can chose to abort it if doesn't make sense.
Function FindWixInstall
  StrCpy $R6 ""
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done ; Exit loop if there is no more keys to loop on
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
  wix_loop_done:
FunctionEnd

Function PageReinstall
  ; Uninstall previous WiX installation if exists.
  Call FindWixInstall
  ${If} $R6 != ""
    StrCpy $WixMode 1
    Goto compare_version
  ${EndIf}

  ; Check if there is an existing installation, if not, abort the reinstall page
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  ; Compare this installar version with the existing installation
  ; and modify the messages presented to the user accordingly
  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0

  ; Read the install choice header through $R5 so a custom language file that only
  ; defines the misspelled `choowHowToInstall` still shows its own text
  ; TODO: remove the `choowHowToInstall` fallback in a future major version
  StrCpy $R5 "$(chooseHowToInstall)"
  ${IfThen} $R5 == "" ${|} StrCpy $R5 "$(choowHowToInstall)" ${|}

  ; Reinstalling the same version
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ; Upgrading
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$R5"
  ; Downgrading
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$R5"
  ${Else}
    Abort
  ${EndIf}

  ; Skip showing the page if passive
  ;
  ; Note that we don't call this earlier at the beginning
  ; of this function because we need to populate some variables
  ; related to current installed version if detected and whether
  ; we are downgrading or not.
  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    nsDialogs::Create 1018
    Pop $R4
    !define __WEST_PFX ""
    Call westPageBase
    !insertmacro WEST_TEXT 320 80 360 36 "$(alreadyInstalled)" $WestF_H1 "${WEST_TEXT}" "${WEST_BG}"
    !insertmacro WEST_TEXT 320 120 340 60 "$R1" $WestF_Body "${WEST_MUTED}" "${WEST_BG}"
    !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY}|${SS_CENTERIMAGE} 0 320 196 360 44 "     $R2"
    StrCpy $WestOpt1 $WestLast
    SendMessage $WestOpt1 ${WM_SETFONT} $WestF_Body 1
    Push $WestOpt1
    Call westRoundSmall
    ${NSD_OnClick} $WestOpt1 westOpt1Click
    !insertmacro WEST_CTL STATIC ${DEFAULT_STYLES}|${SS_NOTIFY}|${SS_CENTERIMAGE} 0 320 248 360 44 "     $R3"
    StrCpy $WestOpt2 $WestLast
    SendMessage $WestOpt2 ${WM_SETFONT} $WestF_Body 1
    Push $WestOpt2
    Call westRoundSmall
    ${NSD_OnClick} $WestOpt2 westOpt2Click
    ; Sürüm düşürmeye izin yoksa ikinci seçenek kapalı
    !if "${ALLOWDOWNGRADES}" == "false"
      ${IfThen} $R0 = -1 ${|} EnableWindow $WestOpt2 0 ${|}
    !endif
    ${If} $ReinstallPageCheck <> 2
      StrCpy $WestReinstFirst 1
    ${Else}
      StrCpy $WestReinstFirst 0
    ${EndIf}
    Call westPaintOptions
    !insertmacro WEST_BUTTON 320 352 360 46 "$(westContinue)" "${WEST_ONACCENT}" "${WEST_ACCENT}" westNextClick
    !undef __WEST_PFX
    nsDialogs::Show
  ${EndIf}
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1
  ; West sayfasında seçim kartlarla yapılır
  ${If} $PassiveMode <> 1
    StrCpy $R1 $WestReinstFirst
  ${EndIf}

  ; If migrating from Wix, always uninstall
  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ; In update mode, always proceeds without uninstalling
  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ; $R0 holds whether same(0)/upgrading(1)/downgrading(-1) version
  ; $R1 holds the radio buttons state:
  ;   1 => first choice was selected
  ;   0 => second choice was selected
  ${If} $R0 = 0 ; Same version, proceed
    ${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    ${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1 ; Upgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${ElseIf} $R0 = -1 ; Downgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${EndIf}

  reinst_uninstall:
    HideWindow
    ClearErrors

    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 "$R1 /UPDATE" ${|} ; append /UPDATE
      ${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 "$R1 /P" ${|} ; append /P
      StrCpy $R1 "$R1 _?=$4" ; append uninstall directory
      ExecWait '$R1' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|} ; ExecWait failed, set fake exit code

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ; User cancelled wix uninstaller? return to select un/reinstall page
      ${If} $WixMode = 1
      ${AndIf} $0 = 1602
        Abort
      ${EndIf}

      ; User cancelled NSIS uninstaller? return to select un/reinstall page
      ${If} $0 = 1
        Abort
      ${EndIf}

      ; Other errors? show generic error message and return to select un/reinstall page
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${EndIf}

    ; The NSIS uninstaller was run in place (`_?=`), so it cannot delete itself
    ; and the install directory, clean them up here once the uninstall succeeded
    ; https://nsis.sourceforge.io/Docs/Chapter3.html#:~:text=path%20contains%20spaces.-,3.2.3%20Examples,-installer.exe%20/NCRC
    ${If} $WixMode = 0
    ${AndIf} $4 != ""
      Delete "$4\uninstall.exe"
      RMDir "$4"
    ${EndIf}
  reinst_done:
FunctionEnd

; 5. Klasör seçimi Kur sayfasında

; 6. Start menu shortcut page
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE WestStartMenuPre
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; ───── West Client sayfaları (west-pages.nsh) ─────
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
  ; Alan zemini yazı kutusunun altında kalsın
  System::Call 'user32::SetWindowPos(p $WestLast, p 1, i 0, i 0, i 0, i 0, i 0x13)'
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

; 7. Installation page
!define MUI_PAGE_CUSTOMFUNCTION_SHOW westProgressShow
!insertmacro MUI_PAGE_INSTFILES

; 8. West: Hazır sayfası (aç / kapat)
Page custom WestFinishPage

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
UninstPage custom un.WestConfirmPage un.WestConfirmLeave

; 2. Uninstalling Page
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.westProgressShow
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
; PageReinstall reads the misspelled `choowHowToInstall` as a fallback, and makensis warns
; about a language string that is read but never set, so default it to an empty string for
; every language. This runs before the language files are included, so a custom language
; file that only defines the old spelling overrides the default and the fallback shows its
; text. `0` as the language id means the language inserted right above.
; TODO: remove the `choowHowToInstall` fallback in a future major version
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
LangString choowHowToInstall 0 ""
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
; ───── West Client metinleri (west-strings.nsh) ─────
; West Client kurulum sihirbazı metinleri (Türkçe, İngilizce, Almanca)
!macro WEST_STR NAME TR EN DE
  LangString ${NAME} ${LANG_TURKISH} "${TR}"
  LangString ${NAME} ${LANG_ENGLISH} "${EN}"
  LangString ${NAME} ${LANG_GERMAN} "${DE}"
!macroend

!insertmacro WEST_STR westTitle "West Client'ı kur" "Install West Client" "West Client installieren"
!insertmacro WEST_STR westSub "Bir dakikadan kısa sürer. Sonrasında West Client kendini kendisi günceller." "Takes less than a minute. After that, West Client keeps itself up to date." "Dauert weniger als eine Minute. Danach hält sich West Client selbst aktuell."
!insertmacro WEST_STR westDirLabel "Kurulum yeri" "Install location" "Installationsort"
!insertmacro WEST_STR westChange "Değiştir" "Change" "Ändern"
!insertmacro WEST_STR westDesktop "Masaüstüne kısayol ekle" "Add a desktop shortcut" "Desktop-Verknüpfung erstellen"
!insertmacro WEST_STR westInstall "Kur" "Install" "Installieren"
!insertmacro WEST_STR westPickDir "West Client'ın kurulacağı klasörü seç" "Choose where to install West Client" "Wähle den Installationsordner für West Client"
!insertmacro WEST_STR westContinue "Devam" "Continue" "Weiter"
!insertmacro WEST_STR westWorking "Kuruluyor…" "Installing…" "Wird installiert…"
!insertmacro WEST_STR westWorkingSub "West Client hazırlanıyor, birazdan biter." "Getting West Client ready, almost there." "West Client wird vorbereitet, gleich fertig."
!insertmacro WEST_STR westDoneTitle "Hazır!" "All set!" "Fertig!"
!insertmacro WEST_STR westDoneSub "West Client kuruldu. İyi oyunlar." "West Client is installed. Have fun." "West Client ist installiert. Viel Spaß."
!insertmacro WEST_STR westLaunch "West Client'ı aç" "Open West Client" "West Client öffnen"
!insertmacro WEST_STR westClose "Kapat" "Close" "Schließen"
!insertmacro WEST_STR westFailed "Kurulum tamamlanamadı. İnternet bağlantını kontrol edip tekrar dene." "The installation couldn't finish. Check your connection and try again." "Die Installation konnte nicht abgeschlossen werden. Prüfe deine Verbindung und versuche es erneut."
!insertmacro WEST_STR westUnTitle "West Client kaldırılsın mı?" "Uninstall West Client?" "West Client deinstallieren?"
!insertmacro WEST_STR westUnSub "Uygulama bu bilgisayardan silinir. Instance'ların, dünyaların ve skinlerin yerinde kalır." "The app will be removed from this computer. Your instances, worlds and skins stay where they are." "Die App wird von diesem Computer entfernt. Deine Instanzen, Welten und Skins bleiben erhalten."
!insertmacro WEST_STR westUnRemove "Kaldır" "Uninstall" "Deinstallieren"
!insertmacro WEST_STR westUnCancel "Vazgeç" "Cancel" "Abbrechen"
!insertmacro WEST_STR westUnWorking "Kaldırılıyor…" "Uninstalling…" "Wird deinstalliert…"
!insertmacro WEST_STR westUnWorkingSub "Birazdan biter." "Almost done." "Gleich fertig."
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; Set default install location
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif

  ; Abort downgrades if they are disabled, in the modes that skip the reinstall page choice:
  ; silent, passive and update
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ; Compare with the same installation the reinstall page would: a WiX one first
    Call FindWixInstall
    ${If} $R6 != ""
      ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
    ${Else}
      ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
    ${EndIf}
    nsis_tauri_utils::SemverCompare "${VERSION}" $R0
    Pop $R0
    ; If downgrading
    ${If} $R0 = -1
      ${If} ${Silent}
        System::Call 'kernel32::AttachConsole(i -1)i.r0'
        ${If} $0 <> 0
          System::Call 'kernel32::GetStdHandle(i -11)i.r0'
          System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
          FileWrite $0 "$(silentDowngrades)"
        ${EndIf}
      ${Else}
        MessageBox MB_ICONSTOP "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif
FunctionEnd

Section WebView2
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; Skip if updating
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 holds the path to the webview2 installer
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"

  ; Copy resources
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0" "Open with ${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Remove old main binary if it doesn't match new main binary name
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create desktop shortcut for silent and passive installers
  ; because finish page will be skipped
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ; Auto close this page for passive mode
  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstSuccess
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall
  SetAutoClose true

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
