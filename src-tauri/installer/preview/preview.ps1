# Kurulum sihirbazını gerçek Windows'ta çalıştırır, sayfalarına tıklar ve ekran görüntüsü alır.
# Kullanım: preview.ps1 -Setup <preview-setup.exe> -Out <klasör>
param([string]$Setup, [string]$Out)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class U {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct RECT { public int L, T, R, B; }
}
"@

function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $Out "$name.png"))
  $g.Dispose(); $bmp.Dispose()
  Write-Host "görüntü: $name"
}

# Sihirbaz penceresinin sol üst köşesi (pencere 720×440, 96 DPI)
function Win($proc) {
  for ($i = 0; $i -lt 40; $i++) {
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne 0) {
      $r = New-Object U+RECT
      [U]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
      [U]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
      Write-Host "pencere: $($r.L),$($r.T) – $($r.R),$($r.B)"
      return $r
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Sihirbaz penceresi açılmadı"
}
function Click($r, $x, $y) {
  [U]::SetCursorPos($r.L + $x, $r.T + $y) | Out-Null
  Start-Sleep -Milliseconds 150
  [U]::mouse_event(2, 0, 0, 0, 0); [U]::mouse_event(4, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 400
}

$dir = Join-Path $env:LOCALAPPDATA "West Client"

# 1) İlk kurulum: Kur → Kuruluyor → Hazır
$p = Start-Process $Setup -PassThru
Start-Sleep 3
$r = Win $p
Shot "1-kur"
Click $r 329 269            # onay kutusu kapat
Shot "2-kutu-kapali"
Click $r 329 269            # tekrar aç
Click $r 500 375            # Kur
Start-Sleep 2
Shot "3-kuruluyor"
Start-Sleep 9
Shot "4-hazir"
Click $r 500 377            # Kapat
Start-Sleep 2
if (-not $p.HasExited) { Shot "4b-kapanmadi"; throw "Kapat sihirbazı kapatmadı" }
if (-not (Test-Path (Join-Path $dir "west-launcher.exe"))) { throw "Kurulum dosyaları yok: $dir" }
if (-not (Test-Path ([Environment]::GetFolderPath("Desktop") + "\West Client.lnk"))) { Write-Host "UYARI: masaüstü kısayolu yok" }

# 2) Yeniden çalıştır: önceden kurulu sayfası, ✕ ile çık
$p = Start-Process $Setup -PassThru
Start-Sleep 3
$r = Win $p
Shot "5-zaten-kurulu"
Click $r 500 270            # ikinci seçenek
Shot "6-ikinci-secenek"
Click $r 694 23             # ✕
Start-Sleep 2
if (-not $p.HasExited) { Shot "6b-kapanmadi"; throw "✕ sihirbazı kapatmadı" }

# 3) Sessiz güncelleme (launcher'ın kullandığı yol): /P /UPDATE
$p = Start-Process $Setup -ArgumentList "/P", "/UPDATE" -PassThru
Start-Sleep 2
Shot "7-pasif-guncelleme"
$p.WaitForExit(60000) | Out-Null
if (-not $p.HasExited) { throw "Pasif kurulum bitmedi" }
Write-Host "pasif kurulum çıkış kodu: $($p.ExitCode)"

# 4) Kaldırıcı
$u = Start-Process (Join-Path $dir "uninstall.exe") -PassThru
Start-Sleep 3
# Kaldırıcı kendini geçici klasöre kopyalayıp oradan çalışır
$un = Get-Process | Where-Object { $_.ProcessName -like "Un_*" -or $_.ProcessName -like "Au_*" } | Select-Object -First 1
if ($un) { $r = Win $un } else { $r = Win $u }
Shot "8-kaldir"
Click $r 500 323            # Kaldır
Start-Sleep 5
Shot "9-kaldirildi"
if (Test-Path (Join-Path $dir "west-launcher.exe")) { throw "Kaldırıcı dosyaları silmedi" }
Write-Host "Tüm adımlar geçti"
