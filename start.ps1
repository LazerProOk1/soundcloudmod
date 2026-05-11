Set-Location "$PSScriptRoot\desktop"

$pnpm = "$env:APPDATA\npm\pnpm.cmd"
if (-not (Test-Path $pnpm)) { $pnpm = "pnpm.cmd" }

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    & $pnpm install
}

Write-Host "Starting SoundCloud Desktop..."
& $pnpm tauri dev
