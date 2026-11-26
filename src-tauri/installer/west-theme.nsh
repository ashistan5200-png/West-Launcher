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
