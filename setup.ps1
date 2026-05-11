#Requires -Version 5.1
<#
.SYNOPSIS
    MCS Agent Builder - Single entry point.
    First run: installs all dependencies via winget/npm/pip, then launches.
    Daily use: detects tools already present, skips straight to launch (~1 sec).
    Safe to re-run anytime. Use --full to force dependency checks.

.NOTES
    Run via start.cmd (double-click) or: powershell -ExecutionPolicy Bypass -File setup.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$script:ExitCode = 0
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step  { param([string]$msg) Write-Host "  [setup] " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Ok    { param([string]$msg) Write-Host "  [  ok ] " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn  { param([string]$msg) Write-Host "  [ warn] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err   { param([string]$msg) Write-Host "  [error] " -ForegroundColor Red -NoNewline; Write-Host $msg }

function Test-Cmd {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

function Stop-PortConflicts {
    param([int[]]$Ports = @(8000, 8001))
    $killedPids = @{}
    foreach ($port in $Ports) {
        try {
            # Match ANY connection state (LISTENING, TIME_WAIT, CLOSE_WAIT, etc.)
            $lines = netstat -ano -p TCP 2>$null | Where-Object { $_ -match "[:.]$port\s" }
            foreach ($line in $lines) {
                $pid = ($line.Trim() -split '\s+')[-1]
                if ($pid -and $pid -match '^\d+$' -and $pid -ne '0' -and -not $killedPids.ContainsKey($pid)) {
                    try {
                        Stop-Process -Id ([int]$pid) -Force -ErrorAction Stop
                        Write-Step "Killed process on port $port (pid $pid)"
                        $killedPids[$pid] = $true
                    } catch {
                        # Process may have already exited
                    }
                }
            }
        } catch {
            # netstat failed — not critical
        }
    }
    if ($killedPids.Count -gt 0) {
        Start-Sleep -Seconds 2
    }
}

function Install-Winget {
    param(
        [string]$PackageId,
        [string]$DisplayName,
        [switch]$Optional
    )

    Write-Step "Checking $DisplayName..."

    if (-not (Test-Cmd 'winget')) {
        if ($Optional) {
            Write-Warn "winget not available - skipping $DisplayName (optional)"
            return
        }
        Write-Err "winget not available - cannot install $DisplayName"
        Write-Err "Install winget from the Microsoft Store (App Installer) and re-run start.cmd"
        $script:ExitCode = 1
        return
    }

    $listOutput = & winget list --id $PackageId --accept-source-agreements 2>&1 | Out-String
    if ($listOutput -match [regex]::Escape($PackageId)) {
        Write-Step "  $DisplayName found - checking for updates..."
        $upgradeOutput = & winget upgrade --id $PackageId --accept-package-agreements --accept-source-agreements 2>&1 | Out-String
        if ($upgradeOutput -match 'No applicable update found' -or $upgradeOutput -match 'No installed package found') {
            Write-Ok "$DisplayName is up to date"
        } elseif ($LASTEXITCODE -eq 0) {
            Refresh-Path
            Write-Ok "$DisplayName updated"
        } else {
            Write-Warn "$DisplayName upgrade returned non-zero - may already be current"
        }
    } else {
        Write-Step "  Installing $DisplayName..."
        $installArgs = @('install', '--id', $PackageId, '--accept-package-agreements', '--accept-source-agreements')

        $machineOnly = @('Microsoft.DotNet.SDK.8', 'Microsoft.DotNet.SDK.10')
        if ($PackageId -notin $machineOnly) {
            $installArgs += '--scope'
            $installArgs += 'user'
        }

        & winget @installArgs 2>&1 | Out-String | Write-Host
        if ($LASTEXITCODE -ne 0) {
            if ($Optional) {
                Write-Warn "Could not install $DisplayName (optional) - continuing"
                return
            }
            Write-Err "Failed to install $DisplayName"
            $script:ExitCode = 1
            return
        }
        Refresh-Path
        Write-Ok "$DisplayName installed"
    }
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  MCS Agent Builder" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Agent Teams: ensure env var is set (user-level, persists across sessions)
# ---------------------------------------------------------------------------

$agentTeamsVar = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
$currentVal = [Environment]::GetEnvironmentVariable($agentTeamsVar, 'User')
if ($currentVal -ne '1') {
    [Environment]::SetEnvironmentVariable($agentTeamsVar, '1', 'User')
    $env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    Write-Ok "Agent Teams enabled ($agentTeamsVar=1)"
}

# ---------------------------------------------------------------------------
# Auto-update: pull latest from remote before anything else
# ---------------------------------------------------------------------------

if (Test-Cmd 'git') {
    $gitDir = Join-Path $scriptDir '.git'
    if (Test-Path $gitDir) {
        Write-Step "Checking for updates..."
        try {
            & git -C $scriptDir fetch --quiet 2>$null
            $behind = (& git -C $scriptDir rev-list --count 'HEAD..@{upstream}' 2>$null | Out-String).Trim()
            if ($behind -and $behind -ne '0') {
                $headBefore = (& git -C $scriptDir rev-parse HEAD 2>$null | Out-String).Trim()

                # Stash local changes so pull can proceed
                $dirty = (& git -C $scriptDir status --porcelain 2>$null | Out-String).Trim()
                $stashed = $false
                if ($dirty) {
                    & git -C $scriptDir stash push --quiet -m 'auto-stash before update' 2>$null
                    $stashed = $LASTEXITCODE -eq 0
                    if ($stashed) { Write-Step "Stashed local changes" }
                }

                Write-Step "$behind new commit(s) - updating..."
                & git -C $scriptDir pull --ff-only --quiet 2>$null

                if ($stashed) {
                    & git -C $scriptDir stash pop --quiet 2>$null
                    if ($LASTEXITCODE -ne 0) {
                        Write-Warn "Could not restore local changes - run 'git stash pop' manually"
                    } else {
                        Write-Step "Restored local changes"
                    }
                }

                Write-Ok "Updated to latest version"

                # Trigger frontend rebuild if frontend files changed
                try {
                    $changed = & git -C $scriptDir diff --name-only $headBefore HEAD 2>$null | Out-String
                    if ($changed -match 'app/frontend/') {
                        $distIdx = Join-Path $scriptDir 'app\dist\index.html'
                        if (Test-Path $distIdx) { Remove-Item $distIdx -Force }
                        Write-Step "Frontend changes detected - will rebuild"
                    }
                } catch { }
            } else {
                Write-Ok "Already up to date"
            }
        } catch {
            Write-Warn "Could not reach remote - starting with current version"
        }
    }
}

# ---------------------------------------------------------------------------
# Fast path: if all core tools exist, skip straight to npm start
# ---------------------------------------------------------------------------

$forceFullSetup = $args -contains '--full'

if (-not $forceFullSetup) {
    $hasNode   = Test-Cmd 'node'
    $hasPython = Test-Cmd 'python'
    $hasGit    = Test-Cmd 'git'

    # Check Node.js version — 18+ required
    $nodeOk = $false
    $nodeVer = ''
    if ($hasNode) {
        try {
            $nodeVer = (& node -e "console.log(process.versions.node)" 2>$null | Out-String).Trim()
            $nodeMajor = [int]($nodeVer -split '\.')[0]
            if ($nodeMajor -ge 18) { $nodeOk = $true }
        } catch { }
    }

    # Check Python version — 3.10+ needed for modern type hints
    $pythonOk = $false
    $pyVer = ''
    if ($hasPython) {
        try {
            $pyVer = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null | Out-String).Trim()
            if ($pyVer -and [version]$pyVer -ge [version]'3.10') {
                $pythonOk = $true
            }
        } catch { }
    }

    if ($hasNode -and $hasPython -and $hasGit) {
        # Collect version issues
        $versionIssues = @()
        if (-not $nodeOk -and $nodeVer) { $versionIssues += "Node.js $nodeVer (need 18+)" }
        if (-not $pythonOk -and $pyVer) { $versionIssues += "Python $pyVer (need 3.10+)" }

        if ($versionIssues.Count -gt 0) {
            # Versions too old — fall through to full setup to upgrade
            Write-Warn "Outdated: $($versionIssues -join ', ') - running setup to upgrade..."
            Write-Host ""
        } else {
            # All good — versions OK or couldn't detect
            $verParts = @()
            if ($nodeVer) { $verParts += "Node $nodeVer" }
            if ($pyVer)   { $verParts += "Python $pyVer" }
            $verInfo = if ($verParts.Count -gt 0) { " ($($verParts -join ', '))" } else { "" }
            Write-Ok "All tools present$verInfo - launching..."
            Write-Host ""
            Stop-PortConflicts
            Push-Location $scriptDir
            try {
                & npm start
            } finally {
                Pop-Location
            }
            exit $LASTEXITCODE
        }
    } else {
        # Something missing - fall through to full setup
        $missingList = @()
        if (-not $hasNode)   { $missingList += 'Node.js' }
        if (-not $hasPython) { $missingList += 'Python' }
        if (-not $hasGit)    { $missingList += 'Git' }
        Write-Step "Missing: $($missingList -join ', ') - running first-time setup..."
        Write-Host ""
    }
}

# ---------------------------------------------------------------------------
# Full setup: install everything
# ---------------------------------------------------------------------------

Write-Host "  Phase 1: Core tools" -ForegroundColor Cyan
Write-Host "  -------------------"

Install-Winget -PackageId 'Git.Git'            -DisplayName 'Git'
Install-Winget -PackageId 'OpenJS.NodeJS.LTS'  -DisplayName 'Node.js LTS'
Install-Winget -PackageId 'Python.Python.3.12' -DisplayName 'Python 3.12'

Refresh-Path

# Verify critical tools are now available
$criticalMissing = @()
if (-not (Test-Cmd 'node'))   { $criticalMissing += 'Node.js' }
if (-not (Test-Cmd 'python')) { $criticalMissing += 'Python' }
if (-not (Test-Cmd 'git'))    { $criticalMissing += 'Git' }

if ($criticalMissing.Count -gt 0) {
    Write-Err "Still missing after install: $($criticalMissing -join ', ')"
    Write-Err "Close this terminal, re-open, and run start.cmd again."
    Read-Host "Press Enter to exit"
    exit 1
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  Phase 2: Claude Code" -ForegroundColor Cyan
Write-Host "  --------------------"

Write-Step "Checking Claude Code..."
$claudeInstalled = $false

$claudeCliDir = Join-Path $env:USERPROFILE '.claude-cli'
if (Test-Path $claudeCliDir) {
    $versions = Get-ChildItem $claudeCliDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name
    if ($versions) {
        $latest = $versions[-1]
        if (Test-Path (Join-Path $latest.FullName 'claude.exe')) {
            $claudeInstalled = $true
            Write-Ok "Claude Code found (native: $($latest.Name))"
        }
    }
}

if (-not $claudeInstalled) {
    $npmCli = Join-Path $env:USERPROFILE 'AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js'
    if (Test-Path $npmCli) {
        $claudeInstalled = $true
        Write-Ok "Claude Code found (npm global)"
    }
}

if (-not $claudeInstalled -and (Test-Cmd 'claude')) {
    $claudeInstalled = $true
    Write-Ok "Claude Code found (PATH)"
}

if (-not $claudeInstalled) {
    Write-Step "Installing Claude Code via npm..."
    & npm install -g @anthropic-ai/claude-code 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -eq 0) {
        Refresh-Path
        Write-Ok "Claude Code installed"
    } else {
        Write-Warn "Claude Code install failed - dashboard works but embedded terminal will not."
        Write-Warn "Install manually later: npm install -g @anthropic-ai/claude-code"
    }
} else {
    Write-Step "Checking for Claude Code updates..."
    & npm update -g @anthropic-ai/claude-code 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Claude Code is up to date"
    }
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  Phase 3: Python packages" -ForegroundColor Cyan
Write-Host "  ------------------------"

Write-Step "Checking Python packages..."
$pipPackages = 'fastapi', 'uvicorn', 'multipart', 'markitdown'
$missing = @()
foreach ($pkg in $pipPackages) {
    try {
        & python -c "import $pkg" 2>$null
        if ($LASTEXITCODE -ne 0) { $missing += $pkg }
    } catch {
        $missing += $pkg
    }
}

if ($missing.Count -eq 0) {
    Write-Ok "All Python packages present"
} else {
    Write-Step "Installing Python packages..."
    & pip install fastapi uvicorn python-multipart "markitdown[all]" 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Python packages installed"
    } else {
        Write-Err "pip install failed. Run manually: pip install fastapi uvicorn python-multipart `"markitdown[all]`""
        $script:ExitCode = 1
    }
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  Phase 4: Optional tools" -ForegroundColor Cyan
Write-Host "  -----------------------"

Install-Winget -PackageId 'Microsoft.PowerShell'    -DisplayName 'PowerShell 7'
Install-Winget -PackageId 'Microsoft.AzureCLI'     -DisplayName 'Azure CLI'     -Optional
Install-Winget -PackageId 'Microsoft.DotNet.SDK.8'  -DisplayName '.NET SDK 8'    -Optional
Install-Winget -PackageId 'Microsoft.DotNet.SDK.10' -DisplayName '.NET SDK 10'   -Optional

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:ExitCode -ne 0) {
    Write-Err "Setup completed with errors - check messages above."
    Read-Host "Press Enter to exit"
    exit $script:ExitCode
}

Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Step "Launching..."
Write-Host ""

Stop-PortConflicts
Push-Location $scriptDir
try {
    & npm start
} finally {
    Pop-Location
}
