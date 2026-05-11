# =============================================================================
# Fetch agent instructions from Dataverse
# Uses Az PowerShell for token acquisition (replaces broken pac auth create-token)
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$OrgUrl,

    [Parameter(Mandatory = $true)]
    [string]$BotId
)

# Load the helper module
. "$PSScriptRoot\dataverse-helper.ps1"

# Connect
$ctx = Connect-Dataverse -OrgUrl $OrgUrl

# Fetch instructions (componenttype 15 = Custom GPT)
$components = Get-BotComponents -Ctx $ctx -BotId $BotId -ComponentType 15
Write-Output "Count: $($components.Count)"

foreach ($c in $components) {
    Write-Output "ID: $($c.botcomponentid)"
    Write-Output "Name: $($c.name)"
    Write-Output "Content length: $($c.content.Length)"
    Write-Output "---CONTENT START---"
    Write-Output $c.content
    Write-Output "---CONTENT END---"
}
