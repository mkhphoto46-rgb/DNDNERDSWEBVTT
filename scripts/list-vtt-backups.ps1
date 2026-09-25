$Root = "F:\DND WEB VTT"
$DataRoot = Join-Path $Root "data"

Write-Host "========================================"
Write-Host " D&D WEB VTT DATABASE BACKUPS"
Write-Host "========================================"

$SystemBackupRoot = Join-Path $DataRoot "backups"
Write-Host ""
Write-Host "SYSTEM DATABASE"
if (Test-Path $SystemBackupRoot) {
    Get-ChildItem $SystemBackupRoot -Filter "system-*.sqlite" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object LastWriteTime, Length, FullName
} else {
    Write-Host "No system backup directory yet."
}

Write-Host ""
Write-Host "CAMPAIGN DATABASES"
$CampaignRoot = Join-Path $DataRoot "campaigns"
if (Test-Path $CampaignRoot) {
    Get-ChildItem $CampaignRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $CampaignId = $_.Name
        $BackupRoot = Join-Path $_.FullName "backups"
        $Latest = Get-ChildItem $BackupRoot -Filter "campaign-*.sqlite" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if ($Latest) {
            [pscustomobject]@{
                CampaignId = $CampaignId
                LastBackup = $Latest.LastWriteTime
                SizeBytes = $Latest.Length
                LatestBackup = $Latest.FullName
            }
        }
    } | Format-Table -AutoSize
} else {
    Write-Host "No campaign data directory yet."
}
