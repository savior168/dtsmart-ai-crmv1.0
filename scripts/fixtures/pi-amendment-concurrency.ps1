param([int]$Port = 55453, [string]$Database = 'postgres', [string]$DatabaseUser = 'postgres')

$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$stockId = '99999999-9999-4999-8999-999999999993'
$orderId = '99999999-9999-4999-8999-999999999992'
$actorId = '88888888-8888-4888-8888-888888888881'
$adapterId = '99999999-9999-4999-8999-999999999997'
$query = @"
set test.actor_id='$actorId';
select (public.request_direct_pi_amendment(
  '$orderId', 3,
  (select jsonb_agg(to_jsonb(i) || jsonb_build_object('quantity',
    case when i.id='$adapterId'::uuid then 2 else i.quantity end) order by i.line_number)
   from public.sales_order_items i where i.sales_order_id='$orderId'
     and i.pi_amendment_cancelled_at is null),
  'concurrent customer addition')).id;
"@
$lockQuery = "begin; select id from public.stock_orders where id='$stockId' for update; select pg_sleep(5); commit;"
$psqlArgs = @('-X', '-h', '127.0.0.1', '-p', [string]$Port, '-U', $DatabaseUser, '-d', $Database, '-v', 'ON_ERROR_STOP=1')

# The holder makes both writers contend for the same stock row. A second
# request must re-check the version and pending unique index after the lock.
$holder = Start-Job -ScriptBlock {
  param($binary, $dbPort, $database, $databaseUser, $sql)
  & $binary -X -h 127.0.0.1 -p $dbPort -U $databaseUser -d $database -v ON_ERROR_STOP=1 -c $sql 2>&1 | Out-Null
  return $LASTEXITCODE
} -ArgumentList $psql, $Port, $Database, $DatabaseUser, $lockQuery
try {
  Start-Sleep -Milliseconds 400
  if ($holder.State -ne 'Running') { throw 'Could not hold the stock row lock for concurrency test' }
  $writers = @((1..2) | ForEach-Object {
    Start-Job -ScriptBlock {
      param($binary, $dbPort, $database, $databaseUser, $sql)
      $output = & $binary -X -h 127.0.0.1 -p $dbPort -U $databaseUser -d $database -v ON_ERROR_STOP=1 -c $sql 2>&1 | Out-String
      [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
    } -ArgumentList $psql, $Port, $Database, $DatabaseUser, $query
  })
  $null = $writers | Wait-Job -Timeout 30
  $result = @($writers | Receive-Job -ErrorAction Continue)
  if ($result.Count -ne 2 -or @($result | Where-Object ExitCode -eq 0).Count -ne 1 -or
    @($result | Where-Object ExitCode -ne 0).Count -ne 1) {
    throw ('Expected exactly one successful request and one conflict: ' + ($result | ConvertTo-Json -Compress))
  }
  $check = & $psql @psqlArgs -At -c "select count(*) from public.pi_amendment_requests where sales_order_id='$orderId' and status='PENDING';" 2>&1
  if ($LASTEXITCODE -ne 0 -or $check.Trim() -ne '1') { throw "Expected one pending request; got $check" }
  Write-Output 'Concurrent PI amendment: one pending request, one rejected duplicate.'
} finally {
  if ($writers) { $writers | Remove-Job -Force -ErrorAction SilentlyContinue }
  $holder | Wait-Job -Timeout 10 | Out-Null
  $holder | Remove-Job -Force -ErrorAction SilentlyContinue
}
