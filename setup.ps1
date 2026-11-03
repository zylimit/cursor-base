#!/usr/bin/env pwsh
# setup.ps1 - install the cc-base framework assets into a target project (Windows / pure PowerShell).
# Usage: pwsh -File setup.ps1 [-Target <dir>] [-Force] [-DryRun] [-WithTests] [-WithHarness] [-HookForm exec|string]
#      without -Target, defaults to the current directory ".".
#      -DryRun writes nothing and prints the plan (create / update / conflict / skip) instead.
#      -HookForm picks how the framework hooks are registered in settings.json: exec (no shell, byte-identical on every
#      platform) or string ("node .claude/hooks/<name>.mjs" with no args key - for Cursor, which ignores args).
#      Left out, the form the target settings.json already has is kept (exec when there is none or it cannot be read).
#      string runs hook-form.mjs --to string as the last settings step.
# Key: write target/.claude/settings.json directly (Claude Code only reads that fixed name, not settings-windows.json).
#      Hook commands are no longer rewritten: settings.json ships the exec form ("command":"node" plus
#      "args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>.mjs"]), which spawns node.exe directly with no shell in
#      between, so the very same file works verbatim on Windows / Mac / Linux.
#      The one thing still rewritten here is statusLine: it has no exec form, only a shell command string, and on a
#      pure PowerShell box that string is run by PowerShell - where the Git Bash spelling "$CLAUDE_PROJECT_DIR"
#      expands to nothing. Hence the $env: spelling.
#      Also cleaned up: hook files and hook commands an older .sh/.ps1 install of this framework left behind.
[CmdletBinding()]
param(
  [string]$Target = '.',
  [switch]$Force,
  [switch]$DryRun,
  [switch]$WithTests,
  [switch]$WithHarness,
  [ValidateSet('exec', 'string')]
  [string]$HookForm = ''
)
$ErrorActionPreference = 'Stop'

# Install transaction state (mirrors setup.sh): an exclusive lock so two installs cannot write the
# same target at once, a maintenance marker that says "this tree was left half installed", and the
# dry-run plan counters. Both files live under .claude/.runtime/ (already excluded from the copy),
# and a normal finish takes the whole directory with it.
$script:startedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$script:lockPath = ''
$script:markerPath = ''
$script:installDone = $false
$script:writeCount = 0
$script:written = @()
$script:plan = @{ create = 0; update = 0; conflict = 0; skip = 0 }

function Write-InstallMarker([string]$status) {
  if (-not $script:markerPath) { return }
  $items = @()
  foreach ($f in $script:written) { $items += ('"' + ($f -replace '\\', '/' -replace '"', '\"') + '"') }
  $json = '{"status": "' + $status + '", "pid": ' + $PID + ', "startedAt": "' + $script:startedAt +
    '", "written": [' + ($items -join ',') + ']}'
  try { [System.IO.File]::WriteAllText($script:markerPath, $json) } catch { }
}

