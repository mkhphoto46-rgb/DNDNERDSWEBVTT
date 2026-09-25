param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Continue"
$Root = "F:\DND WEB VTT"
$HealthUrl = "http://127.0.0.1:$Port/api/health"
$StatusUrl = "http://127.0.0.1:$Port/api/platform/status"

Set-Location $Root

Write-Host "========================================"
Write-Host " D&D WEB VTT PLATFORM STATUS"
Write-Host "========================================"

$LocalHealthy = $false
try {
    $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
    $LocalHealthy = ($Health.ok -eq $true)
    Write-Host "Local server: PASS"
    Write-Host "Uptime: $($Health.uptimeSeconds) sec"
} catch {
    Write-Host "Local server: FAIL"
    Write-Host $_.Exception.Message
}

if ($LocalHealthy) {
    try {
        $Platform = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 5
        Write-Host "Persistence integrity: $(if ($Platform.persistence.ok) { 'PASS' } else { 'FAIL' })"
        Write-Host "Campaign DBs checked: $($Platform.persistence.campaigns.Count)"
    } catch {
        Write-Host "Platform audit endpoint: FAIL"
        Write-Host $_.Exception.Message
    }
}

$Tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if ($Tailscale) {
    Write-Host ""
    Write-Host "--- Tailscale ---"
    & tailscale status
    Write-Host ""
    Write-Host "--- Funnel ---"
    $FunnelStatus = (& tailscale funnel status 2>&1 | Out-String)
    Write-Host $FunnelStatus.Trim()

    $Match = [regex]::Match($FunnelStatus, 'https://[^\s|]+')
    if ($Match.Success) {
        $PublicUrl = $Match.Value.TrimEnd('/')
        Write-Host ""
        Write-Host "Public URL: $PublicUrl"

        try {
            $PublicHealth = Invoke-RestMethod -Uri "$PublicUrl/api/health" -TimeoutSec 10
            Write-Host "Public health: $(if ($PublicHealth.ok) { 'PASS' } else { 'FAIL' })"
        } catch {
            Write-Host "Public health: FAIL"
            Write-Host $_.Exception.Message
        }

        try {
            $AccessInfo = Invoke-RestMethod -Uri "$PublicUrl/api/access-info" -TimeoutSec 10
            if ($AccessInfo.isLocalHost -eq $false -and $AccessInfo.remoteViaProxy -eq $true) {
                Write-Host "Funnel proxy detection: PASS"
            } else {
                Write-Host "Funnel proxy detection: FAIL"
                $AccessInfo | ConvertTo-Json -Compress | Write-Host
            }
        } catch {
            Write-Host "Funnel proxy detection: FAIL"
            Write-Host $_.Exception.Message
        }

        try {
            $Unexpected = Invoke-WebRequest -Uri "$PublicUrl/api/host-info" -UseBasicParsing -TimeoutSec 10
            Write-Host "Remote host-info protection: FAIL (HTTP $($Unexpected.StatusCode))"
        } catch {
            $StatusCode = 0
            try { $StatusCode = [int]$_.Exception.Response.StatusCode } catch {}
            if ($StatusCode -eq 403) {
                Write-Host "Remote host-info protection: PASS"
            } else {
                Write-Host "Remote host-info protection: FAIL"
                Write-Host $_.Exception.Message
            }
        }

        Write-Host ""
        Write-Host "--- Public Funnel Socket Test ---"
        & node "scripts/check-public-funnel.mjs" $PublicUrl
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Public Funnel Socket test: FAIL"
        } else {
            Write-Host "Public Funnel Socket test: PASS"
        }
    } else {
        Write-Host "Public Funnel URL: NOT FOUND"
    }
} else {
    Write-Host "Tailscale CLI: NOT FOUND"
}

Write-Host ""
Write-Host "--- Port $Port ---"
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess

Write-Host "========================================"
