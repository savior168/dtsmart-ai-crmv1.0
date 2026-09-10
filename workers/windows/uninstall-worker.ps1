#Requires -RunAsAdministrator
$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'DTSmart-AI-Worker'
$installDir = Join-Path $env:ProgramData 'DTSmart\AIWorker'
Stop-ScheduledTask -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "本地Worker已停止并取消开机启动。程序和日志仍保留在 $installDir，可手动删除。" -ForegroundColor Yellow
