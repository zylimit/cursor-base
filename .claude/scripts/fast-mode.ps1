#!/usr/bin/env pwsh
# fast-mode.ps1 -- the old tier switch, now a thin shell (PowerShell equivalent of fast-mode.sh).
# on/off/status all forward to the engine's `tier` subcommand; this script parses nothing and
# writes nothing. There is one reader (.claude/hooks/lib/tier.mjs) and one writer
# (harness.mjs tier set -> .claude/.runtime/tier.json); the old .claude/.fast-mode is neither
# read nor written any more -- two switch files coexisting is exactly how #38 happened.
# Usage: pwsh .claude/scripts/fast-mode.ps1 on [hours|--sticky] | off | status   (no args = status; hours defaults to 24)
# The 8-hour cap is applied and explained by the engine; 24 stays here only as the old default.
# 'on --sticky' (or 'on -Sticky') forwards to tier set fast --sticky: fast until revoked (TODO #91);
# 'off' revokes it. Sticky versus hours is judged by the engine, not here.
param(
    [string]$Action = 'status',
    [string]$Hours = '24',
    [switch]$Sticky
)

$ErrorActionPreference = 'Stop'
# A non-zero exit from the engine is an answer (2 = usage error), not a PowerShell failure.
# PowerShell 7.3+ turns native non-zero exits into terminating errors when ErrorActionPreference
# is Stop, which would swallow the engine's own exit code and report 1 for every one of them.
$PSNativeCommandUseErrorActionPreference = $false
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$harness = Join-Path $projectDir '.claude/harness/harness.mjs'

# stdout carries JSON for machines; only the engine's human line on stderr is passed through.
# When the engine cannot run, say so and give the way out that does not need it: a plain fast
# window expires on its own within 8 hours (a sticky one never does), and the runtime file can be
# deleted by hand.
function Invoke-Tier {
    param([string[]]$EngineArgs)
    if (-not (Test-Path -LiteralPath $harness -PathType Leaf)) {
        Write-Error "engine missing ($harness): the tier cannot be changed here. Delete .claude/.runtime/tier.json to force the default back; a plain fast window expires within 8h, a sticky one only by deleting the file." -ErrorAction Continue
        exit 3
    }
    if (-not $env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR = $projectDir }
    # stderr goes through a file rather than 2>&1: merging the two streams would put the JSON
    # and the human line in one pipeline, and telling them apart afterwards is guesswork.
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        & node $harness @EngineArgs 1>$null 2>$tmp
        $rc = $LASTEXITCODE
        $err = (Get-Content -LiteralPath $tmp -Raw)
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
    if ($err) { Write-Output $err.Trim() }
    exit $rc
}

switch ($Action) {
    'on' {
        # '--sticky' arrives as the second positional (bound to $Hours) when typed the shell way.
        if ($Sticky -or $Hours -eq '--sticky') {
            Invoke-Tier @('tier', 'set', 'fast', '--sticky', '--reason', 'fast-mode.ps1')
        }
        if ($Hours -notmatch '^\d+$' -or [int64]$Hours -lt 1) {
            Write-Error 'hours must be a positive integer (e.g. fast-mode.ps1 on 3)' -ErrorAction Continue
            exit 2
        }
        Invoke-Tier @('tier', 'set', 'fast', '--hours', $Hours, '--reason', 'fast-mode.ps1')
    }
    'off' {
        Invoke-Tier @('tier', 'set', 'standard', '--reason', 'fast-mode.ps1 off')
    }
    'status' {
        Invoke-Tier @('tier', 'status')
    }
    default {
        Write-Error 'usage: pwsh .claude/scripts/fast-mode.ps1 on [hours|--sticky]|off|status' -ErrorAction Continue
        exit 2
    }
}
