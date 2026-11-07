param([ValidateSet('Start','Status','Stop')][string]$Action = 'Status', [string]$NodeExe = '')
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'Common.ps1')
$NodeExe = Find-Node $NodeExe
$cfg = Get-OperatorConfig $NodeExe
Set-Location -LiteralPath $appRoot
$logRoot = $cfg.logRoot
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot ('mindcraft-' + $Action.ToLowerInvariant() + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
Start-Transcript -LiteralPath $logPath | Out-Null
try {
    # Native stderr may contain warnings even on success; preserve its real exit code.
    $ErrorActionPreference = 'Continue'
    if ($Action -eq 'Start') {
        Write-Host 'Start ViaProxy in its own terminal first. Ctrl+C stops this foreground Mindcraft session.'
        & $NodeExe (Join-Path $PSScriptRoot 'run.mjs') 2>&1 | Out-Host
    } else {
        & $NodeExe (Join-Path $PSScriptRoot 'Control.mjs') $Action.ToLowerInvariant() 2>&1 | Out-Host
    }
    $nativeExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
    Stop-Transcript | Out-Null
}
exit $nativeExit
