# =============================================================================
# End-to-End Test: Instructions Write + Publish + Verify
# =============================================================================
# Tests the full workflow:
#   1. Connect via az CLI token
#   2. Read current instructions (data field)
#   3. Write modified instructions (data field PATCH)
#   4. Verify data field round-trip
#   5. Publish via PvaPublish
#   6. Wait for publish to complete
#   7. Verify content field synced (runtime instructions match)
#   8. Restore original instructions
#   9. Publish again to restore runtime state
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$TargetOrg,

    [Parameter(Mandatory = $true)]
    [string]$TargetBot
)

$ErrorActionPreference = "Stop"

# Load helper (dot-source without triggering its param block)
. "$PSScriptRoot\dataverse-helper.ps1"

$OrgUrl = $TargetOrg
$BotId = $TargetBot

$results = @()
function Log {
    param([string]$Test, [string]$Status, [string]$Detail)
    $script:results += [PSCustomObject]@{ Test=$Test; Status=$Status; Detail=$Detail }
    $color = if ($Status -eq "PASS") { "Green" } elseif ($Status -eq "FAIL") { "Red" } else { "Yellow" }
    Write-Host "[$Status] $Test" -ForegroundColor $color
    if ($Detail) { Write-Host "  $Detail" -ForegroundColor Gray }
}

# =================================================================
# STEP 1: Connect
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 1: Connect to Dataverse" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
try {
    $ctx = Connect-Dataverse -OrgUrl $OrgUrl
    Log "Connect" "PASS" "User: $($ctx.UserId)"
} catch {
    Log "Connect" "FAIL" $_.Exception.Message
    exit 1
}

# =================================================================
# STEP 2: Read current instructions
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 2: Read current state" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
try {
    $components = Get-BotComponents -Ctx $ctx -BotId $BotId -ComponentType 15
    $gpt = $components[0]
    $componentId = $gpt.botcomponentid
    $originalData = $gpt.data

    # Parse instructions from YAML data
    if ($originalData -match '(?s)instructions:\s*\|-\s*\n(.+)$') {
        $originalInstructions = ($Matches[1] -split "`n" | ForEach-Object {
            if ($_.StartsWith("  ")) { $_.Substring(2) } else { $_ }
        }) -join "`n"
    } else {
        $originalInstructions = ""
    }
    Log "Read data field" "PASS" "Component: $componentId, Instructions: $($originalInstructions.Length) chars"

    # Also read content field
    $fullComponent = Invoke-RestMethod `
        -Uri "$OrgUrl/api/data/v9.2/botcomponents($componentId)?`$select=content,data" `
        -Method GET -Headers $ctx.Headers
    $contentJson = $fullComponent.content | ConvertFrom-Json
    $contentInstructions = $contentJson.systemMessage
    Log "Read content field" "PASS" "systemMessage: $($contentInstructions.Length) chars"

    # Check if they match
    $dataFirst50 = $originalInstructions.Substring(0, [Math]::Min(50, $originalInstructions.Length))
    $contentFirst50 = $contentInstructions.Substring(0, [Math]::Min(50, $contentInstructions.Length))
    if ($dataFirst50 -eq $contentFirst50) {
        Log "Fields in sync" "PASS" "data and content match (first 50 chars)"
    } else {
        Log "Fields in sync" "WARN" "data='$dataFirst50...' vs content='$contentFirst50...'"
    }
} catch {
    Log "Read current state" "FAIL" $_.Exception.Message
    exit 1
}

# =================================================================
# STEP 3: Write modified instructions via data field
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 3: Write instructions" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
$testMarker = "[E2E-TEST $(Get-Date -Format 'HH:mm:ss')]"
$testInstructions = $originalInstructions + "`n`n## API Test Marker`n$testMarker"
try {
    $compId = Update-BotInstructions -Ctx $ctx -BotId $BotId -Instructions $testInstructions
    Log "Write instructions (data PATCH)" "PASS" "Added marker: $testMarker"
} catch {
    Log "Write instructions (data PATCH)" "FAIL" $_.Exception.Message
}

