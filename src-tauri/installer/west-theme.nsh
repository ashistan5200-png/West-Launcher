; ═══════════════════════════════════════════════════════════════════════════
;  West Client kurulum sihirbazı teması
;  Tüm sayfalar koyu West zemininde; yazılar açık, vurgu turuncu. Windows 10/11'de başlık
;  çubuğu, düğmeler, kaydırma çubukları ve liste koyu (Explorer'ın koyu teması) çizilir.
;  installer.nsi tarafından MUI2.nsh'den ÖNCE eklenir.
; ═══════════════════════════════════════════════════════════════════════════

!define WEST_BG     "111218"   ; sayfa zemini
!define WEST_PANEL  "17181F"   ; başlık şeridi
!define WEST_FIELD  "1D1E26"   ; giriş kutuları
!define WEST_TEXT   "E6E7EA"
!define WEST_MUTED  "9A9DA6"
!define WEST_ACCENT "E8A33D"

; ── Modern UI renkleri ──
!define MUI_BGCOLOR "${WEST_BG}"
!define MUI_TEXTCOLOR "${WEST_TEXT}"
!define MUI_LICENSEPAGE_BGCOLOR "${WEST_FIELD}"
!define MUI_DIRECTORYPAGE_BGCOLOR "${WEST_FIELD}"
!define MUI_STARTMENUPAGE_BGCOLOR "${WEST_FIELD}"
!define MUI_INSTFILESPAGE_COLORS "${WEST_TEXT} ${WEST_FIELD}"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING
!define MUI_CUSTOMFUNCTION_GUIINIT westGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.westGuiInit

!define /ifndef WM_SETREDRAW 0x000B
!define /ifndef GWL_STYLE -16
!define /ifndef BS_TYPEMASK 0x0F

; Bir pencereye Windows'un koyu temasını uygula (Windows 10 1809+; eski sürümlerde etkisiz)
!macro WEST_DARK HWND
  System::Call 'uxtheme::SetWindowTheme(p ${HWND}, w "DarkMode_Explorer", p 0)'
!macroend

; Bir pencerenin tüm alt denetimlerini West renklerine boya. $0 = pencere
!macro WEST_STYLE_CHILDREN PREFIX
Function ${PREFIX}westStyleChildren
  Push $1
  Push $2
  Push $3
  StrCpy $1 0
  loop:
    FindWindow $1 "" "" $0 $1
    StrCmp $1 0 done
    System::Call 'user32::GetClassNameW(p r1, w .r2, i 64)'
    StrCmp $2 "Edit" edit
    StrCmp $2 "ComboBox" edit
    StrCmp $2 "SysListView32" list
    StrCmp $2 "msctls_progress32" progress
    StrCmp $2 "SysTreeView32" tree
    StrCmp $2 "Button" button
    ; Statik yazılar ve diğerleri
    SetCtlColors $1 "${WEST_TEXT}" "${WEST_BG}"
    Goto loop
  edit:
    SetCtlColors $1 "${WEST_TEXT}" "${WEST_FIELD}"
    !insertmacro WEST_DARK $1
    Goto loop
  list:
    SendMessage $1 0x1001 0 0x261E1D   ; LVM_SETBKCOLOR (BGR)
    SendMessage $1 0x1026 0 0x261E1D   ; LVM_SETTEXTBKCOLOR
    SendMessage $1 0x1024 0 0xEAE7E6   ; LVM_SETTEXTCOLOR
    !insertmacro WEST_DARK $1
    Goto loop
  tree:
    SendMessage $1 0x111D 0 0x261E1D   ; TVM_SETBKCOLOR
    SendMessage $1 0x111E 0 0xEAE7E6   ; TVM_SETTEXTCOLOR
    !insertmacro WEST_DARK $1
    Goto loop
  progress:
    ; Temayı kaldır ki renkler uygulansın: turuncu çubuk, koyu zemin
    System::Call 'uxtheme::SetWindowTheme(p r1, w "", w "")'
    SendMessage $1 0x0409 0 0x3DA3E8   ; PBM_SETBARCOLOR (BGR)
    SendMessage $1 0x2001 0 0x261E1D   ; PBM_SETBKCOLOR
    Goto loop
  button:
    System::Call 'user32::GetWindowLongW(p r1, i ${GWL_STYLE}) i .r3'
    IntOp $3 $3 & ${BS_TYPEMASK}
    ; 0/1 basma düğmesi → koyu tema; onay kutusu/radyo → tema kalkar ki yazı rengi uygulansın
    IntCmp $3 1 push push 0
    System::Call 'uxtheme::SetWindowTheme(p r1, w "", w "")'
    SetCtlColors $1 "${WEST_TEXT}" "${WEST_BG}"
    Goto loop
  push:
    !insertmacro WEST_DARK $1
    Goto loop
  done:
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

; Her sayfa gösterilirken: iç sayfayı ve denetimlerini boya
Function ${PREFIX}westShow
  Push $0
  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_BG}"
  Call ${PREFIX}westStyleChildren
  Pop $0
FunctionEnd

; Ana pencere: zemin, başlık şeridi, düğmeler, koyu başlık çubuğu
Function ${PREFIX}westGuiInit
  Push $0
  Push $1
  SetCtlColors $HWNDPARENT "${WEST_TEXT}" "${WEST_BG}"
  ; Koyu başlık çubuğu (Windows 11: 20, Windows 10 1809–1909: 19)
  System::Call '*(i 1) p .r1'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, p r1, i 4) i .r0'
  IntCmp $0 0 +2
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, p r1, i 4)'
  System::Free $1
  ; Başlık şeridi (1034), başlık ve alt başlık (1037, 1038)
  GetDlgItem $0 $HWNDPARENT 1034
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_PANEL}"
  GetDlgItem $0 $HWNDPARENT 1037
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_PANEL}"
  GetDlgItem $0 $HWNDPARENT 1038
  SetCtlColors $0 "${WEST_MUTED}" "${WEST_PANEL}"
  GetDlgItem $0 $HWNDPARENT 1039
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_PANEL}"
  GetDlgItem $0 $HWNDPARENT 1046
  SetCtlColors $0 "${WEST_TEXT}" "${WEST_PANEL}"
  ; Alt çizgiler ve marka yazısı
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1256
  SetCtlColors $0 "${WEST_MUTED}" "${WEST_BG}"
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 "${WEST_MUTED}" "${WEST_BG}"
  ; İleri / İptal / Geri düğmeleri: Windows'un koyu teması
  GetDlgItem $0 $HWNDPARENT 1
  !insertmacro WEST_DARK $0
  GetDlgItem $0 $HWNDPARENT 2
  !insertmacro WEST_DARK $0
  GetDlgItem $0 $HWNDPARENT 3
  !insertmacro WEST_DARK $0
  Pop $1
  Pop $0
FunctionEnd
!macroend

!insertmacro WEST_STYLE_CHILDREN ""
!insertmacro WEST_STYLE_CHILDREN "un."
