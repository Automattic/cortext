#Requires -Version 5.1
<#
.SYNOPSIS
    Verifies this agent can set up Azure Artifact Signing for Cortext.

    Cortext has no Windows build yet, so there is nothing to sign. This job
    proves the credential path works now, so the NSIS build lands on a queue
    that is already known good instead of debugging both at once.
#>

# PowerShell does not abort on a failed *native* command, only on failed cmdlets.
$ErrorActionPreference = 'Stop'

# setup_azure_trusted_signing.ps1 checks these too, but exits on the first one
# missing — a build per gap. Report them all at once.
$requiredInputs = @(
    'AZURE_TENANT_ID'
    'AZURE_CLIENT_ID'
    'AZURE_CLIENT_SECRET'
    'AZURE_ENDPOINT'
    'AZURE_CODE_SIGNING_ACCOUNT'
    'AZURE_CERTIFICATE_PROFILE'
)

Write-Output "--- :key: Checking Azure Artifact Signing credentials"
$missing = $requiredInputs | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
}
if ($missing) {
    Write-Output "^^^ +++"
    throw "Not set on this agent: $($missing -join ', ')."
}
Write-Output "All $($requiredInputs.Count) credentials are present."

Write-Output "--- :lock: Running setup_azure_trusted_signing.ps1"
# Comes from the a8c-ci-toolkit plugin, which puts its `bin` on PATH.
$setupScript = (Get-Command setup_azure_trusted_signing.ps1 -ErrorAction Stop).Source
& $setupScript
if ($LASTEXITCODE -ne 0) {
    Write-Output "^^^ +++"
    throw "setup_azure_trusted_signing.ps1 failed with exit code ${LASTEXITCODE}."
}

Write-Output "--- :white_check_mark: Checking what the setup exported"
foreach ($name in @('SIGNTOOL_PATH', 'AZURE_CODE_SIGNING_DLIB', 'AZURE_METADATA_JSON')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Output "^^^ +++"
        throw "$name was not exported."
    }
    if (-not (Test-Path -LiteralPath $value)) {
        Write-Output "^^^ +++"
        throw "$name points at a missing path: $value"
    }
    Write-Output "$name = $value"
}

Write-Output "Azure Artifact Signing is ready on this agent."
