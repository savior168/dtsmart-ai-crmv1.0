@echo off
chcp 65001 >nul
fltmc >nul 2>&1
if errorlevel 1 (
  echo 正在申请管理员权限，请在弹出的Windows窗口中选择“是”...
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  if errorlevel 1 (
    echo 无法申请管理员权限，安装没有执行。
    pause
  )
  exit /b
)

echo 已取得管理员权限，开始安装...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-worker.ps1"
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"
if not "%INSTALL_EXIT_CODE%"=="0" (
  echo.
  echo 安装失败，错误代码：%INSTALL_EXIT_CODE%
  echo 请保留本窗口并截图错误内容，不要截图worker.env中的密钥。
) else (
  echo.
  echo 安装程序已正常完成。
)
pause
exit /b %INSTALL_EXIT_CODE%
