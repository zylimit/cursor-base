#!/usr/bin/env pwsh
# setup.ps1 - cursor-base Windows PowerShell thin wrapper (PowerShell 5.1+ / pwsh 7+).
# Pure 7-bit ASCII without UTF-8 BOM. Validates node >= 20 and forwards to scripts/cursor-base.mjs.
# Examples:
#   pwsh -File .\setup.ps1 D:\proj
#   pwsh -File .\setup.ps1 -Target D:\proj -DryRun
#   pwsh -File .\setup.ps1 -Target D:\proj -WithCc -CcBase D:\cc-base
#   pwsh -File .\setup.ps1 -Target D:\proj -NoAutoCc
#   pwsh -File .\setup.ps1 upgrade -Target D:\proj -Force
#   pwsh -File .\setup.ps1 -Uninstall -Target D:\proj
#   pwsh -File .\setup.ps1 release v3.0.0 -BundleCc D:\cc-base -Out D:\cursor-base-v3.0.0.tar.gz
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = '',
  [string]$Target = '',
  [switch]$DryRun,
  [switch]$Force,
  [switch]$Uninstall,
  [switch]$SourceCheck,
  [switch]$WithCc,
  [switch]$NoAutoCc,
  [string]$CcBase = '',
  [string]$BundleCc = '',
  [string]$Out = '',
  [ValidateSet('', 'string', 'exec')]
  [string]$HookForm = '',
  [switch]$Json,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs = @()
)

$ErrorActionPreference = 'Stop'

function Exit-Usage([string]$Message) {
  [Console]::Error.WriteLine("setup: $Message")
  [Console]::Error.WriteLine('Usage: pwsh -File .\setup.ps1 [install|upgrade|uninstall|doctor|manifest|pack-check|release] [-Target <dir> | <dir>] [-DryRun] [-Force] [-Uninstall] [-WithCc] [-NoAutoCc] [-CcBase <dir>] [-BundleCc <dir>] [-Out <path>] [-Json]')
  exit 2
}

$KnownCommands = @('install', 'upgrade', 'uninstall', 'doctor', 'manifest', 'pack-check', 'release', 'help')
$CommonTypoCommands = @(
  'package', 'pack', 'bundle', 'check', 'verify', 'test', 'tests',
  'lint', 'audit', 'status', 'init', 'update', 'remove', 'clean', 'version'
)
$AllowedForwardFlags = @(
  '--dry-run', '--force', '--uninstall', '--source-check',
  '--with-cc', '--no-auto-cc',
  '--write', '--check', '--leak', '--print', '--json', '--strict-syntax', '-h', '--help'
)

# PowerShell 7 -File binds --dryrun case-insensitively to switch -DryRun before $ExtraArgs.
# Inspect raw OS CLI argv so any unknown double-dash option (e.g. --dryrun) exits 2 with zero writes.
$rawCli = [Environment]::GetCommandLineArgs()
$rawStartIdx = -1
$sawFileFlag = $false
$selfName = ([string]$PSCommandPath -split '[\\/]')[-1]
for ($idx = 1; $idx -lt $rawCli.Length; $idx++) {
  if ($rawCli[$idx] -imatch '^[-/](?:f|file)$' -and ($idx + 1) -lt $rawCli.Length) {
    $sawFileFlag = $true
    $fileArgName = ([string]$rawCli[$idx + 1] -split '[\\/]')[-1]
    if (-not $selfName -or ($fileArgName -ieq $selfName)) {
      $rawStartIdx = $idx + 2
    }
    break
  }
}
if (-not $sawFileFlag -and $rawStartIdx -lt 0 -and $selfName) {
  for ($idx = 1; $idx -lt $rawCli.Length; $idx++) {
    if ($rawCli[$idx] -imatch '^[-/](?:c|command|e|ec|encodedcommand)$') {
      break
    }
    $candName = ([string]$rawCli[$idx] -split '[\\/]')[-1]
    if ($candName -and ($candName -ieq $selfName)) {
      $rawStartIdx = $idx + 1
      break
    }
  }
}
if ($rawStartIdx -ge 0 -and $rawStartIdx -lt $rawCli.Length) {
  for ($ri = $rawStartIdx; $ri -lt $rawCli.Length; $ri++) {
    $ra = [string]$rawCli[$ri]
    if ($ra -eq '--') { break }
    if (
      ($ra -imatch '^-(?:Target|CcBase|BundleCc|Out|HookForm)$') -or
      ($ra -ceq '--target') -or ($ra -ceq '--cc-base') -or ($ra -ceq '--bundle-cc') -or ($ra -ceq '--out') -or ($ra -ceq '--hook-form')
    ) {
      if (($ri + 1) -lt $rawCli.Length -and -not ([string]$rawCli[$ri + 1]).StartsWith('-')) {
        $ri++
      }
      continue
    }
    if ($ra.StartsWith('--')) {
      $isExactAllowed = ($AllowedForwardFlags -ccontains $ra) -or ($ra -cmatch '^--(target|cc-base|bundle-cc|out|hook-form)=')
      if (-not $isExactAllowed) {
        Exit-Usage "unknown option: $ra"
      }
    }
  }
}

