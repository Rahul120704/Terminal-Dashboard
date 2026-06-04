# BTI Setup Script — Installs all dependencies
# Run once: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Bloomberg Terminal India — Setup" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$Root = Split-Path -Parent $PSScriptRoot

# 1. Python backend deps
Write-Host "`n[1/3] Installing Python dependencies..." -ForegroundColor Cyan
$BackendDir = Join-Path $Root "backend"
if (!(Test-Path "$BackendDir\venv")) {
    python -m venv "$BackendDir\venv"
}
& "$BackendDir\venv\Scripts\pip" install --upgrade pip --quiet
& "$BackendDir\venv\Scripts\pip" install -r "$BackendDir\requirements.txt" --quiet
Write-Host "  Python deps installed." -ForegroundColor Green

# 2. Node / React deps
Write-Host "`n[2/3] Installing Node dependencies..." -ForegroundColor Cyan
$FrontendDir = Join-Path $Root "frontend"
Set-Location $FrontendDir
npm install --legacy-peer-deps --silent
Write-Host "  Node deps installed." -ForegroundColor Green

# 3. Create data_store directory
Write-Host "`n[3/3] Creating data directories..." -ForegroundColor Cyan
$DataStore = Join-Path $Root "backend\data_store"
if (!(Test-Path $DataStore)) { New-Item -ItemType Directory -Path $DataStore | Out-Null }
Write-Host "  Directories created." -ForegroundColor Green

Write-Host "`n✓ Setup complete! Run: scripts\start.ps1" -ForegroundColor Green
