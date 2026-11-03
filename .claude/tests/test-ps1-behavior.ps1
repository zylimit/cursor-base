#!/usr/bin/env pwsh
# test-ps1-behavior.ps1 -- behaviour regression for what is left of PowerShell in this repository.
#
# Scope after the single-runtime migration (docs/v3-work-packs.md D.1)
#   The hooks are no longer .sh/.ps1 pairs; settings.json runs `node <hook>.mjs` on both
#   platforms and every hook .ps1 is gone. Groups A-E of this file drove stop-gate.ps1,
#   pre-commit-check.ps1, tdd-gate.ps1 and mark-review-needed.ps1 -- those files do not exist
#   any more and their assertions now live in .claude/tests/test-hooks-node.sh, which the
#   Windows runner executes through Git Bash. What is left here is the part node testing
#   cannot cover:
#     group 0  the pinned ASCII-only rule, for the named list of .ps1 files that survive,
#              plus a check that the list is still the whole truth
#     group F  fast-mode.ps1 driven by a real PowerShell host. The script is a thin shell now:
#              on/off/status forward to harness.mjs tier set|status, the state lives in
#              .claude/.runtime/tier.json, and the old .claude/.fast-mode is neither written nor
#              read. What a PowerShell host can still get wrong is the forwarding itself --
#              argument passing, exit codes, and the engine line it has to relay.
#
# What it proves and what it does not
#   CI runs this under pwsh 7 (the Windows runner ships it). Real users run these scripts under
#   powershell.exe 5.1, which differs in ways a 7 host cannot cover -- Console encoding defaults
#   and native stderr handling above all. Green on pwsh 7 means "the logic is right", not
#   "5.1 is safe". Re-run this file with powershell.exe on a real 5.1 box to close the other half.
#
# ASCII only (pinned iron law)
#   PS 5.1 reads a BOM-less UTF-8 file as GBK, so one non-ASCII byte breaks parsing on exactly
#   the machines this file protects. Group 0 is the only machine check that rule has.
#
# Run it
#   pwsh       -NoProfile -File .claude/tests/test-ps1-behavior.ps1
#   powershell -NoProfile -File .claude\tests\test-ps1-behavior.ps1   (5.1, the real target)
#
# Exit codes: 0 = all assertions passed; 1 = an assertion failed; 3 = a group could not run,
# which is not a pass -- CI treats 3 as a failure of the runner.
#
# Discipline: every mutable fixture lives in a temp sandbox that is removed on exit; this
# repository is only ever read. Every assertion prints EXPECT and GOT so a third party can
# re-judge it without trusting the wording.

$ErrorActionPreference = 'Continue'

# Nested two-argument Join-Path on purpose: the three-argument form needs -AdditionalChildPath,
# which only exists from PowerShell 6 on. On 5.1 -- the host this file most needs to run on --
# it fails to bind and the script dies on line one.
$RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
$Scripts = Join-Path $RepoRoot '.claude/scripts'
$Tests = Join-Path $RepoRoot '.claude/tests'
# The switch forwards, so the fixture needs the engine it forwards to, and the engine needs the
# hook-side resolver it imports (harness/lib/tier.mjs -> hooks/lib/tier.mjs).
$HooksDir = Join-Path $RepoRoot '.claude/hooks'
$HarnessDir = Join-Path $RepoRoot '.claude/harness'

$TmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ccbase-ps1-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Path $TmpRoot -Force | Out-Null

$script:Pass = 0
$script:Fail = 0
$script:Skip = 0

function Chk {
    param([bool]$Ok, [string]$Title, [string]$Expect, [string]$Got)
    if ($Ok) { $script:Pass++; Write-Output "  [PASS] $Title" }
    else { $script:Fail++; Write-Output "  [FAIL] $Title" }
    Write-Output "         EXPECT $Expect"
    Write-Output "         GOT    $Got"
}

