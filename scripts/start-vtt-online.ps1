param(
    [int]$Port = 3000,
    [switch]$SkipFunnel
)

$ErrorActionPreference = "Stop"
$Root = "F:\DND WEB VTT"
$Runtime = Join-Path $Root "_runtime"
$PidFile = Join-Path $Runtime "server.pid"
$LogFile = Join-Path $Runtime ("server-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
$ErrFile = Join-Path $Runtime ("server-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".error.log")
$HealthUrl = "http://127.0.0.1:$Port/api/health"

Set-Location $Root
New-Item -ItemType Directory -Path $Runtime -Force | Out-Null

if (-not (Test-Path (Join-Path $Root "node_modules\tsx\dist\cli.mjs"))) {
    throw "Dependencies are missing. Run npm.cmd install first."
}

$DistIndex = Join-Path $Root "dist\index.html"
$NeedsBuild = -not (Test-Path $DistIndex)

if (-not $NeedsBuild) {
    $SourceFiles = @(
        Get-ChildItem (Join-Path $Root "src") -Recurse -File -ErrorAction SilentlyContinue
        Get-ChildItem (Join-Path $Root "public") -Recurse -File -ErrorAction SilentlyContinue
        Get-Item (Join-Path $Root "package.json") -ErrorAction SilentlyContinue
        Get-Item (Join-Path $Root "vite.config.ts") -ErrorAction SilentlyContinue
    ) | Where-Object { $_ }

    $NewestSource = $SourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    $DistItem = Get-Item $DistIndex

    if ($NewestSource -and $NewestSource.LastWriteTimeUtc -gt $DistItem.LastWriteTimeUtc) {
        $NeedsBuild = $true
    }
}

if ($NeedsBuild) {
    Write-Host "Production client is missing or stale. Building..."
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed." }
}

$AlreadyHealthy = $false
try {
    $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    $AlreadyHealthy = ($Health.ok -eq $true)
} catch {}

if (-not $AlreadyHealthy) {
    if (Test-Path $PidFile) {
        $OldPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($OldPid) {
            $OldProcess = Get-Process -Id ([int]$OldPid) -ErrorAction SilentlyContinue
            if ($OldProcess) {
                throw "A VTT server process is already recorded as PID $OldPid, but health check failed. Stop it before starting another copy."
            }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    $Node = (Get-Command node -ErrorAction Stop).Source
    $Tsx = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
    $PreviousPort = $env:PORT
    $env:PORT = [string]$Port

    try {
        # Windows PowerShell joins -ArgumentList items into one command line.
        # The project root contains spaces (F:\DND WEB VTT), so the absolute
        # tsx CLI path must be quoted explicitly before it is passed to node.
        $NodeArguments = '"' + $Tsx + '" "server/server.ts"'

        $Process = Start-Process `
            -FilePath $Node `
            -ArgumentList $NodeArguments `
            -WorkingDirectory $Root `
            -RedirectStandardOutput $LogFile `
            -RedirectStandardError $ErrFile `
            -PassThru `
            -WindowStyle Hidden
    } finally {
        if ($null -eq $PreviousPort) {
            Remove-Item Env:PORT -ErrorAction SilentlyContinue
        } else {
            $env:PORT = $PreviousPort
        }
    }

    Set-Content -Path $PidFile -Value $Process.Id -Encoding ascii

    $Ready = $false
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 250
        try {
            $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
            if ($Health.ok -eq $true) {
                $Ready = $true
                break
            }
        } catch {}

        if ($Process.HasExited) {
            break
        }
    }

    if (-not $Ready) {
        Write-Host ""
        Write-Host "=== SERVER STDOUT ==="
        if (Test-Path $LogFile) { Get-Content $LogFile -Tail 80 }
        Write-Host ""
        Write-Host "=== SERVER STDERR ==="
        if (Test-Path $ErrFile) { Get-Content $ErrFile -Tail 80 }
        throw "VTT server did not become healthy on port $Port."
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host " VTT LOCAL SERVER: HEALTHY"
Write-Host "========================================"
Write-Host "DM: http://localhost:$Port"

try {
    $HostInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/host-info" -TimeoutSec 3
    foreach ($Url in $HostInfo.lanUrls) {
        Write-Host "LAN Player: $Url"
    }
} catch {
    Write-Warning "Could not read LAN host information."
}

if (-not $SkipFunnel) {
    $Tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    if (-not $Tailscale) {
        throw "Tailscale CLI was not found. Local/LAN server is healthy, but public Funnel was not configured."
    }

    Write-Host ""
    Write-Host "Ensuring Tailscale Funnel is enabled in background..."
    & tailscale funnel --bg --yes $Port
    if ($LASTEXITCODE -ne 0) {
        throw "Tailscale Funnel could not be enabled."
    }

    $FunnelStatus = (& tailscale funnel status 2>&1 | Out-String)
    Write-Host $FunnelStatus.Trim()

    $Match = [regex]::Match($FunnelStatus, 'https://[^\s|]+')
    if ($Match.Success) {
        $PublicUrl = $Match.Value.TrimEnd('/')
        Write-Host ""
        Write-Host "PUBLIC PLAYER URL: $PublicUrl"

        try {
            $PublicHealth = Invoke-RestMethod -Uri "$PublicUrl/api/health" -TimeoutSec 10
            if ($PublicHealth.ok -eq $true) {
                Write-Host "Public Funnel health check: PASS"
            }
        } catch {
            Write-Warning "Funnel is configured, but the public health request did not answer yet. Check again with scripts\check-vtt-platform.ps1."
        }
    } else {
        Write-Warning "Funnel is enabled, but its public URL could not be parsed from status output."
    }
}

Write-Host ""
Write-Host "Server log: $LogFile"
Write-Host "Error log:  $ErrFile"
Write-Host "PID file:   $PidFile"
Write-Host "========================================"
