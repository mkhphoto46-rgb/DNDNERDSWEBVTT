param(
    [int]$Port = 3000,
    [switch]$DisableFunnel
)

$ErrorActionPreference = "Continue"
$Root = "F:\DND WEB VTT"
$PidFile = Join-Path $Root "_runtime\server.pid"
$ShutdownUrl = "http://127.0.0.1:$Port/api/platform/shutdown"

Set-Location $Root

$RequestedGracefulShutdown = $false
try {
    $Response = Invoke-RestMethod -Method Post -Uri $ShutdownUrl -TimeoutSec 3
    $RequestedGracefulShutdown = ($Response.ok -eq $true)
    if ($RequestedGracefulShutdown) {
        Write-Host "Graceful VTT shutdown requested. Backup/checkpoint is running..."
    }
} catch {}

if (Test-Path $PidFile) {
    $PidValue = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($PidValue) {
        $Process = Get-Process -Id ([int]$PidValue) -ErrorAction SilentlyContinue
        if ($Process) {
            if ($RequestedGracefulShutdown) {
                try {
                    $Process.WaitForExit(7000)
                } catch {}
            }

            $Process.Refresh()
            if (-not $Process.HasExited) {
                Write-Warning "Graceful shutdown did not finish in time. Forcing PID $PidValue to stop."
                Stop-Process -Id ([int]$PidValue) -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

if ($DisableFunnel) {
    $Tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($Tailscale) {
        Write-Host "Disabling Tailscale Funnel..."
        & tailscale funnel reset
    }
}

Write-Host "VTT server stopped."