function Skipped {
    param([string]$Title)
    $script:Skip++
    Write-Output "  [SKIP] $Title"
}

# The host that is running this file, so the scripts are exercised by the same PowerShell the
# operator is on (5.1 vs 7 is the whole question here, so it must not be hard-coded).
$HostExe = $null
try { $HostExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { $HostExe = $null }
if (-not $HostExe) { $HostExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source }
if (-not $HostExe) { $HostExe = (Get-Command powershell -ErrorAction SilentlyContinue).Source }

# node runs the engine the switch forwards to. Absent means group F cannot run at all, and that
# is reported as a skip (exit 3), not as a pass -- see the exit codes above.
$NodeExe = $null
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCmd) { $NodeExe = $NodeCmd.Source }

# Invoke-Script -- run a .ps1 in its own process with stdin/stdout/stderr on files.
# A child process is mandatory: the scripts read [Console]::In, which is the process stdin and is
# not fed by the PowerShell pipeline, so calling them in-process would read the terminal.
function Invoke-Script {
    param(
        [string]$Script,
        [string]$StdinText = '',
        [string]$ProjectDir = '',
        [string]$WorkingDir = '',
        [string[]]$ScriptArgs = @()
    )
    $tag = [guid]::NewGuid().ToString('N').Substring(0, 10)
    $inFile = Join-Path $TmpRoot "in-$tag.txt"
    $outFile = Join-Path $TmpRoot "out-$tag.txt"
    $errFile = Join-Path $TmpRoot "err-$tag.txt"
    # UTF-8 without BOM: a BOM would land inside the first token and break ConvertFrom-Json on 5.1.
    [System.IO.File]::WriteAllText($inFile, $StdinText, (New-Object System.Text.UTF8Encoding($false)))

    $had = Test-Path Env:CLAUDE_PROJECT_DIR
    $prev = $null
    if ($had) { $prev = $env:CLAUDE_PROJECT_DIR }
    if ($ProjectDir) { $env:CLAUDE_PROJECT_DIR = $ProjectDir }
    else { Remove-Item Env:CLAUDE_PROJECT_DIR -ErrorAction SilentlyContinue }
    # One verbatim command-line string, not an array: PS 5.1 joins an -ArgumentList array with
    # spaces and adds no quoting, so a checkout under "C:\Program Files\..." would silently run
    # the wrong thing. A single pre-quoted string behaves the same on 5.1 and 7.
    $argLine = '-NoProfile -NonInteractive -File "' + $Script + '"'
    foreach ($a in $ScriptArgs) { $argLine += ' "' + $a + '"' }
    try {
        $spArgs = @{
            FilePath               = $HostExe
            ArgumentList           = $argLine
            RedirectStandardInput  = $inFile
            RedirectStandardOutput = $outFile
            RedirectStandardError  = $errFile
            NoNewWindow            = $true
            Wait                   = $true
            PassThru               = $true
        }
        if ($WorkingDir) { $spArgs['WorkingDirectory'] = $WorkingDir }
        $proc = Start-Process @spArgs
        $code = $proc.ExitCode
    } finally {
        if ($had) { $env:CLAUDE_PROJECT_DIR = $prev }
        else { Remove-Item Env:CLAUDE_PROJECT_DIR -ErrorAction SilentlyContinue }
    }
    if ($null -eq $code) { $code = -1 }
    # Get-Content -Raw gives $null for an empty file; normalise to '' so every caller can use
    # -like and .Trim() without a null guard.
    $out = (Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue)
    $err = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
    if ($null -eq $out) { $out = '' }
    if ($null -eq $err) { $err = '' }
    return [pscustomobject]@{ Code = $code; Out = $out; Err = $err }
}

