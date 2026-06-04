# BTI Start Script — Starts backend + frontend + guardian
# Run: powershell -ExecutionPolicy Bypass -File scripts\start.ps1

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoBuild
)

$Root = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$PythonExe = Join-Path $BackendDir "venv\Scripts\python.exe"

# Fallback to system Python
if (!(Test-Path $PythonExe)) { $PythonExe = "python" }

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Bloomberg Terminal India — Starting" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Build React frontend
if (!$BackendOnly -and !$NoBuild) {
    Write-Host "`n[BUILD] Building React frontend..." -ForegroundColor Cyan
    Set-Location $FrontendDir
    npm run build --silent
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Build failed. Starting dev server instead." -ForegroundColor Yellow
    } else {
        Write-Host "  Frontend built." -ForegroundColor Green
    }
}

# Start backend
if (!$FrontendOnly) {
    Write-Host "`n[BACKEND] Starting FastAPI on port 8000..." -ForegroundColor Cyan
    $BackendJob = Start-Job -ScriptBlock {
        param($dir, $py)
        Set-Location $dir
        & $py -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    } -ArgumentList $BackendDir, $PythonExe
    Write-Host "  Backend started (Job ID: $($BackendJob.Id))" -ForegroundColor Green
}

# Start frontend dev server if not built
if (!$BackendOnly) {
    $BuildDir = Join-Path $FrontendDir "build"
    if (!(Test-Path $BuildDir) -or $NoBuild) {
        Write-Host "`n[FRONTEND] Starting React dev server on port 3000..." -ForegroundColor Cyan
        $FrontendJob = Start-Job -ScriptBlock {
            param($dir)
            Set-Location $dir
            $env:BROWSER = "none"
            npm start
        } -ArgumentList $FrontendDir
        Write-Host "  Frontend dev server started (Job ID: $($FrontendJob.Id))" -ForegroundColor Green
        Start-Sleep -Seconds 3
        Start-Process "http://localhost:3000"
    } else {
        Write-Host "`n[INFO] Serving built frontend from FastAPI on port 8000" -ForegroundColor Cyan
        Start-Sleep -Seconds 3
        Start-Process "http://localhost:8000"
    }
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "  BTI Running:" -ForegroundColor Yellow
Write-Host "  Backend:  http://localhost:8000" -ForegroundColor Cyan
Write-Host "  API Docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000 (dev) or :8000 (prod)" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Keep alive and stream logs
try {
    while ($true) {
        Start-Sleep -Seconds 5
        $jobs = Get-Job | Where-Object { $_.State -eq 'Running' }
        foreach ($job in $jobs) {
            $output = Receive-Job -Job $job
            if ($output) { Write-Host $output }
        }
    }
} finally {
    Write-Host "`nStopping all services..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    Write-Host "All services stopped." -ForegroundColor Green
}