# Anything that throws lands here: the marker flips to interrupted and stays put (doctor.sh and the
# SessionStart banner both read it), the lock goes because the process holding it is leaving.
trap {
  if (-not $script:installDone) { Write-InstallMarker 'interrupted' }
  if ($script:lockPath) { Remove-Item $script:lockPath -Force -ErrorAction SilentlyContinue }
  Write-Host ('setup: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

# Count each written file (the interrupted marker carries the list) and honour the fault-injection
# hook: CC_SETUP_FAIL_AFTER=N fails right after the Nth write. Unset, none of this does anything.
function Register-Write([string]$rel) {
  $script:writeCount++
  $script:written += ($rel -replace '\\', '/')
  if ($env:CC_SETUP_FAIL_AFTER -match '^\d+$' -and $script:writeCount -ge [int]$env:CC_SETUP_FAIL_AFTER) {
    throw ("CC_SETUP_FAIL_AFTER=$($env:CC_SETUP_FAIL_AFTER) fault injection: aborting after writing " +
      "$($script:writeCount) file(s)")
  }
}

function Add-Plan([string]$kind, [string]$rel) {
  $script:plan[$kind] = $script:plan[$kind] + 1
  if ($DryRun) { Write-Output ('  {0,-8} .claude/{1}' -f $kind, $rel) }
}

# Per-segment target validation, same table as setup.sh validate_target. It runs before the first
# New-Item on purpose - "rejected, but half the directories are already there" is not a rejection.
$WinBadChars = '<>:"|?*'
$WinReserved = @('con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9')
function Test-TargetPath([string]$path) {
  if (-not $path) { throw 'target directory must not be empty' }
  if ($path -eq '.') { return }
  $rest = $path
  # A leading ./ (or .\) is the documented relative form; rejecting every "." segment literally
  # would brick the two most common ways of calling this script.
  if ($rest.StartsWith('./') -or $rest.StartsWith('.\')) { $rest = $rest.Substring(2) }
  $segs = @($rest -split '[\\/]+' | Where-Object { $_ -ne '' })
  if ($segs.Count -gt 64) {
    throw "target path has too many segments: $($segs.Count), the cap is 64 (that much nesting is usually a typo): $path"
  }
  $first = $true
  foreach ($seg in $segs) {
    if ($first) {
      $first = $false
      # A drive letter (the "C:" segment) is only legal at the front; everything after it is a normal segment.
      if ($seg -match '^[A-Za-z]:$') { continue }
    }
    if ($seg -eq '..') { throw "unsafe target path: a '..' segment writes outside the target ($path)" }
    if ($seg -eq '.') { throw "invalid target path: a '.' segment in the middle ($path); only a leading ./ is allowed" }
    if ($seg -match '[\x00-\x1f\x7f]') { throw "target path segment holds a control char: [$seg] ($path)" }
    foreach ($ch in $WinBadChars.ToCharArray()) {
      if ($seg.IndexOf($ch) -ge 0) {
        throw "target path segment holds the illegal char [$ch] (Windows file names cannot carry $WinBadChars): [$seg] ($path)"
      }
    }
    if ($WinReserved -contains $seg.ToLower()) {
      throw "target path segment is a Windows reserved device name [$seg] (con/prn/aux/nul/com1-9/lpt1-9, case-insensitive): $path"
    }
    if ($seg.EndsWith('.')) { throw "target path segment ends with a dot (Windows silently eats it): [$seg] ($path)" }
    if ($seg.EndsWith(' ')) { throw "target path segment ends with a space (same as above): [$seg] ($path)" }
    if ([System.Text.Encoding]::UTF8.GetByteCount($seg) -gt 255) {
      throw "target path segment is too long: over 255 bytes: [$seg] ($path)"
    }
  }
}

$root = $PSScriptRoot
$srcClaude = Join-Path $root '.claude'
if (-not (Test-Path $srcClaude)) { throw "No .claude under the script directory (run from the cc-base repo root): $srcClaude" }

# target/.claude
Test-TargetPath $Target
if (-not $DryRun -and -not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }
$targetClaude = Join-Path $Target '.claude'
$runtimeDir = Join-Path $targetClaude '.runtime'

Write-Host '=== cc-base setup (Windows/.ps1) ===' -ForegroundColor Cyan

# 1. Detect git / claude (advisory, not a hard block)
if (Get-Command git -ErrorAction SilentlyContinue) { Write-Host "[ok] git: $((git --version) 2>$null)" }
else { Write-Host '[!] git not detected (install: https://git-scm.com/download/win)' -ForegroundColor Yellow }
if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host '[ok] Claude Code (claude) installed' }
else { Write-Host '[!] Claude Code not detected (install: https://docs.claude.com/claude-code)' -ForegroundColor Yellow }

function Test-FilesEqual($a, $b) {
  if (-not (Test-Path $b)) { return $false }
  return (Get-FileHash $a -Algorithm SHA256).Hash -eq (Get-FileHash $b -Algorithm SHA256).Hash
}

# LF-normalized SHA256 (strip CR bytes before hashing) - must match gen-manifest.sh's
# "tr -d '\r' | sha256sum" so a CRLF checkout still matches the recorded manifest hash.
function Get-NormalizedSha([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $filtered = [byte[]]($bytes | Where-Object { $_ -ne 13 })
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($filtered)) -replace '-', '').ToLower() }
  finally { $sha.Dispose() }
}

# Framework core layer vs project private layer (FRAMEWORK-MANIFEST.txt):
# the target-side old manifest records the SHA each framework file had at install time.
# Before overwriting: target == old framework version -> safe upgrade; user-modified or
# no old manifest -> do not overwrite, drop <name>.framework-new for manual merge.
# Files on the target side that are not in the manifest = private layer, never touched.
$oldManifest = @{}
$oldManifestPath = Join-Path $targetClaude 'FRAMEWORK-MANIFEST.txt'
if (Test-Path $oldManifestPath) {
  foreach ($line in Get-Content $oldManifestPath) {
    if ($line -match '^#' -or -not $line.Trim()) { continue }
    $parts = $line -split "`t"
    if ($parts.Count -ge 2) { $oldManifest[$parts[0]] = $parts[1] }
  }
}
$script:frameworkNewList = @()

# The optional package's own manifest (FRAMEWORK-MANIFEST-OPTIONAL.txt, present only on a target
# that has used -WithTests / -WithHarness at least once). tests/* and harness/ext/* are excluded
# from FRAMEWORK-MANIFEST.txt on purpose (gen-manifest.sh's exclusion table - that is the main
# loop's own source of truth and this does not touch it). Without a manifest of their own, old_sha
# for these paths was always empty and Invoke-PlanAndApply's 'update' branch was dead code for
# them: a file the source repo upgraded, that the user never touched, still landed as 'conflict'
# with a .framework-new next to it, and dry-run could not tell that case apart from a real user
# edit (progress.md TODO #81, closing reviewer HIGH-1). The fix: the optional package keeps its
# own account on the target side. $oldOptionalManifest is read here, before anything is written;
# $newOptionalEntries collects one entry per file actually processed by -WithTests / -WithHarness
# below (the source's current hash), and Write-OptionalManifest merges that onto whatever old
# entries this run did not touch (so running -WithHarness alone does not erase a prior
# -WithTests-only install's records) and writes the merged result back. Not run at all (or
# -DryRun) means the entries list stays empty and Write-OptionalManifest does nothing.
$script:oldOptionalManifest = @{}
$oldOptionalManifestPath = Join-Path $targetClaude 'FRAMEWORK-MANIFEST-OPTIONAL.txt'
if (Test-Path $oldOptionalManifestPath) {
  foreach ($line in Get-Content $oldOptionalManifestPath) {
    if ($line -match '^#' -or -not $line.Trim()) { continue }
    $parts = $line -split "`t"
    if ($parts.Count -ge 2) { $script:oldOptionalManifest[$parts[0]] = $parts[1] }
  }
}
$script:newOptionalEntries = [ordered]@{}

function Write-OptionalManifest {
  if ($DryRun) { return }
  if ($script:newOptionalEntries.Count -eq 0) { return }
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('# cc-base FRAMEWORK-MANIFEST-OPTIONAL (optional-package manifest: tests/* and harness/ext/*')
  $lines.Add('# installed by -WithTests / -WithHarness, tracked here on the target side by setup.sh /')
  $lines.Add('# setup.ps1; FRAMEWORK-MANIFEST.txt on purpose does not carry these paths, see')
  $lines.Add('# gen-manifest.sh''s exclusion table)')
  $lines.Add('# algorithm: sha256 of LF-normalized bytes (same as the main manifest)')
  $lines.Add('# format: <path relative to .claude/>' + "`t" + 'sha256')
  $lines.Add('# only the switch(es) actually run this time are recorded: no -WithTests run means no')
  $lines.Add('# tests/* entries, no -WithHarness run means no harness/ext/* or rules/* entries; running')
  $lines.Add('# one switch does not clear the other switch''s earlier records.')
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($key in $script:newOptionalEntries.Keys) {
    $lines.Add($key + "`t" + $script:newOptionalEntries[$key])
    [void]$seen.Add($key)
  }
  foreach ($key in $script:oldOptionalManifest.Keys) {
    if ($seen.Contains($key)) { continue }
    $lines.Add($key + "`t" + $script:oldOptionalManifest[$key])
  }
  $out = Join-Path $targetClaude 'FRAMEWORK-MANIFEST-OPTIONAL.txt'
  Set-Content -Path $out -Value ($lines -join "`n") -Encoding UTF8 -NoNewline
  Add-Content -Path $out -Value '' -Encoding UTF8
  Register-Write 'FRAMEWORK-MANIFEST-OPTIONAL.txt'
}

# Take the lock and drop the marker before the first byte is written. A lock whose pid is still
# alive means someone else is writing this target: refuse. A dead pid is the leftover of a crash
# (stale lock): say so on the way past and take it over, so a crash cannot lock the target forever.
# Creating the lock has to be atomic (mirrors setup.sh, which uses `set -o noclobber`): the old
# "Test-Path then WriteAllText" was two steps, so two setups racing could both pass the existence
# test, both write a lock and both believe they hold it. CreateNew is the O_EXCL of .NET - it
# throws when the file is already there, which folds check and write into one call. The lock stays
# one regular file at the same path, so the stale-pid reader and the cleanup that removes it are
# unchanged.
if ($DryRun) {
  Write-Host "dry-run: planning only, not a byte is written to $Target"
} else {
  if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null }
  $lockFile = Join-Path $runtimeDir 'install.lock'
  $lockTry = 0
  while ($true) {
    $lockTry++
    $lockStream = $null
    try { $lockStream = [System.IO.File]::Open($lockFile, 'CreateNew', 'Write') } catch { $lockStream = $null }
    if ($lockStream) {
      try {
        $lockBytes = [System.Text.Encoding]::UTF8.GetBytes('{"pid": ' + $PID + ', "startedAt": "' + $script:startedAt + '"}')
        $lockStream.Write($lockBytes, 0, $lockBytes.Length)
      } finally { $lockStream.Dispose() }
      break
    }
    # Losing the race has two causes: the lock is already there (normal contention), or the file
    # cannot be created at all (permissions / disk). The latter leaves no lock behind - do not
    # report it as "somebody else holds it".
    if (-not (Test-Path $lockFile)) { throw "cannot create the install lock $lockFile" }
    $holder = 0
    try {
      $lockText = Get-Content $lockFile -Raw
      if ($lockText -match '"pid"\s*:\s*(\d+)') { $holder = [int]$Matches[1] }
    } catch { $holder = 0 }
    if ($holder -gt 0 -and (Get-Process -Id $holder -ErrorAction SilentlyContinue)) {
      throw "another setup is writing this target: install.lock $lockFile is held by live pid=$holder; wait for it to finish, or delete the lock once you are sure that process is gone"
    }
    Write-Host "setup: stale install.lock $lockFile (holder pid=$holder is gone), taking over; the last install probably died halfway" -ForegroundColor Yellow
    # Taking over a stale lock deletes and re-races instead of overwriting: overwriting would be
    # two steps again. If somebody grabs it in between, the next pass re-reads the pid and checks
    # whether it is alive, so nobody ends up holding a lock they did not create.
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    # Bounded retry: cleared a stale lock and still lost it a few times in a row means someone is
    # taking it over and over - fail loudly rather than spin here forever.
    if ($lockTry -ge 3) { throw "cannot win the install lock ${lockFile}: cleared a stale lock $lockTry times and it was taken again each time; make sure no other setup is running, then retry" }
  }
  $script:lockPath = $lockFile
  $script:markerPath = Join-Path $runtimeDir 'install.marker'
  Write-InstallMarker 'active'
}

