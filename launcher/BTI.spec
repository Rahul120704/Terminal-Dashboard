# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for BTI.exe launcher
# Build: pyinstaller BTI.spec

import sys
from pathlib import Path

ROOT = Path(SPEC).parent.parent  # D:\BB

a = Analysis(
    ['bti_launcher.py'],
    pathex=[str(Path(SPEC).parent)],
    binaries=[],
    datas=[],
    hiddenimports=[
        'psutil', 'tkinter', 'tkinter.font',
        'urllib.request', 'subprocess', 'threading',
        'webbrowser', 'signal', 'pathlib',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'numpy', 'pandas', 'scipy', 'matplotlib',
        'PIL', 'cv2', 'torch', 'tensorflow',
    ],
    noarchive=False,
    optimize=2,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='BTI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,           # No console window — GUI only
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='BTI.ico',
    version_file=None,
    uac_admin=False,
    uac_uiaccess=False,
)
