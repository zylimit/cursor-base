#!/usr/bin/env pwsh
# # risk: high
# # levels: smoke, unit, integration, all
# .cursor/tests/ps1-shell.test.ps1 - End-to-end PowerShell contract and integration test suite for cursor-base.
# Pure 7-bit ASCII UTF-8 without BOM. Compatible with Windows PowerShell 5.1 and PowerShell 7+ (pwsh).
# Covers:
#   1. No-BOM, pure-ASCII, PowerShell Language.Parser AST check, and static contract for -WithCc/-NoAutoCc/-CcBase/-BundleCc/-HookForm & 'package' guard
#   2. Unknown flag (--dryrun), bare typo ('package'), mutually exclusive (-NoAutoCc -WithCc / -NoAutoCc -CcBase), duplicate target, and CON rejection (exit 2, zero mkdir)
#   3. setup.ps1 -DryRun zero-write guarantee
#   4. Tier 1: 3x repeated idempotent install onto cc-base (.claude/) + exec->string settings.json conversion + OS link + generated rules/agents + doctor.mjs --json
#   5. Tier 2: empty target one-step cc-base co-installation (-CcBase mock) with zero root files
#   6. 3-way conflict preservation (.cursor-new) + hooks.json/cli.json custom entry preservation + upgrade -Force recovery with .bak
#   7. Legacy v2 framework AGENTS.md + physical .cursor/skills migration vs user custom AGENTS.md preservation
#   8. Tier 3: -NoAutoCc deferred pre-.claude/ install (exit 0) + hook-adapter.mjs sessionStart link/rules/agents/string-form self-healing
#   9. setup.ps1 -Uninstall -Force detaches OS links and keeps .claude/ 100% byte-for-byte untouched

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') '..'))
$SetupPs1 = Join-Path $RepoRoot 'setup.ps1'
$SelfPs1  = Join-Path (Join-Path (Join-Path $RepoRoot '.cursor') 'tests') 'ps1-shell.test.ps1'
$ContractPath = Join-Path $RepoRoot 'cc-base-contract.json'

$PsExe = $null
try {
  $PsExe = (Get-Process -Id $PID).Path
} catch {
  $PsExe = $null
}
if (-not $PsExe) {
  $pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwshCmd) {
    $PsExe = $pwshCmd.Source
  } else {
    $PsExe = 'powershell'
  }
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8NoBom([string]$FilePath, [string]$Text) {
  $parent = Split-Path -Parent $FilePath
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($FilePath, $Text, $Utf8NoBom)
}