function Copy-WithBackup($src, $dest) {
  $destDir = Split-Path $dest -Parent
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  if ((Test-Path $dest) -and -not (Test-FilesEqual $src $dest)) {
    Copy-Item $dest "$dest.bak" -Force
    Write-Host "backup: $dest.bak"
  }
  Copy-Item $src $dest -Force
}

# -WithTests / -WithHarness each walk their own subtree directly, bypassing the $skip /
# $skipAnyDepth / regex arms above (those are generated from harness/exclusions.json and one of
# them, ^harness/ext/, exists precisely to skip the whole subtree these two switches exist to
# install - reusing it verbatim would exclude everything). This is a second function, generated
# from the same source (harness/exclusions.json entries flagged optionalLeaf:true - the
# leaf-level, depth-independent ones: .DS_Store / *.bak / state/ / ...), not a hand-written
# second table (progress.md TODO #82 - a hand-written copy drifts the day someone adds a json
# entry and forgets this file).
function Test-OptionalExcluded([string]$relSlash) {
  # @exclusions:optional-begin (generated by .claude/scripts/gen-exclusions.mjs from harness/exclusions.json; hand edits are caught by --check)
  if ($relSlash -match '(^|/)signals\.jsonl$') { return $true }
  if ($relSlash -match '\.(bak|framework-new|swp)$') { return $true }
  if ($relSlash -match '(^|/)\.DS_Store$') { return $true }
  if ($relSlash -match '(^|/)Thumbs\.db$') { return $true }
  if ($relSlash -match '(^|/)state/') { return $true }
  # @exclusions:optional-end
  return $false
}