$forwardArgs = New-Object System.Collections.Generic.List[string]
$resolvedCmd = ''
$resolvedTarget = $Target
$resolvedCcBase = $CcBase
$resolvedBundleCc = $BundleCc
$resolvedOut = $Out

if ($Command -ne '') {
  if ($KnownCommands -contains $Command) {
    $resolvedCmd = $Command
  }
  elseif ($Command.StartsWith('-')) {
    $ExtraArgs = @($Command) + $ExtraArgs
  }
  else {
    if ($Target -eq '' -and ($Command -cmatch '^[a-z]+$') -and ($CommonTypoCommands -contains $Command)) {
      Exit-Usage "unknown subcommand '$Command' (to install into a directory named '$Command', pass -Target ./$Command)"
    }
    if ($resolvedTarget -ne '') {
      Exit-Usage "both positional target ($Command) and -Target ($resolvedTarget) were specified; pass only one"
    }
    $resolvedTarget = $Command
  }
}

for ($i = 0; $i -lt $ExtraArgs.Count; $i++) {
  $arg = $ExtraArgs[$i]
  if ($AllowedForwardFlags -contains $arg) {
    [void]$forwardArgs.Add($arg)
    continue
  }
  if ($arg -eq '--target' -or $arg -eq '--cc-base' -or $arg -eq '--bundle-cc' -or $arg -eq '--out' -or $arg -eq '--hook-form') {
    if (($i + 1) -ge $ExtraArgs.Count -or $ExtraArgs[$i + 1].StartsWith('-')) {
      Exit-Usage "option $arg requires a value"
    }
    $val = $ExtraArgs[$i + 1]
    $i++
    if ($arg -eq '--target') {
      if ($resolvedTarget -ne '') { Exit-Usage "duplicate target specified ($resolvedTarget vs $val)" }
      $resolvedTarget = $val
    }
    elseif ($arg -eq '--cc-base') {
      $resolvedCcBase = $val
    }
    elseif ($arg -eq '--bundle-cc') {
      $resolvedBundleCc = $val
    }
    elseif ($arg -eq '--out') {
      $resolvedOut = $val
    }
    elseif ($arg -eq '--hook-form') {
      if ($val -ne 'string' -and $val -ne 'exec') { Exit-Usage "--hook-form expects 'string' or 'exec' (got: $val)" }
      $HookForm = $val
    }
    continue
  }
  if ($arg.StartsWith('--target=')) {
    $val = $arg.Substring(9)
    if (-not $val) { Exit-Usage '--target= requires a non-empty value' }
    if ($resolvedTarget -ne '') { Exit-Usage "duplicate target specified ($resolvedTarget vs $val)" }
    $resolvedTarget = $val
    continue
  }
  if ($arg.StartsWith('--cc-base=')) {
    $val = $arg.Substring(10)
    if (-not $val) { Exit-Usage '--cc-base= requires a non-empty value' }
    $resolvedCcBase = $val
    continue
  }
  if ($arg.StartsWith('--bundle-cc=')) {
    $val = $arg.Substring(12)
    if (-not $val) { Exit-Usage '--bundle-cc= requires a non-empty value' }
    $resolvedBundleCc = $val
    continue
  }
  if ($arg.StartsWith('--out=')) {
    $val = $arg.Substring(6)
    if (-not $val) { Exit-Usage '--out= requires a non-empty value' }
    $resolvedOut = $val
    continue
  }
  if ($arg.StartsWith('--hook-form=')) {
    $val = $arg.Substring(12)
    if ($val -ne 'string' -and $val -ne 'exec') { Exit-Usage "--hook-form expects 'string' or 'exec' (got: $val)" }
    $HookForm = $val
    continue
  }
  if ($arg.StartsWith('-')) {
    Exit-Usage "unknown option: $arg"
  }
  if ($resolvedCmd -eq '' -and ($KnownCommands -contains $arg)) {
    $resolvedCmd = $arg
    continue
  }
  if ($resolvedCmd -eq 'release') {
    [void]$forwardArgs.Add($arg)
    continue
  }
  if ($resolvedTarget -eq '') {
    if ($resolvedCmd -eq '' -and $Target -eq '' -and ($arg -cmatch '^[a-z]+$') -and ($CommonTypoCommands -contains $arg)) {
      Exit-Usage "unknown subcommand '$arg' (to install into a directory named '$arg', pass -Target ./$arg)"
    }
    $resolvedTarget = $arg
  }
  else {
    Exit-Usage "unexpected extra positional argument: $arg"
  }
}

