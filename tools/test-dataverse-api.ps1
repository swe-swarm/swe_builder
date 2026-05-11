# =============================================================================
# Dataverse API Test Script — Verify MCS Operations Work
# =============================================================================
# Tests: token acquisition, instruction read/write, publish, and verification
# Uses `az account get-access-token` (no Az.Accounts dependency)
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$OrgUrl,

    [Parameter(Mandatory = $true)]
    [string]$BotId
)

$ErrorActionPreference = "Stop"
$results = @()

function Log-Result {
    param([string]$Test, [string]$Status, [string]$Detail)
    $script:results += [PSCustomObject]@{ Test=$Test; Status=$Status; Detail=$Detail }
    $color = if ($Status -eq "PASS") { "Green" } elseif ($Status -eq "FAIL") { "Red" } else { "Yellow" }
    Write-Host "[$Status] $Test" -ForegroundColor $color
    if ($Detail) { Write-Host "  $Detail" -ForegroundColor Gray }
}

# =========================================================
# TEST 1: Token Acquisition via az CLI
# =========================================================
Write-Host "`n=== TEST 1: Token Acquisition ===" -ForegroundColor Cyan
try {
    $tokenJson = az account get-access-token --resource $OrgUrl 2>&1 | Out-String
    $tokenObj = $tokenJson | ConvertFrom-Json
    $token = $tokenObj.accessToken
    if (-not $token) { throw "Token is null" }

    $headers = @{
        'Authorization'    = "Bearer $token"
        'Accept'           = 'application/json'
        'OData-MaxVersion' = '4.0'
        'OData-Version'    = '4.0'
    }

    # Verify with WhoAmI
    $whoAmI = Invoke-RestMethod -Uri "$OrgUrl/api/data/v9.2/WhoAmI" -Method GET -Headers $headers
    Log-Result "Token acquisition (az CLI)" "PASS" "User: $($whoAmI.UserId)"
} catch {
    Log-Result "Token acquisition (az CLI)" "FAIL" $_.Exception.Message
    Write-Host "`nCannot continue without a token. Exiting." -ForegroundColor Red
    exit 1
}

# =========================================================
# TEST 2: Read Bot Entity
# =========================================================
Write-Host "`n=== TEST 2: Read Bot Entity ===" -ForegroundColor Cyan
try {
    $botUrl = "$OrgUrl/api/data/v9.2/bots($BotId)?`$select=name,schemaname,publishedon,statecode"
    $bot = Invoke-RestMethod -Uri $botUrl -Method GET -Headers $headers
    Log-Result "Read bot entity" "PASS" "Name: $($bot.name), Published: $($bot.publishedon)"
} catch {
    Log-Result "Read bot entity" "FAIL" $_.Exception.Message
}

# =========================================================
# TEST 3: Find Custom GPT Component (Instructions)
# =========================================================
Write-Host "`n=== TEST 3: Find Custom GPT Component ===" -ForegroundColor Cyan
$gptComponentId = $null
try {
    # Find all components for this bot where componenttype = 15 (Custom GPT)
    $compUrl = "$OrgUrl/api/data/v9.2/botcomponents?" +
        "`$filter=_parentbotid_value eq $BotId and componenttype eq 15" +
        "&`$select=botcomponentid,name,schemaname,componenttype"
    $compResult = Invoke-RestMethod -Uri $compUrl -Method GET -Headers $headers
    if ($compResult.value.Count -gt 0) {
        $gptComponent = $compResult.value[0]
        $gptComponentId = $gptComponent.botcomponentid
        Log-Result "Find Custom GPT component" "PASS" "ID: $gptComponentId, Name: $($gptComponent.name)"
    } else {
        Log-Result "Find Custom GPT component" "FAIL" "No componenttype=15 found"
    }
} catch {
    Log-Result "Find Custom GPT component" "FAIL" $_.Exception.Message
}

# =========================================================
# TEST 4: Read Instructions Content
# =========================================================
Write-Host "`n=== TEST 4: Read Instructions ===" -ForegroundColor Cyan
$currentInstructions = $null
if ($gptComponentId) {
    try {
        $contentUrl = "$OrgUrl/api/data/v9.2/botcomponents($gptComponentId)?`$select=content"
        $contentResult = Invoke-RestMethod -Uri $contentUrl -Method GET -Headers $headers
        $rawContent = $contentResult.content
        if ($rawContent) {
            $contentObj = $rawContent | ConvertFrom-Json
            $currentInstructions = $contentObj.systemMessage
            Log-Result "Read instructions" "PASS" "Length: $($currentInstructions.Length) chars"
        } else {
            Log-Result "Read instructions" "WARN" "Content field is null (new agent?)"
        }
    } catch {
        Log-Result "Read instructions" "FAIL" $_.Exception.Message
    }
}

