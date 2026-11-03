#!/usr/bin/env pwsh
# fix-platform.ps1 -Normalize an older .sh/.ps1 install of this framework to the single runtime (node runs .mjs).
# After an upgrade the target still holds hook files nobody ships any more, and settings.json still points at them -
# a command pointing at a deleted file is one hook error per event. Run once after upgrading or moving; idempotent.
# Two jobs here: (1) delete leftover .claude/hooks/*.sh|*.ps1 (lib-* included), (2) rewrite settings.json hook
# commands to .mjs entries and normalize statusLine to statusline.mjs. No chmod: nothing under hooks/ is a shell
# script any more, and Windows has no exec bit anyway.
# Rewritten entries follow the form the file already uses: if any .mjs entry is string form
# ("node .claude/hooks/<name>.mjs", the one Cursor reads), the rewrite is string form too, otherwise exec form.
# Entries already on .mjs are never rewritten, whichever form they are in - converting forms is hook-form.mjs's job.
# No dependency on the cc-base repo or jq -uses pwsh built-in ConvertFrom-Json/ConvertTo-Json.
# Usage: pwsh -File fix-platform.ps1 [-Target <dir>]    -Target defaults to "." or reads CLAUDE_PROJECT_DIR.
[CmdletBinding()]
param(
  [string]$Target = '.'
)
$ErrorActionPreference = 'Stop'

# Locate project root: CLAUDE_PROJECT_DIR first, then -Target (defaults to current dir).
$projectRoot = $env:CLAUDE_PROJECT_DIR
if (-not $projectRoot) { $projectRoot = (Resolve-Path $Target).Path }
$settings = Join-Path $projectRoot '.claude\settings.json'
if (-not (Test-Path $settings)) { throw "settings.json not found: $settings (run from project root, or set CLAUDE_PROJECT_DIR)" }

Write-Host '=== fix-platform (Windows/.ps1) ===' -ForegroundColor Cyan

# exec form template, byte-identical to the shipped settings.json: placeholders are brace-only, path forward-slash only.
$argForm = '${CLAUDE_PROJECT_DIR}/.claude/hooks/'
# string form template, same as hook-form.mjs: no args key, path relative to the project root, forward slashes, no placeholder.
$stringForm = 'node .claude/hooks/'

function Test-IsStringForm($h) {
  if ($null -eq $h) { return $false }
  if ($h.PSObject.Properties['args']) { return $false }
  if (-not ($h.PSObject.Properties['command'] -and $h.command)) { return $false }
  return ([string]$h.command -cmatch '^node \.claude/hooks/[A-Za-z0-9_-]+\.mjs$')
}

# Legacy hook detection: the command or one of its args points at .claude/hooks/<name>.sh|.ps1. Only the framework's
# own entries look like that, so user-defined commands are left alone. Returns the hook name, or $null.
function Get-LegacyHookName($h) {
  if ($null -eq $h) { return $null }
  $parts = @()
  if ($h.PSObject.Properties['command'] -and $h.command) { $parts += [string]$h.command }
  if ($h.PSObject.Properties['args'] -and $h.args) { foreach ($a in @($h.args)) { $parts += [string]$a } }
  foreach ($p in $parts) {
    if ($p -match '\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.(sh|ps1)') { return $Matches[1] }
  }
  return $null
}

# Same shape, for entries that are already on .mjs in either form (used for dedup so a rewrite never doubles an entry).
function Get-MjsHookName($h) {
  if ($null -eq $h) { return $null }
  $parts = @()
  if ($h.PSObject.Properties['command'] -and $h.command) { $parts += [string]$h.command }
  if ($h.PSObject.Properties['args'] -and $h.args) { foreach ($a in @($h.args)) { $parts += [string]$a } }
  foreach ($p in $parts) {
    if ($p -match '\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.mjs') { return $Matches[1] }
  }
  return $null
}

$data = Get-Content $settings -Raw | ConvertFrom-Json
$converted = 0
$dropped = 0

# One string-form .mjs entry anywhere in the file means the rewrite follows it; otherwise exec form.
$useString = $false
if ($data.hooks) {
  foreach ($event in $data.hooks.PSObject.Properties) {
    foreach ($group in @($event.Value)) {
      if ($group -and $group.hooks) {
        foreach ($h in $group.hooks) { if (Test-IsStringForm $h) { $useString = $true } }
      }
    }
  }
}

