@echo off
chcp 65001 >nul
title West Bot
cd /d "%~dp0"
if not exist node_modules (
  echo Ilk calistirma: paketler kuruluyor...
  call npm install --omit=dev
)
:dongu
node --env-file=.env src/index.js
echo Bot durdu. 5 saniye sonra yeniden baslatiliyor... (kapatmak icin pencereyi kapat)
timeout /t 5 >nul
goto dongu
