$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$CloudflaredVersion = "2026.9.1"
$CloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/download/2026.9.1/cloudflared-windows-amd64.exe"
$CloudflaredSha256 = "2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712"

$RemoteTools = Join-Path $Root "tools\remote"
$Cloudflared = Join-Path $RemoteTools "cloudflared.exe"
$StdoutLog = Join-Path $RemoteTools "cloudflared.stdout.log"
$StderrLog = Join-Path $RemoteTools "cloudflared.stderr.log"

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "========================================"
    Write-Host " $Text"
    Write-Host "========================================"
    Write-Host ""
}

function Test-VttHealth {
    try {
        $response = Invoke-RestMethod `
            -Uri "http://localhost:3000/api/health" `
            -Method Get `
            -TimeoutSec 2

        return $response.ok -eq $true
    }
    catch {
        return $false
    }
}

Write-Section "D&D WEB VTT REMOTE PLAY"

if (-not (Test-Path $RemoteTools)) {
    New-Item -ItemType Directory -Path $RemoteTools -Force | Out-Null
}

if (-not (Test-Path $Cloudflared)) {
    Write-Host "Downloading Cloudflare Tunnel $CloudflaredVersion..."
    Write-Host "This is a one-time download."

    $ProgressPreference = "SilentlyContinue"

    Invoke-WebRequest `
        -Uri $CloudflaredUrl `
        -OutFile $Cloudflared

    Write-Host "Verifying SHA256..."

    $actualHash = (
        Get-FileHash `
            -LiteralPath $Cloudflared `
            -Algorithm SHA256
    ).Hash.ToLowerInvariant()

    if ($actualHash -ne $CloudflaredSha256) {
        Remove-Item $Cloudflared -Force -ErrorAction SilentlyContinue
        throw ("cloudflared SHA256 verification failed. Expected: " + $CloudflaredSha256 + " Actual: " + $actualHash + ". The downloaded file was deleted.")
    }

    Write-Host "cloudflared verified successfully."
}
else {
    Write-Host "cloudflared already exists."
}

if (-not (Test-VttHealth)) {
    Write-Host ""
    Write-Host "The VTT server is not running. Starting it in a new window..."

    $serverCommand = 'Set-Location "' + $Root.Replace('"', '""') + '"; npm.cmd run server'

    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @(
            "-NoExit",
            "-NoProfile",
            "-Command",
            $serverCommand
        ) | Out-Null

    $deadline = (Get-Date).AddSeconds(30)

    while (
        -not (Test-VttHealth) -and
        (Get-Date) -lt $deadline
    ) {
        Start-Sleep -Milliseconds 500
    }
}

if (-not (Test-VttHealth)) {
    throw "The VTT server did not become available at http://localhost:3000 within 30 seconds."
}

Write-Host ""
Write-Host "VTT server: OK"
Write-Host "DM stays on: http://localhost:3000"

Remove-Item $StdoutLog -Force -ErrorAction SilentlyContinue
Remove-Item $StderrLog -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Starting secure outbound tunnel..."
Write-Host "No router port-forwarding is required."

$tunnel = Start-Process `
    -FilePath $Cloudflared `
    -ArgumentList @(
        "tunnel",
        "--no-autoupdate",
        "--url",
        "http://localhost:3000"
    ) `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru `
    -WindowStyle Hidden

$publicUrl = $null
$deadline = (Get-Date).AddSeconds(35)

while (
    -not $publicUrl -and
    -not $tunnel.HasExited -and
    (Get-Date) -lt $deadline
) {
    Start-Sleep -Milliseconds 300

    $combined = ""

    if (Test-Path $StdoutLog) {
        $combined += [Environment]::NewLine + (Get-Content $StdoutLog -Raw -ErrorAction SilentlyContinue)
    }

    if (Test-Path $StderrLog) {
        $combined += [Environment]::NewLine + (Get-Content $StderrLog -Raw -ErrorAction SilentlyContinue)
    }

    $match = [regex]::Match(
        $combined,
        'https://[a-z0-9-]+\.trycloudflare\.com',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    if ($match.Success) {
        $publicUrl = $match.Value
    }
}

if (-not $publicUrl) {
    if (-not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "cloudflared output:"
    if (Test-Path $StderrLog) {
        Get-Content $StderrLog -ErrorAction SilentlyContinue
    }

    throw "The public tunnel URL could not be detected."
}

Write-Section "REMOTE PLAYER URL READY"

Write-Host $publicUrl
Write-Host ""
Write-Host "Send ONLY this HTTPS URL plus the campaign Join Code to remote players."
Write-Host ""
Write-Host "DM must continue using:"
Write-Host "http://localhost:3000"
Write-Host ""
Write-Host "Remote players open the HTTPS URL in Chrome."
Write-Host "They should be identified as PLAYER, not DM."
Write-Host ""
Write-Host "IMPORTANT:"
Write-Host "- The public URL changes each time this Quick Tunnel restarts."
Write-Host "- Keep this window open while remote players are connected."
Write-Host "- Press Ctrl+C here to close remote access."
Write-Host ""

try {
    while (-not $tunnel.HasExited) {
        Start-Sleep -Seconds 1
    }
}
finally {
    if (-not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }
}