function Invoke-PsScript([string]$ScriptPath, [string[]]$ScriptArgs) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $stdoutLines = & $PsExe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @ScriptArgs 2>$null
    $rc = $LASTEXITCODE
    $stdoutText = ($stdoutLines | Out-String).Trim()
    return @{ ExitCode = $rc; Stdout = $stdoutText }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-NodeJson([string]$ScriptPath, [string[]]$NodeArgs, [string]$StdinText = '') {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($StdinText -ne '') {
      $stdoutLines = $StdinText | & node $ScriptPath @NodeArgs 2>$null
    } else {
      $stdoutLines = & node $ScriptPath @NodeArgs 2>$null
    }
    $rc = $LASTEXITCODE
    $stdoutText = ($stdoutLines | Out-String).Trim()
    return @{ ExitCode = $rc; Stdout = $stdoutText }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Seed-CompliantCcBase([string]$TargetDir, [switch]$WithInstallers) {
  $contract = [System.IO.File]::ReadAllText($ContractPath) | ConvertFrom-Json
  Write-Utf8NoBom (Join-Path $TargetDir '.claude/CLAUDE.md') "# Mock CLAUDE.md`nCore SiteMaster constitution.`n"
  Write-Utf8NoBom (Join-Path $TargetDir '.claude/rules/core.md') "# Core Rules`n"

  $execSettings = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/session-rules-banner.mjs"],"timeout":5}]}]}}' + "`n"
  Write-Utf8NoBom (Join-Path $TargetDir '.claude/settings.json') $execSettings

  $minSkills = [int]$contract.minSkills
  for ($i = 1; $i -le $minSkills; $i++) {
    $num = $i.ToString('00')
    Write-Utf8NoBom (Join-Path $TargetDir ".claude/skills/skill-$num/SKILL.md") "---`nname: skill-$num`n---`n# Skill $num`n"
    Write-Utf8NoBom (Join-Path $TargetDir ".claude/skills/skill-$num/refs/guide.md") "precious-skill-ref-$num`n"
  }

  foreach ($role in $contract.requiredAgents) {
    $disallowedLine = "disallowedTools: Task`n"
    if ($role -eq 'progress-recorder' -or $role -eq 'feedback-observer' -or $role -eq 'domain-recorder') {
      $disallowedLine = "disallowedTools: Bash, Task`n"
    }
    $agentBody = "---`nname: $role`ndescription: Mock role $role`nmodel: sonnet`n$disallowedLine---`n`nRole instructions for $role.`n"
    Write-Utf8NoBom (Join-Path $TargetDir ".claude/agents/$role.md") $agentBody
  }

  foreach ($hk in $contract.requiredHooks) {
    if ($hk -eq 'session-rules-banner.mjs') {
      Write-Utf8NoBom (Join-Path $TargetDir ".claude/hooks/$hk") "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'cc-banner-ok'}})+'\n');`n"
    } else {
      Write-Utf8NoBom (Join-Path $TargetDir ".claude/hooks/$hk") "// mock hook $hk`n"
    }
  }

  if ($WithInstallers) {
    $shBody = "#!/usr/bin/env bash`nset -eu`nDRY=0`nTARGET='.'`nwhile [ `$# -gt 0 ]; do`n  case `"`$1`" in`n    --dry-run) DRY=1; shift ;;`n    --hook-form) shift 2 ;;`n    *) TARGET=`"`$1`"; shift ;;`n  esac`ndone`nif [ `"`$DRY`" = '1' ]; then exit 0; fi`nSRC=`"`$(cd `"`$(dirname `"`$0`")`" && pwd)`"`nmkdir -p `"`$TARGET/.claude`"`ncp -R `"`$SRC/.claude/.`" `"`$TARGET/.claude/`"`n"
    Write-Utf8NoBom (Join-Path $TargetDir 'setup.sh') $shBody
    $psBody = "param([string]`$Target = '.', [string]`$HookForm = 'string', [switch]`$DryRun, [switch]`$Force)`nif (`$DryRun) { exit 0 }`n`$dst = Join-Path `$Target '.claude'`nNew-Item -ItemType Directory -Path `$dst -Force | Out-Null`nCopy-Item -Path (Join-Path `$PSScriptRoot '.claude\*') -Destination `$dst -Recurse -Force`n"
    Write-Utf8NoBom (Join-Path $TargetDir 'setup.ps1') $psBody
  }
}

function Get-TreeHashSnapshot([string]$RootDir) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $RootDir)) { return $map }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $files = Get-ChildItem -LiteralPath $RootDir -Recurse -File -Force
    foreach ($f in $files) {
      $rel = $f.FullName.Substring($RootDir.Length).TrimStart('\', '/').Replace('\', '/')
      $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
      $hashHex = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
      $map[$rel] = $hashHex
    }
  } finally {
    $sha.Dispose()
  }
  return $map
}

function Assert-SnapshotsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  if ($Expected.Count -ne $Actual.Count) {
    throw ("Snapshot file count mismatch ($Label): expected $($Expected.Count), got $($Actual.Count)")
  }
  foreach ($k in $Expected.Keys) {
    if (-not $Actual.ContainsKey($k)) {
      throw ("Snapshot missing file ($Label): $k")
    }
    if ($Actual[$k] -ne $Expected[$k]) {
      throw ("Snapshot SHA256 mismatch ($Label): $k")
    }
  }
}

$PassCount = 0
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw "ASSERTION FAILED: $Message"
  }
}

