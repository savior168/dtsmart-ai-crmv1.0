$ErrorActionPreference = 'Stop'
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $installDir 'worker.env'
$logDir = Join-Path $env:ProgramData 'DTSmart\AIWorker\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $envFile)) { throw "缺少配置文件: $envFile" }
Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $parts = $line.Split('=', 2)
  if ($parts.Count -eq 2) { [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process') }
}

$required = @('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { throw "worker.env 缺少 $name" }
}

$node = Join-Path $installDir 'runtime\node.exe'
$entry = Join-Path $installDir 'app\index.js'
if (-not (Test-Path -LiteralPath $node)) { throw "缺少内置Node运行时: $node" }
if (-not (Test-Path -LiteralPath $entry)) { throw "缺少Worker程序: $entry" }

while ($true) {
  $stamp = Get-Date -Format 'yyyyMMdd'
  $log = Join-Path $logDir "worker-$stamp.log"
  & $node $entry *>> $log
  $exitCode = $LASTEXITCODE
  "$(Get-Date -Format o) worker exited: $exitCode; restart in 5 seconds" | Out-File -LiteralPath $log -Append -Encoding utf8
  Start-Sleep -Seconds 5
}
