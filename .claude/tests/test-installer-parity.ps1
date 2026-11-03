#!/usr/bin/env pwsh
# test-installer-parity.ps1 -- run both installers over one source tree and diff what actually landed.
#
# Why this file exists
#   "Which files are framework files" lives in four hand-synced tables: .claude/scripts/gen-manifest.sh
#   (the generator), setup.sh copy_claude_tree and setup.ps1 $skip + regexes (the two installers), and
#   .claude/harness/ext/release.mjs MANIFEST_RULES (the auditor). tests/test-setup.sh section (6)
#   compares their arms as text, which catches a missing arm but not an arm that reads differently:
#   setup.ps1 matched $skip by leaf name while the other three anchor those arms at the top of .claude/.
#   A nested skills/foo/settings.json was therefore copied by setup.sh and recorded by gen-manifest.sh,
#   and silently skipped by setup.ps1 -- a Windows install whose manifest claims a file that is not on
#   disk, with nothing on the box to say so. The copy loop in setup.ps1 had no behaviour test at all:
#   test-ps1-behavior.ps1 covers the hooks, and the ps1 job in gate.yml stopped at Parser::ParseFile.
#
# What it proves and what it does not
#   It stages the source tree, runs both installers into two fresh targets, and diffs the two file
#   lists by name. Green means the two exclusion tables agree on this tree. It says nothing about file
#   contents, permission bits, or the settings.json merge -- tests/test-setup.sh owns those.
#   A second group at the end covers batch 5 (the installer as a transaction): -DryRun writes
#   nothing and prints a plan, CC_SETUP_FAIL_AFTER leaves an interrupted marker, a clean rerun
#   clears it, and a reserved path segment is refused. Those four are red until setup.ps1 grows
#   them; tests/test-setup.sh sections (7)-(10) hold the full matrix for the .sh side.
#   pwsh is cross-platform, so the diff is real on Linux too; what a Linux run cannot show is anything
#   that depends on the Windows filesystem itself (hidden attributes, case-insensitive names, 8.3).
#
# The planted fixtures
#   Diffing the repository as it stands only proves today's tree, and today's tree has no nested file
#   whose name collides with a root-anchored arm. The probe directory plants both directions:
#     skills/_probe/settings.json, .../FRAMEWORK-MANIFEST.txt, .../.fast-mode
#       root-anchored names sitting one level down -- framework files, both installers must copy them.
#       This is the red lock for the leaf-vs-root defect.
#     skills/_probe/.DS_Store, .../signals.jsonl, .../Thumbs.db
#       the three names the other three tables also carry a "*/<name>" arm for -- junk at every depth,
#       neither installer may copy them. This is the lock against over-correcting those three into
#       root-only arms while fixing the rest.
#     .claude/settings.local.json, .claude/.static-gate at the top of the staged tree
#       the root-anchored arms must still bite where they are supposed to.
#
# ASCII only (pinned iron law)
#   PS 5.1 reads a BOM-less UTF-8 file as GBK, so one non-ASCII byte breaks parsing on exactly the
#   machines this file protects. tests/test-ps1-behavior.ps1 group 0 asserts the rule for every .ps1.
#
# Run it
#   pwsh -NoProfile -File .claude/tests/test-installer-parity.ps1
#   Needs bash for the setup.sh side (Git Bash on Windows, the system bash elsewhere).
#
# Exit codes: 0 = all assertions passed; 1 = an assertion failed; 3 = the comparison could not run
# (no bash, or no PowerShell host to drive setup.ps1), which is not a pass -- CI treats 3 as failure.
#
# Discipline: the source tree is staged into a temp sandbox and the fixtures are planted there; this
# repository is only ever read. Every assertion prints EXPECT and GOT, and every difference is named
# file by file -- a count alone tells nobody what to fix.

$ErrorActionPreference = 'Continue'

# Nested two-argument Join-Path on purpose: the three-argument form needs -AdditionalChildPath,
# which only exists from PowerShell 6 on and fails to bind on 5.1.
$RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
$SrcClaude = Join-Path $RepoRoot '.claude'
$SrcSetupSh = Join-Path $RepoRoot 'setup.sh'
$SrcSetupPs1 = Join-Path $RepoRoot 'setup.ps1'

$TmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ccbase-parity-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
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
    param([string]$Title, [string]$Why)
    $script:Skip++
    Write-Output "  [SKIP] $Title"
    Write-Output "         WHY    $Why"
}

# The PowerShell that is running this file drives setup.ps1, so the installer is exercised by the
# same host the operator is on (5.1 vs 7 differs in ways that matter to the copy loop's encoding).
$HostExe = $null
try { $HostExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { $HostExe = $null }
if (-not $HostExe) { $HostExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source }
if (-not $HostExe) { $HostExe = (Get-Command powershell -ErrorAction SilentlyContinue).Source }

# Git Bash first by absolute path: on a Windows box with WSL enabled, `bash` on PATH can be
# System32\bash.exe, which does not see the Windows temp tree the same way and would fail in a
# confusing place. Everywhere else Get-Command finds the system bash.
$BashExe = $null
foreach ($cand in @('C:\Program Files\Git\bin\bash.exe', 'C:\Program Files\Git\usr\bin\bash.exe')) {
    if (Test-Path $cand) { $BashExe = $cand; break }
}
if (-not $BashExe) {
    $found = (Get-Command bash -ErrorAction SilentlyContinue)
    if ($found) { $BashExe = $found.Source }
}

# Copy the source tree file by file with -Force, so dot-prefixed names come along on Unix (where
# PowerShell calls them hidden). A provider-level recursive copy is faster but its hidden-file
# behaviour differs by platform, and this file exists precisely to not paper over that kind of gap.
function Copy-Tree {
    param([string]$From, [string]$To)
    $fromFull = (Resolve-Path $From).Path
    $prefix = $fromFull.Length
    foreach ($f in (Get-ChildItem -Path $fromFull -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($prefix).TrimStart('/', '\')
        $dest = Join-Path $To $rel
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Copy-Item $f.FullName $dest -Force
    }
}

# Every regular file under a target's .claude, relative and POSIX-separated, sorted. -Force again:
# without it the listing itself would hide the dot-prefixed files on Unix and the diff would lie.
function Get-InstalledList {
    param([string]$TargetClaude)
    if (-not (Test-Path $TargetClaude)) { return @() }
    $prefix = (Resolve-Path $TargetClaude).Path.Length
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($f in (Get-ChildItem -Path $TargetClaude -Recurse -File -Force)) {
        $out.Add(($f.FullName.Substring($prefix).TrimStart('/', '\') -replace '\\', '/'))
    }
    return @($out | Sort-Object)
}

function Write-Probe {
    param([string]$Path, [string]$Text)
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text)
}

# Git Bash takes forward slashes for both the script and its arguments; a Windows path with
# backslashes would be eaten as escapes before setup.sh ever sees it.
function ToPosix {
    param([string]$P)
    return ($P -replace '\\', '/')
}

# Content fingerprint of a whole target: relative path plus SHA256, one line per file, sorted.
# Get-InstalledList above compares names only, which is all the parity diff needs; the -DryRun
# assertions need to see a file whose bytes changed, not only one that appeared or vanished.
function Get-TreeFingerprint {
    param([string]$Root)
    if (-not (Test-Path $Root)) { return '' }
    $prefix = (Resolve-Path $Root).Path.Length
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($f in (Get-ChildItem -Path $Root -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($prefix).TrimStart('/', '\') -replace '\\', '/'
        $lines.Add($rel + '  ' + (Get-FileHash $f.FullName -Algorithm SHA256).Hash)
    }
    return (($lines | Sort-Object) -join "`n")
}

Write-Output '=== test-installer-parity: setup.ps1 vs setup.sh, same tree, diff what landed ==='
Write-Output "repo:  $RepoRoot"
Write-Output "host:  $HostExe"
Write-Output "bash:  $BashExe"
Write-Output "sandbox: $TmpRoot"

$rc = 0
try {
    if (-not $BashExe -or -not $HostExe) {
        Skipped 'installer parity' 'no bash and/or no PowerShell host -- the comparison needs both installers to run'
        $rc = 3
    } else {
        $stage = Join-Path $TmpRoot 'stage'
        $stageClaude = Join-Path $stage '.claude'
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        Copy-Tree $SrcClaude $stageClaude
        Copy-Item $SrcSetupSh (Join-Path $stage 'setup.sh') -Force
        Copy-Item $SrcSetupPs1 (Join-Path $stage 'setup.ps1') -Force

        # Fixtures. MustInstall = a root-anchored name planted one level down, so it is a framework
        # file; MustSkip = a name the other three tables also match at any depth.
        $probeDir = Join-Path $stageClaude 'skills/_probe'
        $mustInstall = @('skills/_probe/settings.json', 'skills/_probe/FRAMEWORK-MANIFEST.txt', 'skills/_probe/.fast-mode')
        $mustSkip = @('skills/_probe/.DS_Store', 'skills/_probe/signals.jsonl', 'skills/_probe/Thumbs.db',
            'settings.local.json', '.static-gate')
        foreach ($rel in ($mustInstall + $mustSkip)) {
            Write-Probe (Join-Path $stageClaude $rel) "probe $rel`n"
        }

        $staged = Get-InstalledList $stageClaude
        $missingFixtures = @(($mustInstall + $mustSkip) | Where-Object { $staged -notcontains $_ })
        Chk ($missingFixtures.Count -eq 0 -and ($staged -contains '.gitignore')) `
            'staged source tree carries the probes and the dot-files' `
            'all 8 probe files plus .claude/.gitignore present in the staged tree' `
            ("staged=" + $staged.Count + " missing=[" + ($missingFixtures -join ', ') + "] gitignore=" + ($staged -contains '.gitignore'))

        $targetSh = Join-Path $TmpRoot 'target-sh'
        $targetPs = Join-Path $TmpRoot 'target-ps'
        New-Item -ItemType Directory -Path $targetSh -Force | Out-Null
        New-Item -ItemType Directory -Path $targetPs -Force | Out-Null

        # -ubt is load-bearing: without it setup.sh detects MINGW on Windows and execs setup.ps1,
        # and the whole comparison would be setup.ps1 against itself -- green and worthless.
        $shOut = (& $BashExe (ToPosix (Join-Path $stage 'setup.sh')) '-ubt' (ToPosix $targetSh) 2>&1 | Out-String)
        $shRc = $LASTEXITCODE
        $psOut = (& $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $targetPs 2>&1 | Out-String)
        $psRc = $LASTEXITCODE

        Chk (($shRc -eq 0) -and ($shOut -match 'installed: hooks=')) `
            'setup.sh installed through its own .sh path' `
            'rc 0 and the .sh summary line "installed: hooks=" (not "mjs_hooks=", which would mean it re-execed setup.ps1)' `
            ("rc=$shRc summary=[" + (($shOut -split "`n" | Where-Object { $_ -match 'installed: ' }) -join ' ') + "]")
        Chk (($psRc -eq 0) -and ($psOut -match 'installed: mjs_hooks=')) `
            'setup.ps1 installed' `
            'rc 0 and the .ps1 summary line "installed: mjs_hooks="' `
            ("rc=$psRc summary=[" + (($psOut -split "`n" | Where-Object { $_ -match 'installed: ' }) -join ' ') + "]")

        $shList = Get-InstalledList (Join-Path $targetSh '.claude')
        $psList = Get-InstalledList (Join-Path $targetPs '.claude')

        # Non-vacuity: an empty or near-empty pair of lists would compare equal and prove nothing.
        Chk (($shList.Count -ge 100) -and ($psList.Count -ge 100)) `
            'both installs produced a real tree' `
            'at least 100 files on each side' `
            ("setup.sh=" + $shList.Count + " setup.ps1=" + $psList.Count)

        $onlySh = @($shList | Where-Object { $psList -notcontains $_ })
        $onlyPs = @($psList | Where-Object { $shList -notcontains $_ })
        foreach ($f in $onlySh) { Write-Output "         MISSING on the setup.ps1 side: $f" }
        foreach ($f in $onlyPs) { Write-Output "         EXTRA   on the setup.ps1 side: $f" }
        Chk ($onlySh.Count -eq 0) `
            'setup.ps1 installed everything setup.sh installed' `
            'no file installed by setup.sh is absent on the setup.ps1 side' `
            ("missing=" + $onlySh.Count + " [" + ($onlySh -join ', ') + "]")
        Chk ($onlyPs.Count -eq 0) `
            'setup.ps1 installed nothing extra' `
            'no file installed by setup.ps1 was skipped by setup.sh' `
            ("extra=" + $onlyPs.Count + " [" + ($onlyPs -join ', ') + "]")

        # The named fixtures, asserted per file so the report says which one broke, not just "the
        # lists differ". These stay red even if some future difference makes the diff above noisy.
        $shMissesInstall = @($mustInstall | Where-Object { $shList -notcontains $_ })
        $psMissesInstall = @($mustInstall | Where-Object { $psList -notcontains $_ })
        Chk (($shMissesInstall.Count -eq 0) -and ($psMissesInstall.Count -eq 0)) `
            'nested copies of root-anchored names are installed by both' `
            ('both sides carry ' + ($mustInstall -join ', ')) `
            ("setup.sh missing=[" + ($shMissesInstall -join ', ') + "] setup.ps1 missing=[" + ($psMissesInstall -join ', ') + "]")

        $shKeptJunk = @($mustSkip | Where-Object { $shList -contains $_ })
        $psKeptJunk = @($mustSkip | Where-Object { $psList -contains $_ })
        Chk (($shKeptJunk.Count -eq 0) -and ($psKeptJunk.Count -eq 0)) `
            'any-depth junk and root-anchored runtime markers are installed by neither' `
            ('neither side carries ' + ($mustSkip -join ', ')) `
            ("setup.sh kept=[" + ($shKeptJunk -join ', ') + "] setup.ps1 kept=[" + ($psKeptJunk -join ', ') + "]")

        # --- the optional large-repo package: off by default, and the same set when asked for.
        # An opt-in switch is where the two installers diverge most quietly: one grows the arm, the
        # other keeps shipping without it, and every Windows install of that project is missing the
        # engine with nothing to say so. The rules/ copy is part of the set on purpose - the package
        # ships its two documents under harness/ext/rules/, but a path-scoped rule only loads from
        # .claude/rules/, so an installer that copies one without the other installs a dead file.
        $extInDefault = @($shList | Where-Object { $_ -like 'harness/ext/*' }) +
                        @($psList | Where-Object { $_ -like 'harness/ext/*' })
        Chk ($extInDefault.Count -eq 0) `
            'neither installer ships harness/ext/ without the switch' `
            'no harness/ext/* anywhere in the two default installs above' `
            ("default installs carried=[" + ($extInDefault -join ', ') + "]")

        $targetShH = Join-Path $TmpRoot 'target-sh-harness'
        $targetPsH = Join-Path $TmpRoot 'target-ps-harness'
        New-Item -ItemType Directory -Path $targetShH -Force | Out-Null
        New-Item -ItemType Directory -Path $targetPsH -Force | Out-Null
        $shOutH = (& $BashExe (ToPosix (Join-Path $stage 'setup.sh')) '-ubt' '--with-harness' (ToPosix $targetShH) 2>&1 | Out-String)
        $shRcH = $LASTEXITCODE
        $psOutH = (& $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $targetPsH -WithHarness 2>&1 | Out-String)
        $psRcH = $LASTEXITCODE
        $shListH = Get-InstalledList (Join-Path $targetShH '.claude')
        $psListH = Get-InstalledList (Join-Path $targetPsH '.claude')
        $onlyShH = @($shListH | Where-Object { $psListH -notcontains $_ })
        $onlyPsH = @($psListH | Where-Object { $shListH -notcontains $_ })
        Chk (($shRcH -eq 0) -and ($psRcH -eq 0) -and ($onlyShH.Count -eq 0) -and ($onlyPsH.Count -eq 0)) `
            '--with-harness and -WithHarness install the identical set' `
            'both rc 0 and no file on one side that is absent on the other' `
            ("sh rc=$shRcH ps rc=$psRcH onlySh=[" + ($onlyShH -join ', ') + "] onlyPs=[" + ($onlyPsH -join ', ') +
             "] sh out=[" + (($shOutH -split "`n" | Where-Object { $_ -match 'installed: ' }) -join ' ') + "]")

        $extWanted = @('harness/ext/graph.mjs', 'harness/ext/rules/harness-large-repo.md',
            'rules/harness-large-repo.md', 'rules/quality-attributes.md')
        $shMissExt = @($extWanted | Where-Object { $shListH -notcontains $_ })
        $psMissExt = @($extWanted | Where-Object { $psListH -notcontains $_ })
        Chk (($shMissExt.Count -eq 0) -and ($psMissExt.Count -eq 0)) `
            'both sides land the package and put its rules where rules are loaded from' `
            ('both carry ' + ($extWanted -join ', ')) `
            ("setup.sh missing=[" + ($shMissExt -join ', ') + "] setup.ps1 missing=[" + ($psMissExt -join ', ') + "]")

        # --- batch 5: the installer as a transaction, setup.ps1 half ---------------------
        # setup.sh is growing -dry-run, an install lock, an interrupted-install marker and
        # per-segment target validation; the contract says setup.ps1 moves with it, and the
        # last time the two tables drifted apart nothing on the box said so (see the header).
        # None of the four exist on either side yet, so this group is red by construction.
        # tests/test-setup.sh sections (7)-(10) are the .sh half and carry the full matrix --
        # 68 assertions there against 4 here, because everything above the parity line is
        # already covered once and a second full copy would only rot.
        $t7 = Join-Path $TmpRoot 'target-dryrun'
        $t9 = Join-Path $TmpRoot 'target-marker'
        New-Item -ItemType Directory -Path $t7 -Force | Out-Null
        New-Item -ItemType Directory -Path $t9 -Force | Out-Null
        & $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $t7 2>&1 | Out-Null
        $t7BaseRc = $LASTEXITCODE
        & $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $t9 2>&1 | Out-Null
        $t9BaseRc = $LASTEXITCODE
        $t7Claude = Join-Path $t7 '.claude'
        $t7Edited = Join-Path $t7Claude 'CLAUDE.md'
        $t7Deleted = Join-Path $t7Claude 'hooks/notify.mjs'

        Chk (($t7BaseRc -eq 0) -and ($t9BaseRc -eq 0) -and (Test-Path $t7Edited) -and (Test-Path $t7Deleted)) `
            'scaffolding: the two batch-5 targets installed and carry both dry-run probes' `
            'both baseline installs rc 0, and .claude/CLAUDE.md plus .claude/hooks/notify.mjs are on disk to perturb' `
            ("t7Rc=$t7BaseRc t9Rc=$t9BaseRc CLAUDE.md=" + (Test-Path $t7Edited) + " notify.mjs=" + (Test-Path $t7Deleted))

        # Plant the two perturbations a real install has to undo, so "nothing changed" is not the
        # trivially true statement it would be on an already-idempotent target: one framework file
        # edited (a real install drops CLAUDE.md.framework-new beside it) and one deleted (a real
        # install puts it back). Without them a plain second install is byte-stable and the
        # zero-write assertion would pass on an installer that ignored -DryRun completely.
        Add-Content -Path $t7Edited -Value '# user local edit for dry-run probe'
        if (Test-Path $t7Deleted) { Remove-Item $t7Deleted -Force }
        $t7Before = Get-TreeFingerprint $t7

        $dryOut = (& $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $t7 -DryRun 2>&1 | Out-String)
        $dryRc = $LASTEXITCODE
        $t7After = Get-TreeFingerprint $t7
        $t7New = Join-Path $t7Claude 'CLAUDE.md.framework-new'
        $t7Lock = Join-Path $t7Claude '.runtime/install.lock'
        $t7Marker = Join-Path $t7Claude '.runtime/install.marker'

        Chk (($dryRc -eq 0) -and ($dryOut -match 'create') -and ($dryOut -match 'update') `
                -and ($dryOut -match 'conflict') -and ($dryOut -match 'skip')) `
            '(7) setup.ps1 -DryRun is a bound switch and prints the plan' `
            'rc 0 and all four plan categories create/update/conflict/skip in the output' `
            ("rc=$dryRc first line=[" + (($dryOut -split "`n" | Select-Object -First 1)) + "]")

        # Regression guard, green today for the wrong reason: -DryRun does not bind, so the host
        # fails parameter binding and setup.ps1 never runs at all. It only starts carrying weight
        # once the switch exists.
        Chk (($t7Before -eq $t7After) -and (-not (Test-Path $t7New)) `
                -and (-not (Test-Path $t7Lock)) -and (-not (Test-Path $t7Marker))) `
            '(7) setup.ps1 -DryRun writes nothing into the target' `
            'every file SHA256 unchanged, and no .framework-new / install.lock / install.marker appeared' `
            ("fingerprint equal=" + ($t7Before -eq $t7After) + " framework-new=" + (Test-Path $t7New) `
                + " lock=" + (Test-Path $t7Lock) + " marker=" + (Test-Path $t7Marker))

        # The env var is the fault injection point the contract names: fail after the Nth file
        # write, so the interrupted-install marker has something to be interrupted out of.
        $markerPath = Join-Path $t9 '.claude/.runtime/install.marker'
        $env:CC_SETUP_FAIL_AFTER = '3'
        $failOut = (& $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $t9 2>&1 | Out-String)
        $failRc = $LASTEXITCODE
        Remove-Item Env:CC_SETUP_FAIL_AFTER -ErrorAction SilentlyContinue
        $markerText = ''
        if (Test-Path $markerPath) { $markerText = (Get-Content $markerPath -Raw) }

        Chk (($failRc -ne 0) -and (Test-Path $markerPath) -and ($markerText -match 'interrupted')) `
            '(9) CC_SETUP_FAIL_AFTER leaves an interrupted marker behind' `
            'rc non-zero, .claude/.runtime/install.marker on disk, status interrupted' `
            ("rc=$failRc marker=" + (Test-Path $markerPath) + " text=[" + ($markerText -replace "`r", '' -replace "`n", ' ') + "] out=[" `
                + (($failOut -split "`n" | Select-Object -First 1)) + "]")

        $reOut = (& $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target $t9 2>&1 | Out-String)
        $reRc = $LASTEXITCODE
        $t9Runtime = Join-Path $t9 '.claude/.runtime'
        # The whole .runtime directory has to go, not just the two files inside it:
        # tests/test-setup.sh section (5) asserts -e on that directory for an installed target,
        # so leaving an empty one behind turns a green suite red somewhere that reads unrelated.
        Chk (($reRc -eq 0) -and (-not (Test-Path $markerPath)) -and (-not (Test-Path $t9Runtime))) `
            '(9) a clean rerun clears the marker and leaves no .runtime behind' `
            'rc 0, no install.marker, and no .claude/.runtime directory at all' `
            ("rc=$reRc marker=" + (Test-Path $markerPath) + " runtime dir=" + (Test-Path $t9Runtime) + " out=[" `
                + (($reOut -split "`n" | Select-Object -First 1)) + "]")

        # (10) Path bounds, one representative case. On Linux this bites for real: a/con/b is an
        # ordinary directory here and setup.ps1 installs straight into it. On a Windows runner the
        # reserved name makes New-Item throw by itself, so a green there proves nothing about
        # validation -- the Linux run is the one that holds this line.
        $t10 = Join-Path $TmpRoot 'target-reserved'
        $badOut = (& $HostExe -NoProfile -File (Join-Path $stage 'setup.ps1') -Target (Join-Path $t10 'a/con/b') 2>&1 | Out-String)
        $badRc = $LASTEXITCODE
        Chk (($badRc -ne 0) -and (-not (Test-Path $t10))) `
            '(10) setup.ps1 rejects a target whose path has a Windows reserved segment' `
            'rc non-zero and not one directory created -- validation belongs before the first New-Item' `
            ("rc=$badRc created=" + (Test-Path $t10) + " first line=[" + (($badOut -split "`n" | Select-Object -First 1)) + "]")
    }
} finally {
    Remove-Item -Path $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output ''
Write-Output ("test-installer-parity: PASS=$script:Pass FAIL=$script:Fail SKIP=$script:Skip")
if ($script:Fail -gt 0) { exit 1 }
if ($rc -ne 0) { exit $rc }
exit 0