# Invoke-Node -- run the engine in the sandbox, the way a gate reads the tier.
# The script under test is a forwarder: asking it what it did is asking one program to grade its
# own homework, so the state has to be read back over a path that does not go through it.
function Invoke-Node {
    param([string]$ProjectDir, [string[]]$EngineArgs)
    $tag = [guid]::NewGuid().ToString('N').Substring(0, 10)
    $outFile = Join-Path $TmpRoot "nout-$tag.txt"
    $errFile = Join-Path $TmpRoot "nerr-$tag.txt"
    # One pre-quoted command line rather than an array, for the same 5.1 reason as Invoke-Script.
    $argLine = '"' + (Join-Path $ProjectDir '.claude/harness/harness.mjs') + '"'
    foreach ($a in $EngineArgs) { $argLine += ' "' + $a + '"' }
    $had = Test-Path Env:CLAUDE_PROJECT_DIR
    $prev = $null
    if ($had) { $prev = $env:CLAUDE_PROJECT_DIR }
    $env:CLAUDE_PROJECT_DIR = $ProjectDir
    try {
        $proc = Start-Process -FilePath $NodeExe -ArgumentList $argLine -WorkingDirectory $ProjectDir -RedirectStandardOutput $outFile -RedirectStandardError $errFile -NoNewWindow -Wait -PassThru
        $code = $proc.ExitCode
    } finally {
        if ($had) { $env:CLAUDE_PROJECT_DIR = $prev }
        else { Remove-Item Env:CLAUDE_PROJECT_DIR -ErrorAction SilentlyContinue }
    }
    if ($null -eq $code) { $code = -1 }
    $out = (Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue)
    $err = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
    if ($null -eq $out) { $out = '' }
    if ($null -eq $err) { $err = '' }
    return [pscustomobject]@{ Code = $code; Out = $out; Err = $err }
}

function Show { param([string]$Text, [int]$Max = 220)
    if (-not $Text) { return '<empty>' }
    $one = ($Text -replace '\r?\n', ' ').Trim()
    if ($one.Length -gt $Max) { return $one.Substring(0, $Max) + '...' }
    return $one
}

Write-Output '===== test-ps1-behavior ====='
Write-Output "host: $HostExe  (PSVersion $($PSVersionTable.PSVersion))"
Write-Output "sandbox root: $TmpRoot"

