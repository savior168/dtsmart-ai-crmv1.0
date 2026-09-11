param([switch]$ValidateOnly)

$ErrorActionPreference = 'Stop'
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:ProgramData 'DTSmart\AIWorker'
$taskName = 'DTSmart-AI-Worker'

$packageFiles = @(
  (Join-Path $sourceDir 'app\index.js'),
  (Join-Path $sourceDir 'runtime\node.exe'),
  (Join-Path $sourceDir 'run-worker.ps1'),
  (Join-Path $sourceDir 'worker.env.example')
)
foreach ($file in $packageFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "安装包缺少文件: $file" }
}

if ($ValidateOnly) {
  & (Join-Path $sourceDir 'runtime\node.exe') --check (Join-Path $sourceDir 'app\index.js')
  if ($LASTEXITCODE -ne 0) { throw 'Worker程序语法检查失败。' }
  Write-Host 'INSTALLER_VALIDATION_OK'
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw '安装程序必须以管理员身份运行。'
}

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
}

$required = @('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
function Read-WorkerEnvironment([string]$Path) {
  $result = @{}
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $result[$parts[0].Trim()] = $parts[1].Trim() }
  }
  return $result
}

$values = Read-WorkerEnvironment $targetEnv
$missing = @($required | Where-Object { -not $values[$_] })
if ($missing.Count -gt 0) {
  Write-Host "请在打开的配置文件中填写必填项：$($missing -join ', ')" -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList $targetEnv -Wait
  $values = Read-WorkerEnvironment $targetEnv
  $missing = @($required | Where-Object { -not $values[$_] })
}
if ($missing.Count -gt 0) { throw "worker.env 仍缺少必填项：$($missing -join ', ')，安装已停止。" }

icacls $targetEnv /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$installDir\run-worker.ps1`"" -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'DT Smart AI screening durable local worker' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$online = $false
$startupFailure = $null
$logFile = Join-Path $installDir ("logs\worker-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
for ($attempt = 0; $attempt -lt 15; $attempt += 1) {
  if (Test-Path -LiteralPath $logFile) {
    $tail = Get-Content -LiteralPath $logFile -Tail 60 -ErrorAction SilentlyContinue
    if ($tail -match '"event":"worker_online"') { $online = $true; break }
    $failedLine = $tail | Where-Object { $_ -match '"event":"startup_failed"' } | Select-Object -Last 1
    if ($failedLine) { $startupFailure = $failedLine; break }
  }
  Start-Sleep -Seconds 2
}
$state = (Get-ScheduledTask -TaskName $taskName).State
if (-not $online) {
  if ($startupFailure) { throw "Worker启动失败: $startupFailure" }
  throw "计划任务状态为 $state，但30秒内没有收到Worker上线日志。请查看 $logFile"
}
Write-Host "安装完成。服务状态: $state" -ForegroundColor Green
Write-Host 'Worker已连接数据库并写入上线心跳。' -ForegroundColor Green
Write-Host "日志目录: $installDir\logs"