function Step-Pass([string]$Label) {
  $script:PassCount++
  Write-Host ("ok {0} - {1}" -f $script:PassCount, $Label)
}

# 1. PowerShell AST, No-BOM, Pure-ASCII, and Static Parameter Contract verification
$PsFiles = @(
  @{ Name = 'setup.ps1'; Path = $SetupPs1 },
  @{ Name = '.cursor/tests/ps1-shell.test.ps1'; Path = $SelfPs1 }
)

$SetupAst = $null
foreach ($item in $PsFiles) {
  Assert-True (Test-Path -LiteralPath $item.Path) ("Missing PowerShell script: " + $item.Name)
  $bytes = [System.IO.File]::ReadAllBytes($item.Path)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  Assert-True (-not $hasBom) ("UTF-8 BOM detected in " + $item.Name)

  for ($idx = 0; $idx -lt $bytes.Length; $idx++) {
    Assert-True ($bytes[$idx] -lt 0x80) ("Non-ASCII byte 0x{0:X2} at offset {1} in {2}" -f $bytes[$idx], $idx, $item.Name)
  }

  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($item.Path, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors -and $parseErrors.Count -gt 0) {
    throw ("PowerShell AST parse error in {0}: {1}" -f $item.Name, $parseErrors[0].Message)
  }
  if ($item.Name -eq 'setup.ps1') {
    $SetupAst = $ast
  }
}

