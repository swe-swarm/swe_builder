#Requires -Version 5.1
<#
.SYNOPSIS
    Auto-update om-cli binary from the ObjectModel source repo.
    Pulls latest, rebuilds, and stages changes when a source repo is configured.

.DESCRIPTION
    Called automatically by the pre-push git hook, or run manually:
      powershell -ExecutionPolicy Bypass -File tools/update-om-cli.ps1

    First run clones the ObjectModel repo. Subsequent runs pull latest.
    Only rebuilds if the source has changed since the last build.

.NOTES
    Requires: .NET 10 SDK and OM_SOURCE_REPO_URL pointing to an accessible ObjectModel source repo.
#>

param(
    [switch]$Force,        # Rebuild even if no source changes
    [switch]$SkipStage,    # Don't git-add the result
    [string]$SourceRepoUrl = $env:OM_SOURCE_REPO_URL
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$omSourceDir = Join-Path (Split-Path -Parent $repoRoot) 'ObjectModel'
$omCliOutput = Join-Path $repoRoot 'tools\om-cli'
$hashFile = Join-Path $omCliOutput '.source-hash'
$omRepoUrl = $SourceRepoUrl
$cliProject = 'src\Cli\ObjectModel.Cli\ObjectModel.Cli.csproj'

function Write-Status($msg) { Write-Host "  [om-cli] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)     { Write-Host "  [om-cli] $msg" -ForegroundColor Green }
function Write-Warn($msg)   { Write-Host "  [om-cli] $msg" -ForegroundColor Yellow }

if (-not $omRepoUrl) {
    Write-Warn "OM_SOURCE_REPO_URL is not set; skipping om-cli update."
    exit 0
}

# ---------------------------------------------------------------------------
# Step 1: Clone ObjectModel from ADO (first run only)
# ---------------------------------------------------------------------------

if (-not (Test-Path (Join-Path $omSourceDir '.git'))) {
    Write-Status "Cloning ObjectModel from $omRepoUrl..."
    try {
        # Clean up any partial/empty directory from a previous failed attempt
        if (Test-Path $omSourceDir) { Remove-Item $omSourceDir -Recurse -Force }
        git clone $omRepoUrl $omSourceDir 2>&1 | Out-String | Write-Host
        if ($LASTEXITCODE -ne 0) { throw "Clone failed" }
        Write-Ok "Cloned ObjectModel to $omSourceDir"
    } catch {
        Write-Warn "Could not clone ObjectModel. Need git access to:"
        Write-Warn "  $omRepoUrl"
        Write-Warn "om-cli binary in repo is still usable (just not updated)."
        exit 0
    }
}

# ---------------------------------------------------------------------------
# Step 2: Pull latest from ADO
# ---------------------------------------------------------------------------

Write-Status "Pulling latest ObjectModel..."
Push-Location $omSourceDir
try {
    git fetch --quiet 2>$null
    $behind = (git rev-list --count 'HEAD..@{upstream}' 2>$null | Out-String).Trim()
    if ($behind -and $behind -ne '0') {
        git pull --ff-only --quiet 2>&1 | Out-String | Write-Host
        Write-Ok "Pulled $behind new commit(s)"
    } else {
        Write-Status "ObjectModel already up to date"
    }
} catch {
    Write-Warn "Could not pull - using existing local copy"
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# Step 3: Check if rebuild needed
# ---------------------------------------------------------------------------

# Get current source commit hash
$currentHash = ''
try {
    Push-Location $omSourceDir
    $currentHash = (git rev-parse HEAD 2>$null | Out-String).Trim()
} catch { }
finally { Pop-Location }

if (-not $currentHash) {
    Write-Warn "Could not determine ObjectModel commit hash. Skipping."
    exit 0
}

$lastHash = ''
if (Test-Path $hashFile) {
    $lastHash = (Get-Content $hashFile -Raw).Trim()
}

if (-not $Force -and $currentHash -eq $lastHash -and $lastHash -ne '') {
    Write-Ok "om-cli is current (source: $($currentHash.Substring(0, [Math]::Min(12, $currentHash.Length))))"
    exit 0
}

$lastShort = if ($lastHash.Length -ge 8) { $lastHash.Substring(0,8) } else { $lastHash }
$currShort = if ($currentHash.Length -ge 8) { $currentHash.Substring(0,8) } else { $currentHash }
if ($lastShort) {
    Write-Status "Source changed ($lastShort -> $currShort) - rebuilding..."
} else {
    Write-Status "First build from source ($currShort) - building..."
}

# ---------------------------------------------------------------------------
# Step 4: Build
# ---------------------------------------------------------------------------

$projectPath = Join-Path $omSourceDir $cliProject
if (-not (Test-Path $projectPath)) {
    Write-Warn "CLI project not found at $projectPath"
    Write-Warn "ObjectModel repo structure may have changed. Skipping rebuild."
    exit 0
}

Write-Status "Publishing om-cli..."
try {
    dotnet publish $projectPath `
        --configuration Release `
        --no-self-contained `
        --runtime win-x64 `
        -p:DebugSymbols=false `
        -p:DebugType=None `
        -p:SatelliteResourceLanguages=en `
        --output $omCliOutput 2>&1 | Out-String | Write-Host

    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
} catch {
    Write-Warn "Build failed - om-cli binary in repo is still the previous version."
    exit 0
}

# ---------------------------------------------------------------------------
# Step 4b: Clean up non-essential publish output
# ---------------------------------------------------------------------------

# Remove satellite resource DLLs (locale folders like ar-SA, cs-CZ, etc.)
# These are translation files for error messages — English is built into the main DLLs
$localeDirs = Get-ChildItem $omCliOutput -Directory | Where-Object {
    $_.Name -match '^[a-z]{2}-[A-Z]{2}$' -and $_.Name -ne 'en-US'
}
if ($localeDirs) {
    $localeDirs | Remove-Item -Recurse -Force
    Write-Status "Removed $($localeDirs.Count) unnecessary locale folders"
}

# Preserve: README.md, .source-hash (our files, not from publish)
# Preserve: schemas/ (essential for validation)
# Preserve: all DLLs + exe (essential runtime)
# Preserve: *.xml (type documentation used by CLI)

# Write source hash for next comparison
$currentHash | Out-File -FilePath $hashFile -NoNewline -Encoding ascii
Write-Ok "om-cli rebuilt from $($currentHash.Substring(0,8))"

# ---------------------------------------------------------------------------
# Step 5: Stage changes (unless --SkipStage)
# ---------------------------------------------------------------------------

if (-not $SkipStage) {
    Push-Location $repoRoot
    $changes = (git diff --name-only -- tools/om-cli/ 2>$null | Out-String).Trim()
    $untracked = (git ls-files --others --exclude-standard -- tools/om-cli/ 2>$null | Out-String).Trim()

    if ($changes -or $untracked) {
        git add tools/om-cli/ 2>$null
        Write-Ok "Staged om-cli changes (commit with your next push)"
    } else {
        Write-Ok "No binary changes after rebuild"
    }
    Pop-Location
}
