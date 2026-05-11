@echo off
cd /d "%~dp0desktop"

if not exist node_modules (
    echo Installing dependencies...
    pnpm install
    if %errorlevel% neq 0 (
        echo pnpm failed, trying npm...
        npm install
    )
)

echo Starting SoundCloud Desktop...
pnpm tauri dev
