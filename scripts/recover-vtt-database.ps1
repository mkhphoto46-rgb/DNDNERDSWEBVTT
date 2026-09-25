param(
    [ValidateSet("System", "Campaign")]
    [string]$Target,

    [string]$CampaignId = ""
)

$ErrorActionPreference = "Stop"
$Root = "F:\DND WEB VTT"
$DataRoot = Join-Path $Root "data"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

Set-Location $Root

try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 2
    if ($Health.ok -eq $true) {
        throw "The VTT server is running. Stop it before database recovery."
    }
} catch {
    if ($_.Exception.Message -like "The VTT server is running*") { throw }
}

if ($Target -eq "System") {
    $BackupRoot = Join-Path $DataRoot "backups"
    $Destination = Join-Path $DataRoot "system.sqlite"
    $Pattern = "system-*.sqlite"
} else {
    if ([string]::IsNullOrWhiteSpace($CampaignId)) {
        throw "CampaignId is required when Target is Campaign. Run scripts\list-vtt-backups.ps1 to see campaign IDs."
    }

    $CampaignRoot = Join-Path (Join-Path $DataRoot "campaigns") $CampaignId
    $BackupRoot = Join-Path $CampaignRoot "backups"
    $Destination = Join-Path $CampaignRoot "campaign.sqlite"
    $Pattern = "campaign-*.sqlite"
}

$Latest = Get-ChildItem $BackupRoot -Filter $Pattern -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $Latest) {
    throw "No matching database backup was found in $BackupRoot"
}

Write-Host "Recovery source: $($Latest.FullName)"
Write-Host "Recovery target: $Destination"

if (Test-Path $Destination) {
    $Preserved = "$Destination.pre-recovery-$Timestamp"
    Copy-Item $Destination $Preserved -Force
    Write-Host "Current database preserved as: $Preserved"
}

Remove-Item "$Destination-wal" -Force -ErrorAction SilentlyContinue
Remove-Item "$Destination-shm" -Force -ErrorAction SilentlyContinue
Copy-Item $Latest.FullName $Destination -Force

Write-Host ""
Write-Host "Database restored from the newest physical backup."
Write-Host "Start the VTT normally. Startup integrity checking will validate the restored database before accepting connections."
