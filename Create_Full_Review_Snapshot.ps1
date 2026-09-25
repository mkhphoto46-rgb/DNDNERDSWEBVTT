$ErrorActionPreference = "Stop"

$ProjectRoot = "F:\DND WEB VTT"
$TempRoot    = "F:\DND_WEB_VTT_FULL_REVIEW_TEMP"
$OutputZip   = "F:\DND_WEB_VTT_FULL_REVIEW_SNAPSHOT.zip"

Write-Host ""
Write-Host "================================================"
Write-Host " D&D WEB VTT - FULL REVIEW SOURCE SNAPSHOT"
Write-Host "================================================"
Write-Host ""

if (-not (Test-Path $ProjectRoot)) {
    Write-Host "ERROR: Project folder not found:"
    Write-Host $ProjectRoot
    exit 1
}

Set-Location $ProjectRoot

if (Test-Path $TempRoot) {
    Remove-Item $TempRoot -Recurse -Force
}

if (Test-Path $OutputZip) {
    Remove-Item $OutputZip -Force
}

New-Item -ItemType Directory -Path $TempRoot | Out-Null

# Core source folders
$SourceFolders = @(
    "src",
    "server",
    "public",
    "scripts"
)

foreach ($Folder in $SourceFolders) {
    if (Test-Path $Folder) {
        Write-Host "Including $Folder\"
        Copy-Item $Folder "$TempRoot\$Folder" -Recurse -Force
    }
    else {
        Write-Host "NOTE: $Folder\ was not found and will be skipped."
    }
}

# Exact root project files
$ExactFiles = @(
    "package.json",
    "package-lock.json",
    ".gitignore",
    "index.html"
)

foreach ($File in $ExactFiles) {
    if (Test-Path $File) {
        Copy-Item $File "$TempRoot\$File" -Force
    }
}

# TypeScript / Vite / common root configuration files
Get-ChildItem "." -File -Filter "tsconfig*.json" | ForEach-Object {
    Copy-Item $_.FullName "$TempRoot\$($_.Name)" -Force
}

Get-ChildItem "." -File -Filter "vite.config.*" | ForEach-Object {
    Copy-Item $_.FullName "$TempRoot\$($_.Name)" -Force
}

Get-ChildItem "." -File -Filter "*.config.*" | ForEach-Object {
    if (-not (Test-Path "$TempRoot\$($_.Name)")) {
        Copy-Item $_.FullName "$TempRoot\$($_.Name)" -Force
    }
}

# Root project documentation only
Get-ChildItem "." -File -Filter "*.md" | ForEach-Object {
    Copy-Item $_.FullName "$TempRoot\$($_.Name)" -Force
}

# Safety exclusions by design:
# - node_modules/
# - dist/
# - data/
# - .git/
# - .env and other secrets
# - assets-source/
# - content-sources/books/ (user-owned rulebook PDFs)
# - campaign/runtime databases and backups
# - tools/ binaries

Write-Host ""
Write-Host "Creating ZIP..."

Compress-Archive `
    -Path "$TempRoot\*" `
    -DestinationPath $OutputZip `
    -CompressionLevel Optimal

Remove-Item $TempRoot -Recurse -Force

Write-Host ""
Write-Host "SUCCESS"
Write-Host "FULL REVIEW ZIP:"
Write-Host $OutputZip
Write-Host ""