# Manifest-layered plan-and-write for one (src, dest) pair: create (new file) / skip (identical
# content) / update (target == old recorded version, safe overwrite, Copy-WithBackup still keeps
# a .bak) / conflict (user-modified or no history on record, do not overwrite, drop
# .framework-new for manual merge instead). The main loop below and both -WithTests / -WithHarness
# arms share this one function -- that sharing is what "overwrite semantics on par with the main
# loop" (progress.md TODO #81) actually means, not a second copy of the same decision.
# $oldSha is looked up by the caller, not here: the main loop reads $oldManifest
# (FRAMEWORK-MANIFEST.txt), -WithTests / -WithHarness read $script:oldOptionalManifest
# (FRAMEWORK-MANIFEST-OPTIONAL.txt, see above) -- two different accounts, one shared decision.
# When it is empty, a content difference is always treated as "unknown / user-modified" and never
# silently overwritten -- the state of a target that has never recorded that file before.
function Invoke-PlanAndApply([string]$src, [string]$dest, [string]$relSlash, [string]$oldSha) {
  if ((Test-Path $dest) -and -not (Test-FilesEqual $src $dest)) {
    if (-not ($oldSha -and (Get-NormalizedSha $dest) -eq $oldSha)) {
      Add-Plan 'conflict' $relSlash
      if (-not $DryRun) {
        Copy-Item $src "$dest.framework-new" -Force
        $script:frameworkNewList += $relSlash
        Register-Write ($relSlash + '.framework-new')
      }
      return
    }
    Add-Plan 'update' $relSlash
  } elseif (Test-Path $dest) {
    Add-Plan 'skip' $relSlash
  } else {
    Add-Plan 'create' $relSlash
  }
  if ($DryRun) { return }
  Copy-WithBackup $src $dest
  Register-Write $relSlash
}

