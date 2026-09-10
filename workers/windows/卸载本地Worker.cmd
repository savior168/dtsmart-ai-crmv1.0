@echo off
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""%~dp0uninstall-worker.ps1""'"
pause
