@echo off
title Bloomberg Terminal India — Electron Launcher
echo.
echo  ██████╗ ████████╗██╗
echo  ██╔══██╗╚══██╔══╝██║
echo  ██████╔╝   ██║   ██║
echo  ██╔══██╗   ██║   ██║
echo  ██████╔╝   ██║   ██║
echo  ╚═════╝    ╚═╝   ╚═╝
echo.
echo  Bloomberg Terminal India — Chromium/Electron Shell
echo  ---------------------------------------------------
echo.

REM Check if Vite dev server is running (dev mode)
curl -s http://localhost:3000 >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    echo [INFO] Vite dev server detected at :3000
    echo [INFO] Starting Electron in dev mode...
    cd /d %~dp0
    npm run electron:start
) ELSE (
    echo [INFO] No dev server — starting in production mode (built app)
    IF NOT EXIST "build\index.html" (
        echo [ERROR] No production build found. Run: npm run build
        echo [INFO] Or launch dev mode with: npm run electron:dev
        pause
        exit /b 1
    )
    cd /d %~dp0
    npm run electron:start
)