# 2. Copy the .claude framework files (skip runtime artifacts / scratch / machine-specific; settings.json is rewritten separately)
# Same exclusion set as setup.sh copy_claude_tree, .claude/scripts/gen-manifest.sh and
# .claude/harness/ext/release.mjs MANIFEST_RULES -- change one, change all four. The four are kept
# as hand-synced copies on purpose (installers must run standalone; the release one is the auditor
# and would stop auditing if it shared a source), so the shared wording is verified by tests instead:
# .claude/tests/test-setup.sh section (6) compares the arms of all four literally, and
# .claude/tests/test-installer-parity.ps1 runs both installers side by side and diffs what landed.
# $skip is compared against the whole path relative to .claude/, i.e. root-anchored, which is what the
# bare-name arms of the other three tables mean: only the copy at the top of .claude/ is a runtime artifact.
# $skipAnyDepth is the subset the other three also carry a "*/<name>" arm for - those three grow at every
# depth, so they are matched by leaf name instead. Matching all of $skip by leaf name drops a nested
# skills/foo/settings.json that setup.sh copies and gen-manifest.sh records: installed on Linux, missing on
# Windows, with the manifest claiming it is there.
# Anything that is a directory rather than a file name goes in the regex list below.
# @exclusions:skip-begin (generated by .claude/scripts/gen-exclusions.mjs from harness/exclusions.json; hand edits are caught by --check)
$skip = @('FRAMEWORK-MANIFEST.txt', 'settings.json', 'settings-windows.json', 'settings.local.json',
  '.needs-review', '.needs-review.lock', '.tdd-exempt', '.red-verified', '.static-gate', '.degraded-review',
  '.fast-mode', '.subagent-reminded', '.three-file-sync-advised', '.tdd-gate-advised', '.stop-gate-strikes',
  '.stop-gate-advised', '.precompact-block-epoch', '.async-verify-last', 'signals.jsonl', '.DS_Store',
  'Thumbs.db')
$skipAnyDepth = @('signals.jsonl', '.DS_Store', 'Thumbs.db')
# @exclusions:skip-end
$srcRootLen = (Resolve-Path $srcClaude).Path.Length
# -Force: PowerShell treats dot-prefixed names as hidden on Unix, so without it a pwsh run there silently
# skips .claude/.gitignore - a manifest-listed framework file. The find(1) in the other two shell tables has
# no such notion, and on Windows a Hidden attribute would hide a file the same way; -Force puts this walk on
# the same footing everywhere.
Get-ChildItem -Path $srcClaude -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($srcRootLen).TrimStart('/', '\')
  $relSlash = $rel -replace '\\', '/'
  if ($skipAnyDepth -contains (Split-Path $rel -Leaf)) { return }
  if ($skip -contains $relSlash) { return }
  # private evolution feedback: skip top-level feedback/*.md, keep feedback/templates/ (INDEX is reset below)
  # @exclusions:regex-begin (generated; see harness/exclusions.json)
  # runtime state / non-distributed dirs / installer leftovers; notes live in harness/exclusions.json
  if ($relSlash -match '^evidence/') { return }
  if ($relSlash -match '^harness/(receipts|state|waivers|trend|evidence)/') { return }
  if ($relSlash -match '^harness/ext/') { return }
  if ($relSlash -match '^\.runtime/') { return }
  if ($relSlash -match '^worktrees/') { return }
  if ($relSlash -match '^(tests|research|agent-memory)/') { return }
  if ($relSlash -match '\.(bak|framework-new|swp)$') { return }
  if ($relSlash -match '^feedback/[^/]+\.md$') { return }
  # @exclusions:regex-end
  $dest = Join-Path $targetClaude $rel
  Invoke-PlanAndApply $_.FullName $dest $relSlash $oldManifest[$relSlash]
}

# -WithTests: copy the framework self-tests wholesale, through the same Invoke-PlanAndApply as the
# main loop above -- overwrite semantics on par with it (progress.md TODO #81): a test file the
# user modified on the target side is not overwritten, a fresh copy lands beside it as
# .framework-new; a file the source repo upgraded that the target's copy still matches the last
# recorded hash for updates cleanly, new ones create, identical ones skip. old_sha now comes from
# $script:oldOptionalManifest (FRAMEWORK-MANIFEST-OPTIONAL.txt, see above), not
# FRAMEWORK-MANIFEST.txt -- tests/* is excluded from that one on purpose (gen-manifest.sh), so a
# lookup against it was always empty and 'update' was unreachable for these files until this
# tracking existed (closing reviewer HIGH-1). Every file processed here is recorded into
# $script:newOptionalEntries at the source's current hash; Write-OptionalManifest writes it out
# once, after both switches have run.
if ($WithTests -and (Test-Path (Join-Path $srcClaude 'tests'))) {
  Get-ChildItem -Path (Join-Path $srcClaude 'tests') -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($srcRootLen).TrimStart('/', '\')
    $relSlash = $rel -replace '\\', '/'
    if (Test-OptionalExcluded $relSlash) { return }
    Invoke-PlanAndApply $_.FullName (Join-Path $targetClaude $rel) $relSlash $script:oldOptionalManifest[$relSlash]
    $script:newOptionalEntries[$relSlash] = Get-NormalizedSha $_.FullName
  }
}