$DeclaredParams = @($SetupAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
foreach ($reqParam in @('Command', 'Target', 'DryRun', 'Force', 'Uninstall', 'SourceCheck', 'WithCc', 'NoAutoCc', 'CcBase', 'BundleCc', 'Out', 'HookForm', 'Json', 'ExtraArgs')) {
  Assert-True ($DeclaredParams -contains $reqParam) ("setup.ps1 ParamBlock missing parameter -$reqParam")
}

$SetupText = [System.IO.File]::ReadAllText($SetupPs1)
foreach ($reqToken in @("'package'", '--with-cc', '--no-auto-cc', '--cc-base', '--bundle-cc', '--hook-form')) {
  Assert-True ($SetupText.Contains($reqToken)) ("setup.ps1 missing static contract token: " + $reqToken)
}
Step-Pass 'AST parse, no-BOM, pure-ASCII, and -WithCc/-NoAutoCc/-CcBase/-BundleCc/-HookForm/package static contract passed'

$TmpBase = Join-Path ([System.IO.Path]::GetTempPath()) ('cursor-ps1-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))

try {
  New-Item -ItemType Directory -Path $TmpBase -Force | Out-Null

  # 2. Reject --dryrun, bare 'package' typo, mutually exclusive flags, duplicate target, and CON (exit 2, zero mkdir)
  $workCwd = Join-Path $TmpBase 'cwd-guard'
  New-Item -ItemType Directory -Path $workCwd -Force | Out-Null

  Push-Location -LiteralPath $workCwd
  try {
    $rTypo = Invoke-PsScript $SetupPs1 @('--dryrun')
    $rPkg  = Invoke-PsScript $SetupPs1 @('package')
  } finally {
    Pop-Location
  }
  Assert-True ($rTypo.ExitCode -eq 2) ("Expected setup.ps1 --dryrun to exit 2, got " + $rTypo.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $workCwd '--dryrun'))) 'setup.ps1 must NOT create directory --dryrun'
  Assert-True ($rPkg.ExitCode -eq 2) ("Expected setup.ps1 package bare typo to exit 2, got " + $rPkg.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $workCwd 'package'))) 'setup.ps1 must NOT create directory package'

  $mutTarget = Join-Path $TmpBase 'mut-noauto-withcc'
  $rMut = Invoke-PsScript $SetupPs1 @('-Target', $mutTarget, '-NoAutoCc', '-WithCc')
  Assert-True ($rMut.ExitCode -eq 2) ("Expected -NoAutoCc -WithCc conflict to exit 2, got " + $rMut.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath $mutTarget)) '-NoAutoCc -WithCc must NOT create target directory'

  $mutCcTarget = Join-Path $TmpBase 'mut-noauto-ccbase'
  $rMutCc = Invoke-PsScript $SetupPs1 @('-Target', $mutCcTarget, '-NoAutoCc', '-CcBase', $TmpBase)
  Assert-True ($rMutCc.ExitCode -eq 2) ("Expected -NoAutoCc -CcBase conflict to exit 2, got " + $rMutCc.ExitCode)

  $dupA = Join-Path $TmpBase 'dup-a'
  $dupB = Join-Path $TmpBase 'dup-b'
  $rDup = Invoke-PsScript $SetupPs1 @($dupA, '-Target', $dupB)
  Assert-True ($rDup.ExitCode -eq 2) ("Expected duplicate target rejection exit 2, got " + $rDup.ExitCode)

  $conTarget = Join-Path $TmpBase 'CON'
  $rCon = Invoke-PsScript $SetupPs1 @($conTarget)
  Assert-True ($rCon.ExitCode -eq 2) ("Expected setup.ps1 CON path rejection exit 2, got " + $rCon.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath $conTarget)) 'setup.ps1 must NOT create reserved CON directory'
  Step-Pass 'Unknown option (--dryrun), bare package, -NoAutoCc/-WithCc, duplicate target, and CON rejected with exit 2'

  # 3. setup.ps1 -DryRun leaves zero files on disk
  $dryTarget = Join-Path $TmpBase 'dry-target'
  $rDry = Invoke-PsScript $SetupPs1 @('-Target', $dryTarget, '-NoAutoCc', '-DryRun')
  Assert-True ($rDry.ExitCode -eq 0) ("setup.ps1 -DryRun failed with exit " + $rDry.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath $dryTarget)) 'setup.ps1 -DryRun must not create target directory'
  Step-Pass 'setup.ps1 -DryRun succeeded with zero writes'

  # 4. Tier 1: 3x repeated idempotent install onto cc-base (.claude/) + string form + OS link + rules/agents + doctor.mjs
  $projTarget = Join-Path $TmpBase 'proj-tier1'
  Seed-CompliantCcBase $projTarget

  $rInst1 = Invoke-PsScript $SetupPs1 @($projTarget, '-Json')
  Assert-True ($rInst1.ExitCode -eq 0) ("setup.ps1 install #1 failed: " + $rInst1.ExitCode)
  $j1 = $rInst1.Stdout | ConvertFrom-Json
  Assert-True ($j1.ccBase.tier -eq 1 -and $j1.ccBase.status -eq 'reused') 'Tier 1 install #1 must report tier=1 status=reused'
  Assert-True ([bool]$j1.generated.rules -and $j1.generated.agents -ge 8) 'Tier 1 install #1 must generate rules and >= 8 agents'

  $claudeSettingsAfter = [System.IO.File]::ReadAllText((Join-Path $projTarget '.claude/settings.json'))
  Assert-True ($claudeSettingsAfter.Contains('node .claude/hooks/session-rules-banner.mjs')) 'Tier 1 install must convert .claude/settings.json to string form'
  $snapClaudeAfterInst1 = Get-TreeHashSnapshot (Join-Path $projTarget '.claude')

  $rInst2 = Invoke-PsScript $SetupPs1 @($projTarget, '-Json')
  Assert-True ($rInst2.ExitCode -eq 0) ("setup.ps1 install #2 failed: " + $rInst2.ExitCode)
  $j2 = $rInst2.Stdout | ConvertFrom-Json
  Assert-True ($j2.stats.create -eq 0 -and $j2.stats.update -eq 0 -and $j2.stats.conflict -eq 0) 'Install #2 must have create=0 update=0 conflict=0'

  $rInst3 = Invoke-PsScript $SetupPs1 @('-Target', $projTarget, '-Json')
  Assert-True ($rInst3.ExitCode -eq 0) ("setup.ps1 install #3 failed: " + $rInst3.ExitCode)
  $j3 = $rInst3.Stdout | ConvertFrom-Json
  Assert-True ($j3.stats.create -eq 0 -and $j3.stats.update -eq 0 -and $j3.stats.conflict -eq 0) 'Install #3 must have create=0 update=0 conflict=0'

  $topNames = @(Get-ChildItem -LiteralPath $projTarget -Force | Select-Object -ExpandProperty Name | Sort-Object)
  Assert-True (($topNames -join ',') -eq '.claude,.cursor') ("Expected only .claude and .cursor at root, got: " + ($topNames -join ','))

  $skillsLinkItem = Get-Item -LiteralPath (Join-Path $projTarget '.cursor/skills') -Force
  $isSkillsLink = [bool]($skillsLinkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or ([string]$skillsLinkItem.LinkType -ne '')
  Assert-True $isSkillsLink '.cursor/skills must be an OS ReparsePoint (Junction/symlink)'

  $docScript = Join-Path $projTarget '.cursor/scripts/doctor.mjs'
  $rDoc = Invoke-NodeJson $docScript @($projTarget, '--json')
  Assert-True ($rDoc.ExitCode -eq 0) ("Downstream doctor.mjs failed: " + $rDoc.Stdout)
  $docObj = $rDoc.Stdout | ConvertFrom-Json
  Assert-True ([bool]$docObj.ok) 'Downstream doctor.mjs ok must be true'
  Step-Pass 'Tier 1 3x repeated install idempotency, string form conversion, zero root files, OS link, rules/agents, and doctor.mjs passed'

  # 5. Tier 2: Empty target automatic cc-base co-installation
  $mockCcSource = Join-Path $TmpBase 'mock-cc-source'
  Seed-CompliantCcBase $mockCcSource -WithInstallers
  if ([System.Environment]::OSVersion.Platform -eq 'Unix') {
    & chmod +x (Join-Path $mockCcSource 'setup.sh')
  }
  $autoTarget = Join-Path $TmpBase 'proj-tier2-auto'
  $rAuto = Invoke-PsScript $SetupPs1 @('-Target', $autoTarget, '-CcBase', $mockCcSource, '-Json')
  Assert-True ($rAuto.ExitCode -eq 0) ("Tier 2 auto-install failed: " + $rAuto.ExitCode)
  $autoObj = $rAuto.Stdout | ConvertFrom-Json
  Assert-True ($autoObj.ccBase.tier -eq 2 -and $autoObj.ccBase.status -eq 'installed') 'Expected Tier 2 tier=2 status=installed'
  Assert-True (-not [bool]$autoObj.pendingCcBase) 'Expected pendingCcBase=false after Tier 2 co-install'
  $autoTopNames = @(Get-ChildItem -LiteralPath $autoTarget -Force | Select-Object -ExpandProperty Name | Sort-Object)
  Assert-True (($autoTopNames -join ',') -eq '.claude,.cursor') 'Tier 2 co-install must leave zero root files'
  Step-Pass 'Tier 2 empty target one-step cc-base co-installation passed with zero root files'

  # 6. 3-way conflict protection (.cursor-new) + hooks.json/cli.json custom entry preservation + upgrade -Force recovery
  $hooksFile = Join-Path $projTarget '.cursor/hooks.json'
  $hooksObj = [System.IO.File]::ReadAllText($hooksFile) | ConvertFrom-Json
  $hooksObj.hooks | Add-Member -NotePropertyName 'stop' -NotePropertyValue @(@{ command = 'node scripts/custom-stop.mjs'; timeout = 5 })
  Write-Utf8NoBom $hooksFile (($hooksObj | ConvertTo-Json -Depth 10) + "`n")

  $cliFile = Join-Path $projTarget '.cursor/cli.json'
  $cliObj = [System.IO.File]::ReadAllText($cliFile) | ConvertFrom-Json
  $cliObj.permissions.deny += 'Read(**/team-private.secret)'
  Write-Utf8NoBom $cliFile (($cliObj | ConvertTo-Json -Depth 10) + "`n")

  $managedDoc = Join-Path $projTarget '.cursor/scripts/doctor.mjs'
  $origDoc = [System.IO.File]::ReadAllText($managedDoc)
  Write-Utf8NoBom $managedDoc ($origDoc + "`n// Local PS1 Edit`n")

  $rUpg = Invoke-PsScript $SetupPs1 @('upgrade', '-Target', $projTarget, '-Json')
  Assert-True ($rUpg.ExitCode -eq 0) ("setup.ps1 upgrade failed: " + $rUpg.ExitCode)
  Assert-True (Test-Path -LiteralPath ($managedDoc + '.cursor-new')) 'Expected .cursor/scripts/doctor.mjs.cursor-new sidecar'
  Assert-True ([System.IO.File]::ReadAllText($managedDoc).Contains('Local PS1 Edit')) 'User edit in doctor.mjs must be preserved'
  Assert-True ([System.IO.File]::ReadAllText($hooksFile).Contains('custom-stop.mjs')) 'User custom hook in hooks.json must be preserved'
  Assert-True ([System.IO.File]::ReadAllText($cliFile).Contains('team-private.secret')) 'User custom deny entry in cli.json must be preserved'

  Remove-Item -LiteralPath ($managedDoc + '.cursor-new') -Force
  $rUpgForce = Invoke-PsScript $SetupPs1 @('upgrade', '-Target', $projTarget, '-Force', '-Json')
  Assert-True ($rUpgForce.ExitCode -eq 0) ("setup.ps1 upgrade -Force failed: " + $rUpgForce.ExitCode)
  Assert-True (-not [System.IO.File]::ReadAllText($managedDoc).Contains('Local PS1 Edit')) 'upgrade -Force must restore framework doctor.mjs'
  Assert-True (Test-Path -LiteralPath ($managedDoc + '.bak')) 'upgrade -Force must write .bak backup'
  Step-Pass '3-way conflict sidecar (.cursor-new), hooks.json/cli.json lossless merge, and upgrade -Force (.bak) passed'

  # 7. Legacy v2 AGENTS.md + physical .cursor/skills migration vs user custom AGENTS.md preservation
  $v2Target = Join-Path $TmpBase 'proj-v2-migrate'
  Seed-CompliantCcBase $v2Target
  $v2Sig = [regex]::Unescape('\u672c\u4ed3\u662f cc-base\uff08Claude Code \u4ea7\u54c1\u5f00\u53d1\u6846\u67b6\uff09\u7684 Cursor \u53d1\u884c\u7248')
  Write-Utf8NoBom (Join-Path $v2Target 'AGENTS.md') ("# cursor-base v2.2`n`n" + $v2Sig + "`n")
  Write-Utf8NoBom (Join-Path $v2Target '.cursor/skills/old-v2-skill/SKILL.md') "# old v2 skill`n"
  $rV2 = Invoke-PsScript $SetupPs1 @($v2Target, '-Json')
  Assert-True ($rV2.ExitCode -eq 0) ("v2 migration install failed: " + $rV2.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $v2Target 'AGENTS.md'))) 'Legacy v2 AGENTS.md must be archived away from root'
  $v2Obj = $rV2.Stdout | ConvertFrom-Json
  Assert-True ($v2Obj.migratedPaths.Count -ge 2) 'Expected both legacy AGENTS.md and physical .cursor/skills to be archived'

  $customAgentsTarget = Join-Path $TmpBase 'proj-user-agents'
  Seed-CompliantCcBase $customAgentsTarget
  Write-Utf8NoBom (Join-Path $customAgentsTarget 'AGENTS.md') "# Custom Team Instructions`nKeep this file intact.`n"
  $rCustomAg = Invoke-PsScript $SetupPs1 @($customAgentsTarget, '-Json')
  Assert-True ($rCustomAg.ExitCode -eq 0) 'Install with user custom AGENTS.md failed'
  Assert-True ([System.IO.File]::ReadAllText((Join-Path $customAgentsTarget 'AGENTS.md')).Contains('Custom Team Instructions')) 'User custom AGENTS.md must remain untouched'
  Step-Pass 'Legacy v2 AGENTS.md archival and user custom AGENTS.md preservation passed'

  # 8. Tier 3: -NoAutoCc deferred pre-.claude/ install + sessionStart self-healing
  $preTarget = Join-Path $TmpBase 'proj-tier3-pre'
  $rPre = Invoke-PsScript $SetupPs1 @($preTarget, '-NoAutoCc', '-Json')
  Assert-True ($rPre.ExitCode -eq 0) ("Tier 3 -NoAutoCc install failed: " + $rPre.ExitCode)
  $preObj = $rPre.Stdout | ConvertFrom-Json
  Assert-True ($preObj.ccBase.tier -eq 3 -and $preObj.ccBase.status -eq 'deferred') 'Expected tier=3 status=deferred with -NoAutoCc'
  Assert-True ([bool]$preObj.pendingCcBase) 'Expected pendingCcBase=true when -NoAutoCc is passed on empty target'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $preTarget '.cursor/skills'))) '.cursor/skills link must not exist before .claude/'

  Seed-CompliantCcBase $preTarget
  $adapterScript = Join-Path $preTarget '.cursor/scripts/hook-adapter.mjs'
  $evJson = ('{"cwd":"' + $preTarget.Replace('\', '\\') + '"}')
  $rSs = Invoke-NodeJson $adapterScript @('sessionStart') $evJson
  Assert-True ($rSs.ExitCode -eq 0) 'sessionStart after .claude/ arrival must exit 0'
  $healedSkills = Get-Item -LiteralPath (Join-Path $preTarget '.cursor/skills') -Force
  $isHealedLink = [bool]($healedSkills.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or ([string]$healedSkills.LinkType -ne '')
  Assert-True $isHealedLink 'sessionStart must self-heal .cursor/skills ReparsePoint'
  Assert-True (Test-Path -LiteralPath (Join-Path $preTarget '.cursor/rules/cc-base-claude.mdc')) 'sessionStart must self-heal cc-base-claude.mdc'
  Assert-True (Test-Path -LiteralPath (Join-Path $preTarget '.cursor/agents/implementer.md')) 'sessionStart must self-heal generated .cursor/agents/*.md'
  Assert-True ([System.IO.File]::ReadAllText((Join-Path $preTarget '.claude/settings.json')).Contains('node .claude/hooks/session-rules-banner.mjs')) 'sessionStart must convert .claude/settings.json to string form'
  Step-Pass 'Tier 3 -NoAutoCc install and sessionStart automatic link, rules, agents, and string-form self-healing passed'

  # 9. Uninstall detaches OS links, strips only framework entries, and leaves .claude/ 100% byte-for-byte untouched
  $rUn = Invoke-PsScript $SetupPs1 @('-Uninstall', '-Target', $projTarget, '-Force', '-Json')
  Assert-True ($rUn.ExitCode -eq 0) ("setup.ps1 -Uninstall -Force failed: " + $rUn.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projTarget '.cursor/skills'))) '.cursor/skills link must be detached on uninstall'
  Assert-True ([System.IO.File]::ReadAllText($hooksFile).Contains('custom-stop.mjs')) 'Uninstall must keep user custom hooks in hooks.json'
  Assert-True ([System.IO.File]::ReadAllText($cliFile).Contains('team-private.secret')) 'Uninstall must keep user custom rules in cli.json'

  $snapClaudeAfterUn = Get-TreeHashSnapshot (Join-Path $projTarget '.claude')
  Assert-SnapshotsEqual $snapClaudeAfterInst1 $snapClaudeAfterUn '.claude/ tree after -Uninstall -Force'
  Step-Pass 'setup.ps1 -Uninstall -Force detached OS links while preserving .claude/ byte-for-byte'

  Write-Host ("1..{0} ALL PASSED" -f $PassCount)
  exit 0
}
finally {
  if (Test-Path -LiteralPath $TmpBase) {
    Remove-Item -LiteralPath $TmpBase -Recurse -Force -ErrorAction SilentlyContinue
  }
}
