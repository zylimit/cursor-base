#!/usr/bin/env pwsh
# install-githooks.ps1 -- explicit switch for the git hooks layer (PowerShell equivalent of
# install-githooks.sh). Points core.hooksPath at .claude/githooks.
# OFF BY DEFAULT: setup.sh / setup.ps1 never touch core.hooksPath. The git hooks are an
# optional layer, and silently repointing hooksPath would disable whatever the user already
# has in .git/hooks -- that is not a decision an installer gets to make for someone.
# Writes repository-local config only (.git/config), never global.
# Usage: pwsh .claude/scripts/install-githooks.ps1 on|off|status   (no args = status)
#
# Note on Windows: git runs these hooks through its own bundled sh (Git for Windows), so the
# POSIX /bin/sh hooks work as-is. There is no .ps1 copy of the hooks themselves and there
# should not be -- git picks the hook file by name, not by extension.
param(
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$rel = '.claude/githooks'
$hooksDir = Join-Path $projectDir '.claude/githooks'

Set-Location -LiteralPath $projectDir
& git rev-parse --show-toplevel *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error 'install-githooks: not a git repository (git rev-parse --show-toplevel failed)' -ErrorAction Continue
    exit 2
}

function Get-HooksPath {
    $v = & git config --get core.hooksPath 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    if ($null -eq $v) { return '' }
    return ($v | Select-Object -First 1).Trim()
}

switch ($Action) {
    'on' {
        if (-not (Test-Path -LiteralPath $hooksDir -PathType Container)) {
            Write-Error "install-githooks: $hooksDir not found" -ErrorAction Continue
            exit 2
        }
        $prev = Get-HooksPath
        if ($prev -and $prev -ne $rel) {
            # Something else owns this seat (husky, lefthook, a hand-rolled dir). Overwriting
            # would switch all of it off, which is a remove-existing-asset call for a human.
            Write-Error "install-githooks: core.hooksPath is already taken (currently $prev)." -ErrorAction Continue
            Write-Output '  Overwriting would disable that hook set. Decide first, then run by hand:'
            Write-Output "    git config core.hooksPath $rel"
            exit 2
        }
        & git config core.hooksPath $rel
        if ($LASTEXITCODE -ne 0) {
            Write-Error 'install-githooks: git config write failed' -ErrorAction Continue
            exit 2
        }
        Write-Output "install-githooks: on (core.hooksPath = $rel, this repository only)"
        Write-Output '  Wired: pre-commit (static checks) / commit-msg (subject floor) / pre-push (full regression)'
        Write-Output '  Off:   pwsh .claude/scripts/install-githooks.ps1 off'
        Write-Output '         or just git config --unset core.hooksPath'
        Write-Output '  One-off bypass: git commit --no-verify / git push --no-verify -- HIGH tier, owe a human an explanation'
        Write-Output '         (that is a reduced gate, not a full pass)'
    }
    'off' {
        $prev = Get-HooksPath
        if (-not $prev) {
            Write-Output 'install-githooks: off (core.hooksPath was not set)'
        }
        elseif ($prev -ne $rel) {
            # Not ours, so not ours to remove.
            Write-Error "install-githooks: left alone (core.hooksPath = $prev, not set by cc-base)" -ErrorAction Continue
            Write-Output '  Clear it yourself if you mean to: git config --unset core.hooksPath'
            exit 2
        }
        else {
            & git config --unset core.hooksPath 2>$null | Out-Null
            Write-Output 'install-githooks: off (core.hooksPath cleared, git back to .git/hooks)'
        }
    }
    'status' {
        $prev = Get-HooksPath
        if ($prev -eq $rel) {
            Write-Output "install-githooks: on (core.hooksPath = $prev)"
            foreach ($h in @('pre-commit', 'commit-msg', 'pre-push')) {
                $p = Join-Path $hooksDir $h
                if (Test-Path -LiteralPath $p -PathType Leaf) {
                    Write-Output "  ${h}: present"
                }
                else {
                    Write-Output "  ${h}: MISSING ($p)"
                }
            }
        }
        elseif ($prev) {
            Write-Output "install-githooks: off (core.hooksPath = $prev, owned by another tool)"
        }
        else {
            Write-Output 'install-githooks: off (core.hooksPath unset, git uses .git/hooks)'
        }
    }
    default {
        Write-Error 'usage: pwsh .claude/scripts/install-githooks.ps1 on|off|status' -ErrorAction Continue
        exit 2
    }
}
exit 0
