@echo off
setlocal
fltmc >nul 2>&1
if errorlevel 1 goto elevate
goto uninstall

:elevate
echo Requesting administrator permission...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
set "UNINSTALL_EXIT_CODE=%ERRORLEVEL%"
goto finish

:uninstall
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-worker.ps1"
set "UNINSTALL_EXIT_CODE=%ERRORLEVEL%"

:finish
echo Uninstaller exit code: %UNINSTALL_EXIT_CODE%
pause
exit /b %UNINSTALL_EXIT_CODE%