if (($WithCc -or ($forwardArgs -contains '--with-cc')) -and ($NoAutoCc -or ($forwardArgs -contains '--no-auto-cc'))) {
  Exit-Usage '-WithCc and -NoAutoCc cannot be used together'
}

if ($Uninstall) {
  if ($resolvedCmd -ne '' -and $resolvedCmd -ne 'install' -and $resolvedCmd -ne 'uninstall') {
    Exit-Usage "-Uninstall cannot be combined with subcommand '$resolvedCmd'"
  }
  $resolvedCmd = 'uninstall'
}
if ($resolvedCmd -eq '') {
  $resolvedCmd = 'install'
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  [Console]::Error.WriteLine('[setup] missing required runtime: node (>= 20)')
  exit 3
}

$majorStr = (& node -p "process.versions.node.split('.')[0]" 2>$null | Out-String).Trim()
$majorInt = 0
if (-not [int]::TryParse($majorStr, [ref]$majorInt) -or $majorInt -lt 20) {
  $verStr = (& node --version 2>$null | Out-String).Trim()
  [Console]::Error.WriteLine("[setup] node >= 20 required (found: $verStr)")
  exit 3
}

$cliArgs = New-Object System.Collections.Generic.List[string]
[void]$cliArgs.Add($resolvedCmd)

if ($resolvedTarget -ne '') {
  [void]$cliArgs.Add('--target')
  [void]$cliArgs.Add($resolvedTarget)
}
if ($DryRun -and -not ($forwardArgs -contains '--dry-run')) { [void]$cliArgs.Add('--dry-run') }
if ($Force -and -not ($forwardArgs -contains '--force')) { [void]$cliArgs.Add('--force') }
if ($SourceCheck -and -not ($forwardArgs -contains '--source-check')) { [void]$cliArgs.Add('--source-check') }
if ($WithCc -and -not ($forwardArgs -contains '--with-cc')) { [void]$cliArgs.Add('--with-cc') }
if ($NoAutoCc -and -not ($forwardArgs -contains '--no-auto-cc')) { [void]$cliArgs.Add('--no-auto-cc') }
if ($Json -and -not ($forwardArgs -contains '--json')) { [void]$cliArgs.Add('--json') }
if ($resolvedCcBase -ne '') {
  [void]$cliArgs.Add('--cc-base')
  [void]$cliArgs.Add($resolvedCcBase)
}
if ($resolvedBundleCc -ne '') {
  [void]$cliArgs.Add('--bundle-cc')
  [void]$cliArgs.Add($resolvedBundleCc)
}
if ($resolvedOut -ne '') {
  [void]$cliArgs.Add('--out')
  [void]$cliArgs.Add($resolvedOut)
}
if ($HookForm -ne '') {
  [void]$cliArgs.Add('--hook-form')
  [void]$cliArgs.Add($HookForm)
}
foreach ($fa in $forwardArgs) {
  [void]$cliArgs.Add($fa)
}

$entryScript = Join-Path $PSScriptRoot 'scripts\cursor-base.mjs'
& node $entryScript @cliArgs
exit $LASTEXITCODE
