#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:ProgramData 'DTSmart\AIWorker'
$taskName = 'DTSmart-AI-Worker'

Write-Host '正在安装 DT Smart AI 本地 Worker...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceDir 'app') -Destination $installDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sourceDir 'runtime') -Destination $installDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sourceDir 'run-worker.ps1') -Destination $installDir -Force

$sourceEnv = Join-Path $sourceDir 'worker.env'
$targetEnv = Join-Path $installDir 'worker.env'
if (Test-Path -LiteralPath $sourceEnv) {
  Copy-Item -LiteralPath $sourceEnv -Destination $targetEnv -Force
} elseif (-not (Test-Path -LiteralPath $targetEnv)) {
  Copy-Item -LiteralPath (Join-Path $sourceDir 'worker.env.example') -Destination $targetEnv -Force
  Write-Host "请先填写 $targetEnv，然后重新运行安装程序。" -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList $targetEnv -Wait
}

$required = @('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
$values = @{}
Get-Content -LiteralPath $targetEnv -Encoding UTF8 | ForEach-Object {
  $parts = $_.Split('=', 2)
  if ($parts.Count -eq 2) { $values[$parts[0].Trim()] = $parts[1].Trim() }
}
foreach ($name in $required) { if (-not $values[$name]) { throw "worker.env 缺少 $name，安装已停止。" } }

icacls $targetEnv /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$installDir\run-worker.ps1`"" -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'DT Smart AI screening durable local worker' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$state = (Get-ScheduledTask -TaskName $taskName).State
Write-Host "安装完成。服务状态: $state" -ForegroundColor Green
Write-Host "日志目录: $installDir\logs"
