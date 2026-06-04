@echo off
REM ─── BTI Engine Build Script ──────────────────────────────────────────────
REM Run from D:\BB\engine\
REM Prerequisites:
REM   1. Visual Studio 2022 (MSVC C++ tools)
REM   2. CMake 3.20+ in PATH
REM   3. pip install pybind11 (in your venv)
REM   4. Python 3.10+ (same version as backend venv)

setlocal EnableDelayedExpansion

echo [BTI Engine] Building C++ tick processor...
echo.

REM ── Detect Python from venv ──────────────────────────────────────────────
set VENV_PYTHON=..\backend\venv\Scripts\python.exe
if not exist "%VENV_PYTHON%" (
    set VENV_PYTHON=python
    echo [WARN] venv not found at ..\backend\venv — using system python
)

REM ── Install pybind11 if not present ─────────────────────────────────────
%VENV_PYTHON% -c "import pybind11" 2>nul
if errorlevel 1 (
    echo [BTI Engine] Installing pybind11...
    %VENV_PYTHON% -m pip install pybind11 cmake
)

REM ── Configure ───────────────────────────────────────────────────────────
mkdir build 2>nul
cd build

cmake .. ^
    -G "Visual Studio 17 2022" ^
    -A x64 ^
    -DCMAKE_BUILD_TYPE=Release ^
    -DPYTHON_EXECUTABLE="%CD%\..\%VENV_PYTHON%"

if errorlevel 1 (
    echo [ERROR] CMake configure failed!
    pause
    exit /b 1
)

REM ── Build ────────────────────────────────────────────────────────────────
cmake --build . --config Release --parallel

if errorlevel 1 (
    echo [ERROR] Build failed!
    cd ..
    pause
    exit /b 1
)

REM ── Install (copies .pyd to backend/) ───────────────────────────────────
cmake --install . --config Release

cd ..

echo.
echo [BTI Engine] Build complete!
echo [BTI Engine] bti_engine.pyd installed to backend/
echo.
echo Test with:
echo   cd ..\backend
echo   python -c "import bti_engine; s = bti_engine.get_global_store(); print('Store size:', s.size)"
echo   python -c "import bti_engine; print(bti_engine.bench_update_ns(100000), 'ns/update')"
echo.
pause
