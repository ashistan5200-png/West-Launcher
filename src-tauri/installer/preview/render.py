#!/usr/bin/env python3
"""installer.nsi şablonunu deneme değerleriyle doldurur (installer-preview iş akışı için).

Kullanım: render.py <bağımlılık klasörü> [--slow]
Bağımlılık klasörü: utils.nsh, FileAssociation.nsh, lang/*.nsh, nsis_tauri_utils.dll, dummy.exe
Çıktı: <bağımlılık klasörü>/test.nsi → makensis ile derlenir, preview-setup.exe üretir."""
import pathlib, re, sys

inst = pathlib.Path(__file__).resolve().parent.parent
deps = pathlib.Path(sys.argv[1]).resolve()
s = (inst / 'installer.nsi').read_text(encoding='utf-8').replace('\r\n', '\n')
P = str
LANGS = ('Turkish', 'English', 'German')
vals = {
    'compression': 'zlib', 'manufacturer': 'West', 'product_name': 'West Client', 'version': '0.0.1',
    'version_with_build': '0.0.1.0', 'homepage': '', 'install_mode': 'currentUser', 'license': '',
    'installer_icon': P(inst.parent / 'icons' / 'icon.ico'),
    'sidebar_image': P(inst / 'sidebar.bmp'), 'header_image': P(inst / 'header.bmp'),
    'uninstaller_icon': '', 'uninstaller_header_image': '', 'main_binary_name': 'west-launcher',
    'main_binary_path': P(deps / 'dummy.exe'), 'bundle_id': 'dev.west.launcher.preview', 'copyright': '',
    'out_file': P(deps / 'preview-setup.exe'), 'arch': 'x64', 'additional_plugins_path': P(deps),
    'allow_downgrades': 'true', 'display_language_selector': 'false',
    'install_webview2_mode': 'skip', 'webview2_installer_args': '', 'webview2_bootstrapper_path': '',
    'webview2_installer_path': '', 'minimum_webview2_version': '', 'uninstaller_sign_cmd': '',
    'estimated_size': '1000', 'start_menu_folder': 'West Client Preview',
}
s = re.sub(r'\{\{#if [a-z_]+\}\}.*?\{\{/if\}\}\n', '', s, flags=re.S)
s = re.sub(r'\{\{#each languages\}\}\n(.*?)\{\{/each\}\}\n',
           lambda m: ''.join(m.group(1).replace('{{this}}', l) for l in LANGS), s, flags=re.S)
s = re.sub(r'\{\{#each language_files\}\}\n(.*?)\{\{/each\}\}\n',
           lambda m: ''.join(m.group(1).replace('{{this}}', P(deps / 'lang' / f'{l}.nsh')) for l in LANGS), s, flags=re.S)
pat = re.compile(r'\{\{#each [^}]*\}\}(?:(?!\{\{#each).)*?\{\{/each\}\}', re.S)
while pat.search(s):
    s = pat.sub('', s)
for k, v in vals.items():
    s = s.replace('{{' + k + '}}', v)
left = re.findall(r'\{\{[^}]*\}\}', s)
assert not left, left[:5]
s = s.replace('!include "utils.nsh"', '!include "' + P(deps / 'utils.nsh') + '"')
s = s.replace('!include "FileAssociation.nsh"', '!include "' + P(deps / 'FileAssociation.nsh') + '"')
if '--slow' in sys.argv:
    # İlerleme sayfası görülebilsin
    s = s.replace('Section Install\n', 'Section Install\n  StrCpy $9 0\n  slowloop:\n  DetailPrint "dosya $9"\n  Sleep 200\n  IntOp $9 $9 + 1\n  IntCmp $9 40 0 slowloop\n', 1)
(deps / 'test.nsi').write_text('﻿' + s, encoding='utf-8')
print('test.nsi hazır')
