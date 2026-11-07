param([ValidateSet('Start','Status','Stop')][string]$Action = 'Status', [string]$JarPath = '', [string]$JavaExe = '', [string]$NodeExe = '')
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'Common.ps1')
$NodeExe = Find-Node $NodeExe
$cfg = Get-OperatorConfig $NodeExe
$proxyRoot = $cfg.proxyRoot
$proxyPort = $cfg.port
if (-not $JavaExe) { $JavaExe = $cfg.java }
$receiptPath = Join-Path $proxyRoot 'operator-proxy.json'
function Remove-MatchingReceipt($Expected) {
    if (-not $Expected -or -not (Test-Path -LiteralPath $receiptPath)) { return }
    $current = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
    if ($current.Pid -eq $Expected.Pid -and $current.StartTicks -eq $Expected.StartTicks -and $current.Executable -eq $Expected.Executable -and $current.CommandLine -eq $Expected.CommandLine) {
        Remove-Item -LiteralPath $receiptPath -ErrorAction Stop
    }
}
if ($Action -eq 'Start') {
    if (Test-Path -LiteralPath $receiptPath) {
        $previous = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
        $previousNative = Get-Process -Id $previous.Pid -ErrorAction SilentlyContinue
        if ($previousNative) {
            $previousMatches = $false
            try {
                $previousCim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $previous.Pid)
                $previousMatches = $previousNative.StartTime.ToUniversalTime().Ticks.ToString() -eq $previous.StartTicks -and $previousNative.Path -eq $previous.Executable -and $previousCim.CommandLine -eq $previous.CommandLine
            } catch { }
            if ($previousMatches) { throw 'The operator-owned proxy is already running.' }
        }
    }
    if (Get-NetTCPConnection -State Listen -LocalPort $proxyPort -ErrorAction SilentlyContinue) { throw 'Configured proxy port is occupied; inspect its owner before starting.' }
    if (-not $JarPath) { $JarPath = $cfg.jar }
    if (-not (Test-Path -LiteralPath $JarPath -PathType Leaf)) { throw 'ViaProxy jar missing. Run the explicit Update action first.' }
    if (-not (Test-Path -LiteralPath $JavaExe -PathType Leaf)) { throw 'Specify -JavaExe using the direct JDK executable, not the Oracle javapath shim.' }
    $proxyArgs = @($cfg.proxyArguments)
    $proxyArgs[2] = $JarPath
    $arguments = ($proxyArgs | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }) -join ' '
    $logRoot = $cfg.logRoot
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $logStem = Join-Path $logRoot ('proxy-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    $child = Start-Process -FilePath $JavaExe -ArgumentList $arguments -WorkingDirectory $proxyRoot -NoNewWindow -PassThru -RedirectStandardOutput ($logStem + '.stdout.log') -RedirectStandardError ($logStem + '.stderr.log')
    $null = $child.Handle
    $receipt = $null
    try {
        $native = Get-Process -Id $child.Id -ErrorAction Stop
        $cim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $child.Id)
        $receipt = [pscustomobject]@{Pid=$child.Id;StartTicks=$native.StartTime.ToUniversalTime().Ticks.ToString();Executable=$native.Path;CommandLine=$cim.CommandLine}
        [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        Write-Host ('Foreground ViaProxy PID ' + $child.Id + '. Logs: ' + $logStem + '.stdout.log and .stderr.log. Use Proxy.ps1 Stop in another terminal, or Ctrl+C here.')
    } catch {
        if (-not $child.HasExited) { throw }
    }
    $child.WaitForExit()
    $nativeExit = $child.ExitCode
    Remove-MatchingReceipt $receipt
    if ($null -eq $nativeExit) { throw ('ViaProxy exit code is unavailable. Inspect ' + $logStem + '.stdout.log and .stderr.log.') }
    if ($nativeExit -ne 0) { Write-Host ('ViaProxy failed with exit code ' + $nativeExit + '. Inspect ' + $logStem + '.stdout.log and .stderr.log.') -ForegroundColor Red }
    exit $nativeExit
}
if (-not (Test-Path -LiteralPath $receiptPath)) { Write-Output 'No operator-owned proxy receipt. Inspect any existing listener; this helper will not adopt it.'; exit 0 }
$receipt = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
$native = Get-Process -Id $receipt.Pid -ErrorAction SilentlyContinue
if (-not $native) { Write-Output 'Operator-owned proxy is stopped.'; exit 0 }
$identityMatches = $false
try {
    $cim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $receipt.Pid)
    $identityMatches = $native.StartTime.ToUniversalTime().Ticks.ToString() -eq $receipt.StartTicks -and $native.Path -eq $receipt.Executable -and $cim.CommandLine -eq $receipt.CommandLine
} catch { }
if (-not $identityMatches) {
    if ($Action -eq 'Status') { Write-Output 'Proxy receipt is stale; the operator-owned proxy is stopped.'; exit 0 }
    throw 'Proxy identity differs from receipt; refusing to operate on that PID.'
}
if ($Action -eq 'Status') {
    [pscustomobject]@{Pid=$native.Id;Running=$true;LoopbackListener=[bool](Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $proxyPort -OwningProcess $native.Id -ErrorAction SilentlyContinue)} | ConvertTo-Json -Compress
    exit 0
}
$children = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $native.Id))
if ($children.Count) { throw 'Proxy has child processes; inspect its actual tree before stopping.' }
$null = $native.Handle
Stop-Process -Id $native.Id -ErrorAction Stop
if (-not $native.WaitForExit(10000)) { throw 'Proxy did not exit within 10 seconds.' }
if (Get-NetTCPConnection -State Listen -LocalPort $proxyPort -ErrorAction SilentlyContinue) { throw 'Configured proxy port still has a listener; inspect its owner.' }
Remove-MatchingReceipt $receipt
Write-Output 'Operator-owned proxy stopped; configured port is closed.'
