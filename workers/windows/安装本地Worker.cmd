@echo off
setlocal
if "%DTSMART_WORKER_INSTALL_TEST%"=="1" goto validate
fltmc >nul 2>&1
if errorlevel 1 goto elevate
goto install

:validate
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-worker.ps1" -ValidateOnly
exit /b %ERRORLEVEL%

:elevate
echo Requesting administrator permission...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"
goto finish

:install
echo Administrator permission confirmed. Starting installer...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-worker.ps1"
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if "%INSTALL_EXIT_CODE%"=="0" goto success
echo Installation failed. Error code: %INSTALL_EXIT_CODE%
echo Keep this window open and capture the error message. Never capture secrets from worker.env.
pause
exit /b %INSTALL_EXIT_CODE%

:success
echo Installation completed successfully.
pause
exit /b 0