# -WithHarness: copy the large-repo governance engine wholesale, same Invoke-PlanAndApply as
# -WithTests above (overwrite semantics on par with the main loop, old_sha from the same optional
# manifest). The two documents under harness/ext/rules/ get a second copy into .claude/rules/,
# because the path scope in their frontmatter is only honoured where Claude Code looks for rules -
# left in ext/ they would load nowhere; that copy goes through Invoke-PlanAndApply too (its own
# key is 'rules/xxx', not 'harness/ext/rules/xxx' -- the two copies are judged and recorded
# independently), so a user edit to the installed rules/ copy is likewise not silently overwritten.
if ($WithHarness -and (Test-Path (Join-Path $srcClaude 'harness/ext'))) {
  Get-ChildItem -Path (Join-Path $srcClaude 'harness/ext') -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($srcRootLen).TrimStart('/', '\')
    $relSlash = $rel -replace '\\', '/'
    if (Test-OptionalExcluded $relSlash) { return }
    Invoke-PlanAndApply $_.FullName (Join-Path $targetClaude $rel) $relSlash $script:oldOptionalManifest[$relSlash]
    $script:newOptionalEntries[$relSlash] = Get-NormalizedSha $_.FullName
    # Nested documents under harness/ext/rules/ (e.g. rules/nested/x.md) are not flattened into
    # .claude/rules/ - [^/]+ in the match below does not cross /, so only the top-level ones qualify.
    $ruleRel = if ($relSlash -match '^harness/ext/rules/[^/]+\.md$') { 'rules/' + (Split-Path $rel -Leaf) } else { '' }
    if ($ruleRel) {
      Invoke-PlanAndApply $_.FullName (Join-Path $targetClaude $ruleRel) $ruleRel $script:oldOptionalManifest[$ruleRel]
      $script:newOptionalEntries[$ruleRel] = Get-NormalizedSha $_.FullName
    }
  }
}

Write-OptionalManifest

