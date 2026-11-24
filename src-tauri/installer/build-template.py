#!/usr/bin/env python3
"""Tauri'nin NSIS şablonundan (upstream-installer.nsi) West temalı installer.nsi üretir.
Tauri CLI güncellenince upstream-installer.nsi'yi yenile ve bu betiği yeniden çalıştır."""
import pathlib, re
here = pathlib.Path(__file__).parent
src = (here / "upstream-installer.nsi").read_text()
theme = (here / "west-theme.nsh").read_text()
out = src.replace("!include MUI2.nsh\n", "!include MUI2.nsh\n\n; ───── West Client teması (west-theme.nsh) ─────\n" + theme + "\n", 1)
show = "!define MUI_PAGE_CUSTOMFUNCTION_SHOW westShow\n"
for page in ["MUI_PAGE_WELCOME", "MUI_PAGE_LICENSE", "MUI_PAGE_DIRECTORY", "MUI_PAGE_STARTMENU", "MUI_PAGE_INSTFILES", "MUI_PAGE_FINISH"]:
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
