$ErrorActionPreference = "Stop"

function Set-TextVariableIfMissing {
    param([string]$Name, [string]$Prompt, [string]$Default = "")

    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name, "Process"))) {
        return
    }

    $value = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = $Default
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Name is required."
    }
    [Environment]::SetEnvironmentVariable($Name, $value, "Process")
}

function Set-SecretVariableIfMissing {
    param([string]$Name, [string]$Prompt, [int]$MinimumLength = 12)

    $existing = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($existing) -and $existing.Length -ge $MinimumLength) {
        return
    }

    while ($true) {
        $secureValue = Read-Host "$Prompt (right-click to paste)" -AsSecureString
        $value = [System.Net.NetworkCredential]::new("", $secureValue).Password
        if ($value.Length -ge $MinimumLength -and $value -notmatch "[\x00-\x1F]") {
            [Environment]::SetEnvironmentVariable($Name, $value, "Process")
            return
        }
        Write-Warning "$Name was too short or contained a control character. Paste the complete value."
    }
}

function Import-DotEnvFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return
    }

    Write-Host "Loading credentials from $Path"
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) {
            return
        }
        $separatorIndex = $line.IndexOf("=")
        if ($separatorIndex -lt 1) {
            return
        }
        $key = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim().Trim('"')
        if ($value -ne "") {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

$root = Split-Path -Parent $PSScriptRoot
Import-DotEnvFile (Join-Path $root ".env")

Set-TextVariableIfMissing "BOOMI_ACCOUNT_ID" "Boomi account ID"
Set-TextVariableIfMissing "BOOMI_USERNAME" "Boomi login email"
Set-SecretVariableIfMissing "BOOMI_TOKEN" "Boomi API token" 20
Set-SecretVariableIfMissing "GITHUB_TOKEN" "GitHub fine-grained token" 20
Set-TextVariableIfMissing "GITHUB_OWNER" "GitHub owner" "Rajesh10222002"
Set-TextVariableIfMissing "GITHUB_REPO" "GitHub repository" "Boomi-CICD"

if ($env:DASHBOARD_DISABLE_AUTH -eq "true") {
    Write-Warning "DASHBOARD_DISABLE_AUTH is set. Skipping the dashboard login prompt."
} else {
    Set-TextVariableIfMissing "DASHBOARD_USERNAME" "Choose a dashboard username"
    Set-SecretVariableIfMissing "DASHBOARD_PASSWORD" "Choose a dashboard password"
}

Set-Location $root

Write-Host "Checking Boomi API access..."
python scripts/boomi.py check
if ($LASTEXITCODE -ne 0) {
    throw "Boomi API check failed. Confirm the token and API privileges."
}

Write-Host "Checking GitHub API access..."
$githubHeaders = @{
    Authorization = "Bearer $env:GITHUB_TOKEN"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2026-03-10"
}
$workflowUri = "https://api.github.com/repos/$env:GITHUB_OWNER/$env:GITHUB_REPO/actions/workflows/deploy.yml"
try {
    Invoke-RestMethod -Uri $workflowUri -Headers $githubHeaders -Method Get | Out-Null
} catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "network error" }
    throw "GitHub API check failed ($status). Confirm the fine-grained token and repository access."
}

if (-not (Test-Path "dist/index.html")) {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Dashboard build failed."
    }
}

npm start