# -DryRun stops here. The three files the copy loop does not own get planned too: settings.json is
# rewritten hook by hook so an existing one always counts as an update, the other two are plain copies.
if ($DryRun) {
  foreach ($rel in @('settings.json', 'FRAMEWORK-MANIFEST.txt', 'feedback/FEEDBACK-INDEX.md')) {
    if (Test-Path (Join-Path $targetClaude $rel)) {
      # FEEDBACK-INDEX.md is created only when missing and never touched afterwards, so it plans as skip.
      if ($rel -eq 'feedback/FEEDBACK-INDEX.md') { Add-Plan 'skip' $rel } else { Add-Plan 'update' $rel }
    } else { Add-Plan 'create' $rel }
  }
  Write-Output ('dry-run: create={0} update={1} conflict={2} skip={3} (conflict would land <file>.framework-new)' -f `
      $script:plan['create'], $script:plan['update'], $script:plan['conflict'], $script:plan['skip'])
  exit 0
}

# 3. Hook commands are taken as they ship - exec form, node runs the .mjs directly (see the header note).
#    Two things still happen here.
#    a) statusLine has no exec form; on a pure PowerShell box the string is run by PowerShell, so the project-dir
#       variable has to be spelled $env:CLAUDE_PROJECT_DIR (forward slashes, double quotes - PowerShell expands
#       $env: inside those).
$src = Get-Content (Join-Path $srcClaude 'settings.json') -Raw | ConvertFrom-Json
if ($src.PSObject.Properties['statusLine'] -and $src.statusLine.command) {
  $src.statusLine.command = 'node "$env:CLAUDE_PROJECT_DIR/.claude/scripts/statusline.mjs"'
}

#    b) drop hook files an older install of this framework left in the target: .claude/hooks/<name>.sh|.ps1 plus
#       the lib-*.sh / lib-*.ps1 helpers next to them. The framework no longer ships any of them, so copying
#       alone would leave them lying around forever and doctor.sh / gate-audit.sh would keep counting them.
$targetHooks = Join-Path $targetClaude 'hooks'
if (Test-Path $targetHooks) {
  $stale = @(Get-ChildItem $targetHooks -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.sh' -or $_.Extension -eq '.ps1' })
  foreach ($f in $stale) { Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue }
  if ($stale.Count -gt 0) { Write-Host "[ok] removed $($stale.Count) legacy .sh/.ps1 hook file(s) from the target" }
}

# Identity of one hook entry: only an entry that matches one of the two framework templates verbatim is keyed by the
# hook name (same rule as classify() in hook-form.mjs) - exec form is command "node" with exactly one arg equal to
# ${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>.mjs, string form has no args key and command "node .claude/hooks/<name>.mjs".
# The two forms of the same hook then count as one entry, so upgrading a string-form target does not merge in an
# exec-form duplicate. Anything else is keyed by command plus its args: exec form puts the literal "node" in
# .command, so keying on .command alone would judge every incoming hook "already present"; a user's own "same script
# plus extra args" entry lands here too and must not swallow the framework one.
function Get-HookId($h) {
  $hasArgs = $h.PSObject.Properties['args'] -ne $null
  if ($hasArgs) {
    $argv = @($h.args)
    if (([string]$h.command -ceq 'node') -and $argv.Count -eq 1 -and ([string]$argv[0] -cmatch '^\$\{CLAUDE_PROJECT_DIR\}/\.claude/hooks/([A-Za-z0-9_-]+)\.mjs$')) {
      return 'hook:' + $Matches[1]
    }
  } elseif ([string]$h.command -cmatch '^node \.claude/hooks/([A-Za-z0-9_-]+)\.mjs$') {
    return 'hook:' + $Matches[1]
  }
  $id = [string]$h.command
  if ($h.PSObject.Properties['args'] -and $h.args) {
    $id += ' ' + ((@($h.args) | ForEach-Object { [string]$_ }) -join ' ')
  }
  return $id
}

# Recursively collect the identity of every command-bearing object (for merge dedup)
function Get-AllCommands($obj) {
  $acc = New-Object System.Collections.Generic.List[string]
  function Walk($o) {
    if ($null -eq $o) { return }
    if (($o -is [System.Collections.IEnumerable]) -and ($o -isnot [string])) {
      foreach ($i in $o) { Walk $i }
    } elseif ($o -is [pscustomobject]) {
      if ($o.PSObject.Properties['command'] -and ($o.command -is [string])) { $acc.Add((Get-HookId $o)) }
      foreach ($p in $o.PSObject.Properties) { Walk $p.Value }
    }
  }
  Walk $obj
  return $acc
}

$targetSettings = Join-Path $targetClaude 'settings.json'

# Detect hook entries an older install of this framework left in the target settings - either the Git Bash ".sh"
# form or the pwsh '-Command "& ...<name>.ps1"' form - so the merge can drop them before appending the exec-form
# entries. Conservative: the command or one of its args must point at a .claude/hooks/<name>.sh|.ps1 path, which
# only the framework's own entries do; user commands stay untouched.
function Test-IsLegacyHook($h) {
  if ($null -eq $h) { return $false }
  $parts = @()
  if ($h.PSObject.Properties['command'] -and $h.command) { $parts += [string]$h.command }
  if ($h.PSObject.Properties['args'] -and $h.args) { foreach ($a in @($h.args)) { $parts += [string]$a } }
  foreach ($p in $parts) {
    if ($p -match '\.claude[/\\]hooks[/\\][A-Za-z0-9_-]+\.(sh|ps1)') { return $true }
  }
  return $false
}

# Strip legacy hook entries from every group of every event in $obj's hooks (in place).
function Remove-LegacyHooks($obj) {
  if (-not $obj.hooks) { return }
  foreach ($ev in $obj.hooks.PSObject.Properties) {
    foreach ($group in $ev.Value) {
      if ($group.hooks) {
        $group.hooks = @($group.hooks | Where-Object { -not (Test-IsLegacyHook $_) })
      }
    }
  }
}

# No -HookForm given: keep the form the target already has. The merge below writes new entries in exec form, so
# probing afterwards would always read mixed - it has to happen first. mixed goes to string (one form after the
# install beats a mix); none / exec / unreadable go to exec, and an unreadable one says so.
if (-not $HookForm) {
  $HookForm = 'exec'
  $hookFormTool = Join-Path $targetClaude 'scripts/hook-form.mjs'
  if ((Test-Path $targetSettings) -and -not $Force -and (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $hookFormTool)) {
    $found = (& node $hookFormTool --check --file $targetSettings 2>$null | Out-String).Trim()
    switch ($found) {
      'string' { $HookForm = 'string' }
      'mixed' {
        $HookForm = 'string'
        Write-Host 'setup: target settings.json hook form is mixed (exec and string together); converting to string after the install.'
      }
      { $_ -in 'exec', 'none' } { }
      default { Write-Host 'setup: could not read the hook form of the target settings.json; treating it as exec.' }
    }
  }
}

if ((Test-Path $targetSettings) -and -not $Force) {
  # 4. target already has settings.json: strip legacy .sh/.ps1 hook entries, then only append the exec-form hook
  #    commands not present yet, leaving other user config untouched.
  $tgt = Get-Content $targetSettings -Raw | ConvertFrom-Json
  Remove-LegacyHooks $tgt
  $existing = Get-AllCommands $tgt
  if (-not $tgt.hooks) { $tgt | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force }
  foreach ($event in $src.hooks.PSObject.Properties) {
    foreach ($group in $event.Value) {
      $newHooks = @($group.hooks | Where-Object { $_.command -and ($existing -notcontains (Get-HookId $_)) })
      if ($newHooks.Count -gt 0) {
        $ng = [pscustomobject]@{}
        if ($group.PSObject.Properties['matcher']) { $ng | Add-Member -NotePropertyName matcher -NotePropertyValue $group.matcher }
        $ng | Add-Member -NotePropertyName hooks -NotePropertyValue $newHooks
        if (-not $tgt.hooks.PSObject.Properties[$event.Name]) {
          $tgt.hooks | Add-Member -NotePropertyName $event.Name -NotePropertyValue @() -Force
        }
        $tgt.hooks.($event.Name) = @($tgt.hooks.($event.Name)) + $ng
      }
    }
  }
  # Adopt the framework statusLine only when the target has none (never clobber a user statusline)
  if ($src.PSObject.Properties['statusLine'] -and -not $tgt.PSObject.Properties['statusLine']) {
    $tgt | Add-Member -NotePropertyName statusLine -NotePropertyValue $src.statusLine
  }
  Copy-Item $targetSettings "$targetSettings.bak" -Force
  Write-Host "backup: $targetSettings.bak"
  $tgt | ConvertTo-Json -Depth 20 | Set-Content $targetSettings -Encoding UTF8
  Register-Write 'settings.json'
} else {
  if ((Test-Path $targetSettings) -and $Force) {
    Copy-Item $targetSettings "$targetSettings.bak" -Force
    Write-Host "backup: $targetSettings.bak"
  }
  $targetDir = Split-Path $targetSettings -Parent
  if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
  $src | ConvertTo-Json -Depth 20 | Set-Content $targetSettings -Encoding UTF8
  Register-Write 'settings.json'
}

# The finished settings.json ends up in one form = $HookForm (explicit or detected): the merge above writes new
# entries in exec form, so convert in one pass; on an already-matching target this is a converted=0 no-op. A failed
# conversion stops the install loudly. Without node: string is a hard error, exec is already what the merge produces.
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node (Join-Path $targetClaude 'scripts/hook-form.mjs') --to $HookForm --file $targetSettings
  if ($LASTEXITCODE -ne 0) { throw "hook-form.mjs --to $HookForm failed (exit $LASTEXITCODE); settings.json was not converted: $targetSettings" }
} elseif ($HookForm -eq 'string') {
  throw '-HookForm string needs node to run hook-form.mjs, and node is not on PATH'
}

# Create the feedback INDEX from the clean template only when the target has none (same source as
# make-release.sh; private entries were skipped above). An existing index is left alone: it is the
# project's own accumulated entry list, and resetting it to the empty template on every upgrade
# wipes it, so the evolution engine finds no feedback to scan.
$fbTpl = Join-Path $srcClaude 'feedback/templates/feedback-index-template.md'
$fbIndex = Join-Path $targetClaude 'feedback/FEEDBACK-INDEX.md'
if ((Test-Path $fbTpl) -and -not (Test-Path $fbIndex)) {
  Copy-WithBackup $fbTpl $fbIndex
  Register-Write 'feedback/FEEDBACK-INDEX.md'
}

# Install the new manifest into the target (next upgrade uses it to tell
# "old framework version, safe to overwrite" from "user-modified, keep").
$srcManifest = Join-Path $srcClaude 'FRAMEWORK-MANIFEST.txt'
if (Test-Path $srcManifest) {
  Copy-WithBackup $srcManifest (Join-Path $targetClaude 'FRAMEWORK-MANIFEST.txt')
  Register-Write 'FRAMEWORK-MANIFEST.txt'
}

# Summary of user-modified files that were NOT overwritten (new versions at *.framework-new)
if ($script:frameworkNewList.Count -gt 0) {
  Write-Host ("setup: {0} file(s) modified on the target side were NOT overwritten;" -f $script:frameworkNewList.Count) -ForegroundColor Yellow
  Write-Host 'setup: new versions were written next to them as <file>.framework-new for manual merge:' -ForegroundColor Yellow
  foreach ($f in $script:frameworkNewList) { Write-Host "setup:   - .claude/$f" -ForegroundColor Yellow }
}

# Normal finish: marker and lock both go, and the empty .runtime goes with them - an empty shell left
# behind turns "runtime dirs are not installed" red in tests/test-setup.sh (5), which reads unrelated.
$script:installDone = $true
if ($script:markerPath -and (Test-Path $script:markerPath)) { Remove-Item $script:markerPath -Force }
if ($script:lockPath -and (Test-Path $script:lockPath)) { Remove-Item $script:lockPath -Force }
if ((Test-Path $runtimeDir) -and -not (Get-ChildItem $runtimeDir -Force)) { Remove-Item $runtimeDir -Force }

$hooksCount = (Get-ChildItem (Join-Path $srcClaude 'hooks') -Filter *.mjs -File -ErrorAction SilentlyContinue).Count
Write-Host "installed: mjs_hooks=$hooksCount target=$Target" -ForegroundColor Green
Write-Host "Done. Claude Code loads the hooks from $targetClaude\settings.json (exec form: node runs .claude/hooks/<name>.mjs directly, byte-identical on every platform)."
exit 0
