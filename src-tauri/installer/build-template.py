#!/usr/bin/env python3
"""Tauri'nin NSIS şablonundan (upstream-installer.nsi) West temalı installer.nsi üretir.
Tauri CLI güncellenince upstream-installer.nsi'yi yenile ve bu betiği yeniden çalıştır."""
import pathlib, re
here = pathlib.Path(__file__).parent
src = (here / "upstream-installer.nsi").read_text()
theme = (here / "west-theme.nsh").read_text()
out = src.replace("!include MUI2.nsh\n", "!include MUI2.nsh\n\n; ───── West Client teması (west-theme.nsh) ─────\n" + theme + "\n", 1)
show = "!define MUI_PAGE_CUSTOMFUNCTION_SHOW westShow\n"
# Kurulum sayfası: ilerleme çubuğunun altına West görseli (install-art.bmp, kenar görseliyle aynı klasörde)
INST_ART = r"""
!searchreplace WEST_INSTALL_ART "${SIDEBARIMAGE}" "sidebar.bmp" "install-art.bmp"
Function westInstShow
  Call westShow
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  InitPluginsDir
  File "/oname=$PLUGINSDIR\west-install.bmp" "${WEST_INSTALL_ART}"
  FindWindow $0 "#32770" "" $HWNDPARENT
  ; Sayfanın genişliği ($2) ve yüksekliği ($3)
  System::Call '*(i,i,i,i) p.r1'
  System::Call 'user32::GetClientRect(p r0, p r1)'
  System::Call '*$1(i,i,i.r2,i.r3)'
  ; İlerleme çubuğunun alt kenarı ($5)
  GetDlgItem $4 $0 1004
  System::Call 'user32::GetWindowRect(p r4, p r1)'
  System::Call 'user32::MapWindowPoints(p 0, p r0, p r1, i 2)'
  System::Call '*$1(i,i,i,i.r5)'
  System::Free $1
  IntOp $5 $5 + 14
  ; Görsel 3:1; sayfa genişliğine sığdır, kalan yüksekliği aşmasın
  IntOp $4 $2 / 3
  IntOp $1 $3 - $5
  IntCmp $4 $1 +2 +2 0
  StrCpy $4 $1
  IntOp $2 $4 * 3
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000000E, i 0, i r5, i r2, i r4, p r0, p 1300, p 0, p 0) p.r3'
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\west-install.bmp", i 0, i r2, i r4, i 0x10) p.r1'
  SendMessage $3 0x172 0 $1
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
"""
out = out.replace("!insertmacro MUI_PAGE_INSTFILES", INST_ART + "!define MUI_PAGE_CUSTOMFUNCTION_SHOW westInstShow\n!insertmacro MUI_PAGE_INSTFILES", 1)

for page in ["MUI_PAGE_WELCOME", "MUI_PAGE_LICENSE", "MUI_PAGE_DIRECTORY", "MUI_PAGE_STARTMENU", "MUI_PAGE_FINISH"]:
    out, n = re.subn(r"^(\s*)(!insertmacro " + page + r"\b)", lambda m: m.group(1) + show + m.group(1) + m.group(2), out, count=1, flags=re.M)
    assert n == 1, page
out, n = re.subn(r"^(!insertmacro MUI_UNPAGE_INSTFILES)", "!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.westShow\n\\1", out, count=1, flags=re.M)
assert n == 1
# Silme onayı sayfası kendi SHOW işlevini kullanıyor: sonunda temayı da uygula
out = out.replace("  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1\nFunctionEnd", "  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1\n  Call un.westShow\nFunctionEnd", 1)
assert "Call un.westShow" in out
# Yeniden kurulum (nsDialogs) sayfası
out = out.replace("    nsDialogs::Show", "    Call westShow\n    nsDialogs::Show", 1)
# Alttaki marka yazısı
out = out.replace('BrandingText "${COPYRIGHT}"', 'BrandingText "West Client ${VERSION}"', 1)
(here / "installer.nsi").write_text(out)
print("installer.nsi yazıldı")