# =========================================================
# TEST 5: Write Instructions via PATCH
# =========================================================
Write-Host "`n=== TEST 5: Write Instructions (PATCH) ===" -ForegroundColor Cyan
if ($gptComponentId) {
    try {
        # Add a timestamp marker to prove we're writing new content
        $testMarker = "## API Test Marker: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        $newInstructions = if ($currentInstructions) {
            # Append marker to existing instructions
            $currentInstructions + "`n`n$testMarker"
        } else {
            "Test instructions.`n`n$testMarker"
        }

        # Build content JSON
        $contentObj = @{ systemMessage = $newInstructions }
        $contentStr = $contentObj | ConvertTo-Json -Depth 10 -Compress

        # Build PATCH body — content must be a STRING, not an object
        # Use manual JSON construction to ensure content is a primitive string
        $bodyObj = @{ content = $contentStr }
        $bodyJson = $bodyObj | ConvertTo-Json -Depth 5

        $patchHeaders = $headers.Clone()
        $patchHeaders['Content-Type'] = 'application/json; charset=utf-8'

        $patchUrl = "$OrgUrl/api/data/v9.2/botcomponents($gptComponentId)"
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
        Invoke-RestMethod -Uri $patchUrl -Method Patch -Headers $patchHeaders -Body $bodyBytes

        Log-Result "Write instructions (PATCH)" "PASS" "Wrote $($newInstructions.Length) chars"
    } catch {
        Log-Result "Write instructions (PATCH)" "FAIL" $_.Exception.Message
    }
}

# =========================================================
# TEST 6: Verify Instructions Round-Trip
# =========================================================
Write-Host "`n=== TEST 6: Verify Round-Trip ===" -ForegroundColor Cyan
if ($gptComponentId) {
    try {
        $contentUrl = "$OrgUrl/api/data/v9.2/botcomponents($gptComponentId)?`$select=content"
        $verifyResult = Invoke-RestMethod -Uri $contentUrl -Method GET -Headers $headers
        $verifyContent = $verifyResult.content | ConvertFrom-Json
        $verifyInstructions = $verifyContent.systemMessage

        if ($verifyInstructions -match "API Test Marker") {
            Log-Result "Verify round-trip" "PASS" "Marker found! Length: $($verifyInstructions.Length) chars"
        } else {
            Log-Result "Verify round-trip" "FAIL" "Marker NOT found in read-back"
        }
    } catch {
        Log-Result "Verify round-trip" "FAIL" $_.Exception.Message
    }
}

# =========================================================
# TEST 7: Restore Original Instructions
# =========================================================
Write-Host "`n=== TEST 7: Restore Original Instructions ===" -ForegroundColor Cyan
if ($gptComponentId -and $currentInstructions) {
    try {
        $restoreObj = @{ systemMessage = $currentInstructions }
        $restoreStr = $restoreObj | ConvertTo-Json -Depth 10 -Compress
        $restoreBody = @{ content = $restoreStr } | ConvertTo-Json -Depth 5

        $patchHeaders = $headers.Clone()
        $patchHeaders['Content-Type'] = 'application/json; charset=utf-8'

        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($restoreBody)
        Invoke-RestMethod -Uri "$OrgUrl/api/data/v9.2/botcomponents($gptComponentId)" `
            -Method Patch -Headers $patchHeaders -Body $bodyBytes

        Log-Result "Restore original instructions" "PASS" "Restored $($currentInstructions.Length) chars"
    } catch {
        Log-Result "Restore original instructions" "FAIL" $_.Exception.Message
    }
}

# =========================================================
# TEST 8: Publish via PvaPublish Bound Action
# =========================================================
Write-Host "`n=== TEST 8: Publish (PvaPublish) ===" -ForegroundColor Cyan
try {
    $publishUrl = "$OrgUrl/api/data/v9.2/bots($BotId)/Microsoft.Dynamics.CRM.PvaPublish"
    $patchHeaders = $headers.Clone()
    $patchHeaders['Content-Type'] = 'application/json'

    $publishResponse = Invoke-RestMethod -Uri $publishUrl -Method POST -Headers $patchHeaders -Body '{}'
    Log-Result "Publish (PvaPublish)" "PASS" "Publish initiated"
} catch {
    Log-Result "Publish (PvaPublish)" "FAIL" $_.Exception.Message
}

# =========================================================
# TEST 9: Verify Publish Status (wait + check)
# =========================================================
Write-Host "`n=== TEST 9: Verify Publish ===" -ForegroundColor Cyan
try {
    Write-Host "  Waiting 10 seconds for publish to complete..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
    $botUrl = "$OrgUrl/api/data/v9.2/bots($BotId)?`$select=publishedon"
    $botAfter = Invoke-RestMethod -Uri $botUrl -Method GET -Headers $headers
    $publishedOn = $botAfter.publishedon
    if ($publishedOn) {
        $publishDate = [DateTime]::Parse($publishedOn)
        $age = (Get-Date) - $publishDate
        if ($age.TotalMinutes -lt 5) {
            Log-Result "Verify publish" "PASS" "Published: $publishedOn ($([int]$age.TotalSeconds)s ago)"
        } else {
            Log-Result "Verify publish" "WARN" "Published: $publishedOn ($([int]$age.TotalMinutes) min ago -- may be stale)"
        }
    } else {
        Log-Result "Verify publish" "FAIL" "publishedon is null"
    }
} catch {
    Log-Result "Verify publish" "FAIL" $_.Exception.Message
}

# =========================================================
# SUMMARY
# =========================================================
Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$pass = ($results | Where-Object Status -eq "PASS").Count
$fail = ($results | Where-Object Status -eq "FAIL").Count
$warn = ($results | Where-Object Status -eq "WARN").Count
Write-Host "PASS: $pass | FAIL: $fail | WARN: $warn" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })

Write-Host "`nDetailed results:" -ForegroundColor Gray
$results | Format-Table Test, Status, Detail -AutoSize -Wrap
