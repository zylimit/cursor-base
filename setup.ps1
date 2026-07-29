[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Target = ".",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$arguments = @(
    (Join-Path $root "scripts/harness.mjs"),
    "install",
    "--target",
    (Resolve-Path -LiteralPath $Target).Path
)
if ($DryRun) {
    $arguments += "--dry-run"
}

& node @arguments
exit $LASTEXITCODE
