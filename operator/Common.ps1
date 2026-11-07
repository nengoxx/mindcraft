$script:OperatorRoot = $PSScriptRoot
function Find-Node([string]$Requested) {
    if ($Requested) { return $Requested }
    if ($env:MINDCRAFT_NODE) { return $env:MINDCRAFT_NODE }
    $tools = Join-Path (Split-Path $script:OperatorRoot -Parent) 'runtime\tools'
    $nodes = @(Get-ChildItem -LiteralPath $tools -Filter node.exe -Recurse -File)
    if ($nodes.Count -ne 1) { throw 'Install one private Node22 in runtime/tools, set MINDCRAFT_NODE or pass -NodeExe.' }
    return $nodes[0].FullName
}
function Get-OperatorConfig([string]$Node) {
    $text = & $Node (Join-Path $script:OperatorRoot 'config.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read runtime/config. Copy the generic examples and configure them first.' }
    return ($text | ConvertFrom-Json)
}