if ($data.hooks) {
  foreach ($event in $data.hooks.PSObject.Properties) {
    $groups = $event.Value
    if (-not $groups) { continue }
    foreach ($group in $groups) {
      if (-not $group.hooks) { continue }
      # Collect the .mjs hook names already in this group first -use a hashtable as a set, to avoid the
      # PSToObjectArrayBinder binding bug in pwsh 7.6 when casting List[object]/HashSet[string] to arrays.
      $existing = @{}
      foreach ($h in $group.hooks) {
        $n = Get-MjsHookName $h
        if ($n) { $existing[$n] = $true }
      }
      $newList = @()
      foreach ($h in $group.hooks) {
        $name = Get-LegacyHookName $h
        if (-not $name) { $newList += $h; continue }
        if ($existing.ContainsKey($name)) { $dropped++; continue }
        # Rebuild as type / command / [args] / everything else the original carried (timeout, asyncRewake, ...).
        $newEntry = [pscustomobject]@{}
        $type = 'command'
        if ($h.PSObject.Properties['type'] -and $h.type) { $type = [string]$h.type }
        $newEntry | Add-Member -NotePropertyName type -NotePropertyValue $type -Force
        if ($useString) {
          $newEntry | Add-Member -NotePropertyName command -NotePropertyValue ($stringForm + $name + '.mjs') -Force
        } else {
          $newEntry | Add-Member -NotePropertyName command -NotePropertyValue 'node' -Force
          $newEntry | Add-Member -NotePropertyName args -NotePropertyValue @($argForm + $name + '.mjs') -Force
        }
        foreach ($p in $h.PSObject.Properties) {
          if ($p.Name -eq 'type' -or $p.Name -eq 'command' -or $p.Name -eq 'args') { continue }
          $newEntry | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
        }
        $newList += $newEntry
        $existing[$name] = $true
        $converted++
      }
      $group.hooks = $newList
    }
  }
}

# statusLine: normalize the framework status line to statusline.mjs. It has no exec form, only a shell string, and
# on a pure PowerShell box that string is run by PowerShell -hence the $env: spelling. Only a command pointing at
# the framework's own statusline is rewritten; a user status line stays.
$statusFixed = 0
if ($data.PSObject.Properties['statusLine'] -and $data.statusLine.command) {
  $c = [string]$data.statusLine.command
  if ($c -match '\.claude[/\\]scripts[/\\]statusline\.(sh|ps1)') {
    $data.statusLine.command = 'node "$env:CLAUDE_PROJECT_DIR/.claude/scripts/statusline.mjs"'
    $statusFixed = 1
  }
}

# Backup then write back. Keep the first backup: the copy worth having is the pre-migration original, and a
# second run would otherwise overwrite it with the already-normalized content -people usually run this again
# precisely because something looked wrong, which is the worst moment to lose the original.
if (Test-Path "$settings.bak") {
  Write-Host "backup: kept the existing $settings.bak (pre-migration copy)"
} else {
  Copy-Item $settings "$settings.bak" -Force
  Write-Host "backup: $settings.bak"
}
$data | ConvertTo-Json -Depth 20 | Set-Content $settings -Encoding UTF8

# Delete the hook files an older install left behind: .claude/hooks/*.sh|*.ps1, lib-*.sh / lib-*.ps1 included.
# Nothing ships them any more; left in place they only make doctor.sh / gate-audit.sh keep counting them.
$removed = 0
$hooksDir = Join-Path $projectRoot '.claude\hooks'
if (Test-Path $hooksDir) {
  $stale = @(Get-ChildItem $hooksDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.sh' -or $_.Extension -eq '.ps1' })
  foreach ($f in $stale) { Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue }
  $removed = $stale.Count
}

$formName = 'exec'
if ($useString) { $formName = 'string' }
Write-Host "fix-platform: converted to $formName form=$converted, dropped duplicate legacy entries=$dropped, statusline fixed=$statusFixed, removed legacy hook files=$removed" -ForegroundColor Green
Write-Host "Done. settings.json normalized to .mjs entries (node runs .mjs, in the form the file already used). Path: $settings" -ForegroundColor Green
exit 0
