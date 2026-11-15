@echo off
chcp 65001 >nul
title West Bot
cd /d "%~dp0"

rem Not Defteri dosyayi ".env.txt" diye kaydettiyse duzelt
if not exist .env if exist .env.txt ren .env.txt .env
if not exist .env if exist env.txt ren env.txt .env

if not exist .env (
  echo .env dosyasi bulunamadi.
  echo Developer Portal - Bot - Reset Token ile aldigin anahtari asagiya yapistir ve Enter'a bas.
  echo Anahtar yalnizca bu bilgisayarda, bu klasordeki .env dosyasina kaydedilir.
  set /p TOKEN=Anahtar: 
  call :kaydet
)

if not exist node_modules (
  echo Ilk calistirma: paketler kuruluyor...
  call npm install --omit=dev
)

:dongu
node --env-file=.env src/index.js
echo Bot durdu. 5 saniye sonra yeniden baslatiliyor... (kapatmak icin pencereyi kapat)
timeout /t 5 >nul
goto dongu

:kaydet
>.env echo DISCORD_BOT_TOKEN=%TOKEN%
set TOKEN=
exit /b