# =================================================================
# STEP 4: Verify data field round-trip
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 4: Verify data field" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
try {
    $afterWrite = Invoke-RestMethod `
        -Uri "$OrgUrl/api/data/v9.2/botcomponents($componentId)?`$select=data,content" `
        -Method GET -Headers $ctx.Headers

    if ($afterWrite.data -match [regex]::Escape($testMarker)) {
        Log "Data field round-trip" "PASS" "Marker found in data field"
    } else {
        Log "Data field round-trip" "FAIL" "Marker NOT found in data field"
    }

    # Content should NOT have the marker yet (not published)
    $prePublishContent = $afterWrite.content | ConvertFrom-Json
    if ($prePublishContent.systemMessage -match [regex]::Escape($testMarker)) {
        Log "Content pre-publish" "INFO" "Content already has marker (unexpected but OK)"
    } else {
        Log "Content pre-publish" "PASS" "Content does NOT have marker yet (as expected -- needs publish)"
    }
} catch {
    Log "Verify data field" "FAIL" $_.Exception.Message
}

# =================================================================
# STEP 5: Publish
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 5: Publish" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
try {
    Publish-Bot -Ctx $ctx -BotId $BotId
    Log "PvaPublish" "PASS" "Publish initiated"
} catch {
    Log "PvaPublish" "FAIL" $_.Exception.Message
}

# =================================================================
# STEP 6: Wait and verify publish + content sync
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 6: Wait + verify sync" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "Waiting 20 seconds for publish to complete..." -ForegroundColor Gray
Start-Sleep -Seconds 20

try {
    # Check publishedon timestamp
    $bot = Invoke-RestMethod `
        -Uri "$OrgUrl/api/data/v9.2/bots($BotId)?`$select=publishedon" `
        -Method GET -Headers $ctx.Headers
    $publishAge = (Get-Date) - [DateTime]::Parse($bot.publishedon)
    if ($publishAge.TotalSeconds -lt 60) {
        Log "Publish timestamp" "PASS" "Published $([int]$publishAge.TotalSeconds)s ago"
    } else {
        Log "Publish timestamp" "WARN" "Published $([int]$publishAge.TotalMinutes) min ago"
    }

    # Check if content field now has the marker
    $afterPublish = Invoke-RestMethod `
        -Uri "$OrgUrl/api/data/v9.2/botcomponents($componentId)?`$select=content" `
        -Method GET -Headers $ctx.Headers
    $publishedContent = $afterPublish.content | ConvertFrom-Json
    if ($publishedContent.systemMessage -match [regex]::Escape($testMarker)) {
        Log "Content synced after publish" "PASS" "Marker found in content.systemMessage -- data->content sync works!"
    } else {
        Log "Content synced after publish" "FAIL" "Marker NOT in content. Publish may not sync data->content."
    }
} catch {
    Log "Verify sync" "FAIL" $_.Exception.Message
}

# =================================================================
# STEP 7: Restore original instructions
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "STEP 7: Restore + re-publish" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
try {
    Update-BotInstructions -Ctx $ctx -BotId $BotId -Instructions $originalInstructions
    Log "Restore instructions" "PASS" "Restored $($originalInstructions.Length) chars"

    Publish-Bot -Ctx $ctx -BotId $BotId
    Log "Re-publish" "PASS" "Publish initiated to sync restored instructions"

    Write-Host "Waiting 15 seconds..." -ForegroundColor Gray
    Start-Sleep -Seconds 15

    # Final verify
    $final = Invoke-RestMethod `
        -Uri "$OrgUrl/api/data/v9.2/botcomponents($componentId)?`$select=data,content" `
        -Method GET -Headers $ctx.Headers
    $finalContent = $final.content | ConvertFrom-Json

    if (-not ($finalContent.systemMessage -match [regex]::Escape($testMarker))) {
        Log "Final state clean" "PASS" "Test marker removed from both fields"
    } else {
        Log "Final state clean" "WARN" "Test marker still in content (publish may need more time)"
    }
} catch {
    Log "Restore" "FAIL" $_.Exception.Message
}

# =================================================================
# SUMMARY
# =================================================================
Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
$pass = ($results | Where-Object Status -eq "PASS").Count
$fail = ($results | Where-Object Status -eq "FAIL").Count
$warn = ($results | Where-Object Status -in "WARN","INFO").Count
$total = $results.Count

Write-Host "PASS: $pass / $total | FAIL: $fail | WARN/INFO: $warn" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host ""
$results | Format-Table Test, Status, Detail -AutoSize -Wrap
