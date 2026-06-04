@echo off
REM ── BTI — Bloomberg Terminal India ──────────────────────────────────────────
REM Launch backend + Vite dev server and open in Chrome browser (not Electron)
REM Use this instead of electron:dev for a lighter, faster browser experience.

echo.
echo  BTI — Bloomberg Terminal India
echo  Starting backend + Vite, opening in Chrome...
echo.

REM ── Start FastAPI backend (if not already running) ────────────────────────
netstat -ano | findstr :8000 >nul 2>&1
if %errorlevel% neq 0 (
    echo  [1/3] Starting FastAPI backend on port 8000...
    start "BTI Backend" /min cmd /c "cd /d D:\BB\backend && venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 >> _uvicorn.out.log 2>> _uvicorn.err.log"
    timeout /t 4 /nobreak >nul
) else (
    echo  [1/3] Backend already running on port 8000
)

REM ── Start Vite dev server (if not already running) ────────────────────────
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo  [2/3] Starting Vite dev server on port 3000...
    start "BTI Frontend" /min cmd /c "cd /d D:\BB\frontend && npm run start"
    timeout /t 5 /nobreak >nul
) else (
    echo  [2/3] Frontend already running on port 3000
)

REM ── Open in Chrome browser ────────────────────────────────────────────────
echo  [3/3] Opening in Chrome...

REM Try Chrome first, then Edge, then default browser
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if exist %CHROME% (
    start "" %CHROME% --app=http://localhost:3000 --window-size=1600,900 --new-window
) else if exist %EDGE% (
    start "" %EDGE% --app=http://localhost:3000 --window-size=1600,900 --new-window
) else (
    start http://localhost:3000
)

echo.
echo  BTI is running at http://localhost:3000
echo  Backend logs: D:\BB\backend\_uvicorn.err.log
echo  Press any key to exit this window (servers will keep running)
pause >nul
