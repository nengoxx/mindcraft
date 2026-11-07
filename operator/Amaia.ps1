param([ValidateSet('Start','Stop','Status','Update')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$powershell = Join-Path $PSHOME 'powershell.exe'
. (Join-Path $PSScriptRoot 'Common.ps1')
$NodeExe = Find-Node ''
$cfg = Get-OperatorConfig $NodeExe

function Invoke-Helper([string]$Name, [string]$Operation) {
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot ($Name + '.ps1')) $Operation 2>&1 | ForEach-Object { [string]$_ })
        $nativeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
    }
    $record = $null
    foreach ($line in $lines) {
        if ($line -match '^\{.*\}$') {
            try { $record = $line | ConvertFrom-Json -ErrorAction Stop } catch { }
        }
    }
    [pscustomobject]@{ExitCode=$nativeExit;Record=$record;Output=($lines -join [Environment]::NewLine)}
}

function Test-Port([int]$Port) {
    [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Get-Proxy {
    $result = Invoke-Helper 'Proxy' 'Status'
    if ($result.ExitCode -ne 0) { throw ('Proxy status failed: ' + $result.Output) }
    if ($result.Record -and $result.Record.Running) {
        if ((Test-Port $cfg.port) -and -not $result.Record.LoopbackListener) { throw 'Configured proxy port is not the receipt-bound loopback proxy. Inspect its owner.' }
        return $result.Record
    }
    if (Test-Port $cfg.port) { throw 'Configured proxy port is occupied without a matching operator proxy receipt. Nothing was adopted.' }
    return $null
}

function Get-App {
    if (-not (Test-Port $cfg.mindserverPort)) { return $null }
    $result = Invoke-Helper 'Mindcraft' 'Status'
    if ($result.ExitCode -ne 0 -or -not $result.Record -or $result.Record.name -ne $cfg.name) {
        throw ('Configured MindServer port did not identify the existing Amaia MindServer. Inspect it before launching: ' + $result.Output)
    }
    return $result.Record
}

function Open-Component([string]$Name) {
    $script = Join-Path $PSScriptRoot ($Name + '.ps1')
    Start-Process -FilePath $powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',('"' + $script + '"'),'Start') -WorkingDirectory $appRoot -WindowStyle Normal | Out-Null
}

function Wait-Ready([scriptblock]$Check, [int]$Seconds, [string]$Description) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    $lastFailure = ''
    do {
        try {
            $ready = & $Check
            if ($ready) { return $ready }
        } catch { $lastFailure = $_.Exception.Message }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw ($Description + ' was not ready within ' + $Seconds + ' seconds. ' + $lastFailure)
}

$mutex = New-Object Threading.Mutex($false, ('Local\MindcraftLauncher-' + $cfg.name))
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { throw 'Another Amaia launcher is busy. Let it finish before using Start, Stop or Status again.' }
    $app = Get-App
    $proxy = Get-Proxy
    if ($Action -eq 'Update') {
        & $NodeExe (Join-Path $PSScriptRoot 'update.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'ViaProxy update failed; inspect the output.' }
    } elseif ($Action -eq 'Start') {
        if (-not $proxy) { Open-Component 'Proxy' }
        $proxy = Wait-Ready { $p = Get-Proxy; if ($p -and $p.LoopbackListener) { $p } } 20 'The owned loopback proxy'
        if (-not $app) {
            Open-Component 'Mindcraft'
            $app = Wait-Ready { Get-App } 40 'Amaia MindServer'
        } else {
            Write-Host 'Amaia MindServer is already running; no duplicate bot was started.'
        }
        Write-Host 'Amaia components are running. The game server must be online for the bot to join.'
        Write-Host ('Use /msg ' + $cfg.name + ' hello as an allowed owner. An offline bot in an existing UI needs full Stop then Start.')
    } elseif ($Action -eq 'Stop') {
        if ($app) {
            $result = Invoke-Helper 'Mindcraft' 'Stop'
            if ($result.ExitCode -ne 0) { throw ('Mindcraft shutdown failed: ' + $result.Output) }
            $null = Wait-Ready { if (-not (Test-Port $cfg.mindserverPort)) { $true } } 10 'MindServer shutdown'
        }
        if ($proxy) {
            $result = Invoke-Helper 'Proxy' 'Stop'
            if ($result.ExitCode -ne 0) { throw ('Proxy shutdown failed: ' + $result.Output) }
        }
        Write-Host 'Amaia MindServer and the operator-owned proxy are stopped.'
    }
    if ($Action -ne 'Stop') {
        [pscustomobject]@{ProxyRunning=[bool]$proxy;ProxyLoopbackReady=[bool]($proxy -and $proxy.LoopbackListener);Amaia=$app} | ConvertTo-Json -Depth 6
    }
    Write-Host ('Component logs: ' + $cfg.logRoot)
} catch {
    Write-Host ('Amaia ' + $Action + ' failed: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ('Inspect component windows and logs in ' + $cfg.logRoot + '. Existing components were not automatically restarted or removed.')
    throw
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
