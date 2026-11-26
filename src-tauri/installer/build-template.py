#!/usr/bin/env python3
"""Tauri'nin NSIS şablonundan (upstream-installer.nsi) West Client'ın kendi kurulum
penceresini kullanan installer.nsi'yi üretir.

  west-theme.nsh   pencere, yazı tipleri, düğmeler, ilerleme sayfası (ortak)
  west-pages.nsh   Kur / Hazır / Kaldır sayfaları
  west-strings.nsh sayfa metinleri (tr, en, de)

Tauri CLI güncellenince upstream-installer.nsi'yi yenile ve bu betiği yeniden çalıştır.
Tauri, ürettiği dosyayı UTF-16 (BOM'lu) yazar; Türkçe karakterler bu yüzden sorunsuzdur."""
import pathlib, re

here = pathlib.Path(__file__).parent
read = lambda n: (here / n).read_text(encoding="utf-8").replace("\r\n", "\n")
src = read("upstream-installer.nsi")
theme = read("west-theme.nsh")
pages = read("west-pages.nsh")
strings = read("west-strings.nsh")
out = src


def sub(old, new, count=1):
    global out
    assert old in out, old[:80]
    out = out.replace(old, new, count)


# Onay kutusu değişkenleri temada tanımlı (sayfa işlevleri daha önce geliyor)
sub("Var DeleteAppDataCheckbox\nVar DeleteAppDataCheckboxState\n", "")

# Tema: sayfalardan önce, görsel klasörü (sidebar.bmp'nin klasörü) tanımlandıktan sonra
sub("; Installer pages, must be ordered as they appear\n",
    '!searchreplace WEST_ART_DIR "${SIDEBARIMAGE}" "sidebar.bmp" ""\n'
    "; ───── West Client kurulum penceresi (west-theme.nsh) ─────\n" + theme +
    "\n; Installer pages, must be ordered as they appear\n")

# 1. Hoş geldin + 5. klasör sayfası yerine tek "Kur" sayfası
sub("; 1. Welcome Page\n!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive\n!insertmacro MUI_PAGE_WELCOME\n",
    "; 1. West: Kur sayfası (kurulum yeri + masaüstü kısayolu)\nPage custom WestMainPage WestMainLeave\n")
sub("; 5. Choose install directory page\n!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive\n!insertmacro MUI_PAGE_DIRECTORY\n",
    "; 5. Klasör seçimi Kur sayfasında\n")

# 6. Başlat menüsü klasörü sorulmaz
sub('  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive\n  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"\n!else\n  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip\n',
    '  !define MUI_PAGE_CUSTOMFUNCTION_PRE WestStartMenuPre\n  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"\n!else\n  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip\n')

# 7. Kurulum sayfası: West düzeni; sayfa işlevleri burada (AppStartMenuFolder tanımlı)
sub("; 7. Installation page\n!insertmacro MUI_PAGE_INSTFILES\n",
    "; ───── West Client sayfaları (west-pages.nsh) ─────\n" + pages +
    "\n; 7. Installation page\n!define MUI_PAGE_CUSTOMFUNCTION_SHOW westProgressShow\n!insertmacro MUI_PAGE_INSTFILES\n")

# 8. Bitiş sayfası yerine "Hazır"
m = re.search(r"; 8\. Finish page\n.*?!insertmacro MUI_PAGE_FINISH\n", out, re.S)
assert m
out = out[:m.start()] + "; 8. West: Hazır sayfası (aç / kapat)\nPage custom WestFinishPage\n" + out[m.end():]

# Önceden kurulu sürüm sayfası: West düzeninde iki seçenek kartı
m = re.search(r"    nsDialogs::Create 1018\n    Pop \$R4\n.*?    nsDialogs::Show\n", out, re.S)
assert m
REINST = r"""    nsDialogs::Create 1018
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
"""
out = out[:m.start()] + REINST + out[m.end():]
sub("Function PageLeaveReinstall\n  ${NSD_GetState} $R2 $R1\n",
    "Function PageLeaveReinstall\n  ${NSD_GetState} $R2 $R1\n  ; West sayfasında seçim kartlarla yapılır\n  ${If} $PassiveMode <> 1\n    StrCpy $R1 $WestReinstFirst\n  ${EndIf}\n")

# Kaldırıcı: onay sayfası West düzeninde; bitince kendiliğinden kapanır
m = re.search(r"!define /ifndef WS_EX_LAYOUTRTL.*?!insertmacro MUI_UNPAGE_CONFIRM\n", out, re.S)
assert m
out = out[:m.start()] + "UninstPage custom un.WestConfirmPage un.WestConfirmLeave\n" + out[m.end():]
sub("!insertmacro MUI_UNPAGE_INSTFILES\n", "!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.westProgressShow\n!insertmacro MUI_UNPAGE_INSTFILES\n")
sub("Section Uninstall\n", "Section Uninstall\n  SetAutoClose true\n")

# Metinler: diller eklendikten sonra
sub("!insertmacro MUI_RESERVEFILE_LANGDLL\n", "!insertmacro MUI_RESERVEFILE_LANGDLL\n; ───── West Client metinleri (west-strings.nsh) ─────\n" + strings)

# Alttaki marka yazısı (pencerede gizli; görev yöneticisi vb. için)
sub('BrandingText "${COPYRIGHT}"', 'BrandingText "West Client ${VERSION}"')

with open(here / "installer.nsi", "w", encoding="utf-8", newline="\n") as f:
    f.write(out)
print("installer.nsi yazıldı")