try {

    # -----------------------------------------------------------------------
    Write-Output ''
    Write-Output '--- 0 the ASCII-only rule, over the named list of .ps1 files that survive ---'

    Chk ([bool]$HostExe) 'a PowerShell host path was resolved (the scripts run under it)' `
        'non-empty host path' "host=$HostExe"

    # The list is named, not globbed: after the migration the repository is supposed to hold
    # exactly these six .ps1 files, so a glob that quietly finds zero (or finds a hook .ps1 that
    # should have been deleted) has to be a failure, not a smaller/larger silent pass.
    $expected = @(
        (Join-Path $RepoRoot 'setup.ps1'),
        (Join-Path $Scripts 'fix-platform.ps1'),
        (Join-Path $Scripts 'fast-mode.ps1'),
        (Join-Path $Scripts 'install-githooks.ps1'),
        (Join-Path $Tests 'test-ps1-behavior.ps1'),
        (Join-Path $Tests 'test-installer-parity.ps1')
    )

    $missing = @($expected | Where-Object { -not (Test-Path -LiteralPath $_) })
    Chk ($missing.Count -eq 0) `
        '0a every .ps1 the migration is supposed to keep is on disk' `
        'all six named files exist' `
        $(if ($missing.Count -eq 0) { 'all present' } else { ($missing -join '; ') })

    # Set equality against a real recursive scan. This is the anti-drift half: a hook .ps1 that
    # D-3b forgot to delete, or a new .ps1 nobody added to the list, both show up here -- and an
    # unlisted .ps1 is one nobody is holding to the ASCII rule.
    # -Force is load-bearing: .claude is a dot-directory, which Get-ChildItem treats as hidden on
    # Unix and skips without it -- the scan would then see setup.ps1 alone and "no strays" would
    # be vacuously true. The count guard below makes that failure mode loud instead of green.
    $found = @(Get-ChildItem -LiteralPath $RepoRoot -Recurse -Filter '*.ps1' -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git|worktrees)[\\/]' } |
        ForEach-Object { $_.FullName })
    $expectedNorm = @($expected | ForEach-Object { (Resolve-Path -LiteralPath $_ -ErrorAction SilentlyContinue).Path } | Where-Object { $_ })
    Chk ($found.Count -ge $expectedNorm.Count) `
        '0b the recursive scan really walks the tree (fewer hits than the list means it is blind, and the drift check below would be vacuous)' `
        "at least $($expectedNorm.Count) .ps1 found by the scan" `
        ("scanned=" + $found.Count + " listed=" + $expectedNorm.Count)
    $extra = @($found | Where-Object { $expectedNorm -notcontains $_ })
    Chk ($extra.Count -eq 0) `
        '0c the repository holds no .ps1 outside that list (a stray one is one nobody checks)' `
        'zero unlisted .ps1 files' `
        ("unlisted=" + $extra.Count + " [" + (($extra | ForEach-Object { $_.Replace($RepoRoot, '') }) -join ', ') + "]")

    $scan = @($expected | Where-Object { Test-Path -LiteralPath $_ })
    Chk ($scan.Count -gt 0) '0d there are files to scan (zero would mean this group checks nothing)' `
        'at least one .ps1' "count=$($scan.Count)"

    $nonAscii = @()
    foreach ($f in $scan) {
        $bytes = [System.IO.File]::ReadAllBytes($f)
        $bad = 0
        foreach ($b in $bytes) { if ($b -gt 127) { $bad++ } }
        if ($bad -gt 0) { $nonAscii += ($f + " ($bad byte(s))") }
    }
    Chk ($nonAscii.Count -eq 0) `
        '0e every surviving .ps1 is pure ASCII (PS 5.1 reads a BOM-less UTF-8 file as GBK and fails to parse)' `
        'zero files with a byte > 127' `
        $(if ($nonAscii.Count -eq 0) { "clean, $($scan.Count) file(s) scanned" } else { ($nonAscii -join '; ') })

    # -----------------------------------------------------------------------
    Write-Output ''
    Write-Output '--- F fast-mode.ps1: the switch on a real PowerShell host, end to end ---'

    # fast-mode.ps1 resolves the project from $PSScriptRoot/../.., so it is copied into the
    # sandbox; running the repository copy would flip the real repository into fast mode.
    # The shell writes nothing itself any more, it forwards, so the sandbox needs the engine as
    # well. hooks/lib and harness/lib go in whole rather than module by module: harness/lib/tier
    # imports hooks/lib/tier, and a fixture that lists the files it thinks are needed turns into
    # ERR_MODULE_NOT_FOUND -- an rc that has nothing to do with the tier -- the day one is added.
    $fmSrc = Join-Path $Scripts 'fast-mode.ps1'
    $engineSrc = Join-Path $HarnessDir 'harness.mjs'
    $profileSrc = Join-Path $HarnessDir 'profile.json'
    $hooksLib = Join-Path $HooksDir 'lib'
    $harnessLib = Join-Path $HarnessDir 'lib'
    $absent = @(@($fmSrc, $engineSrc, $profileSrc, $hooksLib, $harnessLib) |
        Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($absent.Count -gt 0) {
        Skipped ('F the fixture cannot be assembled, missing: ' +
            (($absent | ForEach-Object { $_.Replace($RepoRoot, '') }) -join '; ') +
            ' (not executed is not a pass)')
    } elseif (-not $NodeExe) {
        Skipped 'F no node on PATH and the switch forwards to a .mjs engine, so the group cannot run (not executed is not a pass)'
    } else {
        $sbF = Join-Path $TmpRoot 'f-fastmode'
        New-Item -ItemType Directory -Path (Join-Path $sbF '.claude/scripts') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $sbF '.claude/hooks') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $sbF '.claude/harness') -Force | Out-Null
        Copy-Item -LiteralPath $fmSrc -Destination (Join-Path $sbF '.claude/scripts/fast-mode.ps1')
        Copy-Item -LiteralPath $hooksLib -Destination (Join-Path $sbF '.claude/hooks') -Recurse
        Copy-Item -LiteralPath $engineSrc -Destination (Join-Path $sbF '.claude/harness/harness.mjs')
        Copy-Item -LiteralPath $harnessLib -Destination (Join-Path $sbF '.claude/harness') -Recurse
        Copy-Item -LiteralPath $profileSrc -Destination (Join-Path $sbF '.claude/harness/profile.json')
        $fmScript = Join-Path $sbF '.claude/scripts/fast-mode.ps1'
        $tierFile = Join-Path $sbF '.claude/.runtime/tier.json'
        $legacy = Join-Path $sbF '.claude/.fast-mode'

        $rOn = Invoke-Script -Script $fmScript -ScriptArgs @('on', '3') -WorkingDir $sbF
        $rStatus = Invoke-Script -Script $fmScript -ScriptArgs @('status') -WorkingDir $sbF
        # The engine puts its human line on stderr ("tier: fast, source=session, 3h left") and it
        # reaches stdout only because the shell relays it; a shell that swallowed it would leave
        # the operator nothing to read when the gates go quiet. The hour count is the arithmetic
        # part -- it is derived from expires_epoch on the reading side, so a host that mangled the
        # epoch would show up here as a number outside the window rather than as a missing file.
        $left = -1.0
        if ($rStatus.Out -match '([0-9]+(?:\.[0-9]+)?)h left') { $left = [double]$Matches[1] }
        Chk (($rOn.Code -eq 0) -and ($rStatus.Out -match 'fast') -and ($left -ge 2.0) -and ($left -le 3.0)) `
            'F1 on 3 then status names the fast tier with 2..3 hours left (the switch forwards, and the epoch arithmetic survives a real host)' `
            'rc 0, status mentions fast, remaining hours within 2..3' `
            "on rc=$($rOn.Code) statusRc=$($rStatus.Code) hoursLeft=$left status=$(Show $rStatus.Out)"

        # tier.json is the one switch file every gate reads, so assert the file and not only the
        # message. Bytes rather than text: a CR or a BOM in here is the shape #38 came in -- open
        # to one reader, unparsable to the next -- and .fast-mode must stay gone, because two
        # switch files coexisting is how one gate answered open while another answered closed.
        $tierBytes = @()
        if (Test-Path -LiteralPath $tierFile) { $tierBytes = [System.IO.File]::ReadAllBytes($tierFile) }
        $hasCR = ($tierBytes -contains 13)
        $hasBom = (($tierBytes.Count -ge 3) -and ($tierBytes[0] -eq 239) -and ($tierBytes[1] -eq 187) -and ($tierBytes[2] -eq 191))
        $rec = $null
        if ($tierBytes.Count -gt 0) {
            try { $rec = [System.Text.Encoding]::UTF8.GetString($tierBytes) | ConvertFrom-Json } catch { $rec = $null }
        }
        $recTier = '<unparsed>'
        $recExp = '<none>'
        if ($rec) {
            $recTier = [string]$rec.tier
            if ($null -ne $rec.expires_epoch) { $recExp = [string]$rec.expires_epoch }
        }
        Chk (($tierBytes.Count -gt 0) -and ($recTier -eq 'fast') -and ($recExp -match '^\d+$') `
                -and (-not $hasCR) -and (-not $hasBom) -and (-not (Test-Path -LiteralPath $legacy))) `
            'F2 on writes .claude/.runtime/tier.json (fast, with an expiry, LF and no BOM) and never the old .claude/.fast-mode' `
            'tier.json parses as fast with a numeric expires_epoch, no CR, no BOM, and no .fast-mode beside it' `
            ("bytes=" + $tierBytes.Count + " tier=" + $recTier + " expires_epoch=" + $recExp +
                " hasCR=" + $hasCR + " hasBOM=" + $hasBom + " legacy=" + (Test-Path -LiteralPath $legacy))

        $rOff = Invoke-Script -Script $fmScript -ScriptArgs @('off') -WorkingDir $sbF
        $rStatus2 = Invoke-Script -Script $fmScript -ScriptArgs @('status') -WorkingDir $sbF
        # Read the tier back from the engine, not from the switch. The switch only ever repeats
        # what the engine told it, so its own output cannot tell "the tier came back" apart from
        # "the script still prints the sentence it always printed".
        $rEngine = Invoke-Node -ProjectDir $sbF -EngineArgs @('tier', 'status')
        $effTier = '<unparsed>'
        $effSource = '<unparsed>'
        try {
            $st = $rEngine.Out | ConvertFrom-Json
            $effTier = [string]$st.tier
            $effSource = [string]$st.source
        } catch { $effTier = '<unparsed>' }
        Chk (($rOff.Code -eq 0) -and ($effTier -eq 'standard') -and (-not ($rStatus2.Out -match 'fast')) `
                -and (-not (Test-Path -LiteralPath $legacy))) `
            'F3 off puts the tier back to standard as the engine reads it, and status stops saying fast (the gates really come back)' `
            'engine reports tier standard and the switch no longer mentions fast' `
            "off rc=$($rOff.Code) engineRc=$($rEngine.Code) engineTier=$effTier engineSource=$effSource status=$(Show $rStatus2.Out)"

        # The record left by off is the control: a rejected switch must neither half-open the gate
        # nor quietly rewrite the tier that is already recorded. Starting from "nothing on disk"
        # would make the second half true no matter what the script does.
        $before = ''
        if (Test-Path -LiteralPath $tierFile) { $before = [System.IO.File]::ReadAllText($tierFile) }
        $rBad = Invoke-Script -Script $fmScript -ScriptArgs @('on', 'abc') -WorkingDir $sbF
        $after = ''
        if (Test-Path -LiteralPath $tierFile) { $after = [System.IO.File]::ReadAllText($tierFile) }
        Chk (($rBad.Code -eq 2) -and ($before -ne '') -and ($after -eq $before) -and (-not (Test-Path -LiteralPath $legacy))) `
            'F4 a bad hours argument exits 2, leaves the recorded tier byte-identical and writes no flag file' `
            'rc 2, tier.json unchanged and non-empty, no .fast-mode on disk' `
            "rc=$($rBad.Code) recordedBefore=$(Show $before) unchanged=$($after -eq $before) legacy=$(Test-Path -LiteralPath $legacy) err=$(Show $rBad.Err)"
    }

} catch {
    # A crash halfway through must not read as "nothing failed": without this the remaining
    # assertions would simply never run and the summary would never print.
    $script:Fail++
    Write-Output "  [FAIL] the suite crashed before finishing: $($_.Exception.Message)"
    Write-Output '         EXPECT every group to run to the end'
    Write-Output "         GOT    $($_.ScriptStackTrace -replace '\r?\n', ' | ')"
} finally {
    Remove-Item -LiteralPath $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output ''
Write-Output "==== test-ps1-behavior: PASS=$script:Pass FAIL=$script:Fail SKIP=$script:Skip ===="
if ($script:Fail -gt 0) {
    Write-Output 'test-ps1-behavior: FAILED -- a surviving .ps1 did not behave as its contract says.'
    exit 1
}
if ($script:Skip -gt 0) {
    Write-Output 'test-ps1-behavior: INCOMPLETE -- a group could not run (see [SKIP] above). Not executed is not a pass.'
    exit 3
}
Write-Output 'test-ps1-behavior: passed'
exit 0
